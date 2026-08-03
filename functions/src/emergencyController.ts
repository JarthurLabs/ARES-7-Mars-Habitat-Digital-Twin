import type { EventGridEvent, InvocationContext } from "@azure/functions";
import type {
  ControllerDecision,
  ControllerSnapshot,
  ControllerState,
  OperatorDecision,
} from "@ares7/controller-core";
import { evaluateController, snapshotVersionMatches } from "@ares7/controller-core";
import { getPubSubClient, getTwinStore } from "./clients.js";
import type { AggregateTelemetry } from "./contracts.js";
import { parseTelemetry, payloadHashFor, snapshotTwinId } from "./ingestTelemetry.js";
import { TwinConflictError, type TwinRecord, type TwinStore } from "./twinStore.js";

const CLOCK_ID = "ares7-clock";
const HABITAT_ID = "ares7-habitat";
const SNAPSHOT_MODEL = "dtmi:ares7:TelemetrySnapshot;2";

export type ControllerEventTarget = "clock" | "approval" | "ignored";

export interface BroadcastPort {
  send(message: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface ControllerRunResult {
  readonly status: "processed" | "ignored" | "duplicate" | "broadcast-retried";
  readonly actions: readonly string[];
}

export class SnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotIntegrityError";
  }
}

const integerValue = (value: unknown, fallback = 0): number =>
  Number.isInteger(value) ? (value as number) : fallback;

const stringValue = <T extends string>(value: unknown, fallback: T): T =>
  typeof value === "string" ? (value as T) : fallback;

function twinIdForEvent(event: EventGridEvent): string {
  const data = event.data as Record<string, unknown> | undefined;
  const direct = data?.$dtId ?? data?.twinId;
  if (typeof direct === "string") return direct;
  if (event.subject?.includes(CLOCK_ID)) return CLOCK_ID;
  if (event.subject?.includes(HABITAT_ID)) return HABITAT_ID;
  return "";
}

export function controllerEventTarget(event: EventGridEvent): ControllerEventTarget {
  const eventType = event.eventType ?? "";
  if (eventType && !eventType.includes("DigitalTwins.Twin.Update")) return "ignored";
  const twinId = twinIdForEvent(event);
  if (twinId === CLOCK_ID) return "clock";
  if (twinId === HABITAT_ID) return "approval";
  return "ignored";
}

function requireTwin(record: TwinRecord | undefined, id: string): TwinRecord {
  if (!record) throw new Error(`Required twin ${id} does not exist.`);
  return record;
}

function snapshotTelemetry(record: TwinRecord, runId: string, tick: number): AggregateTelemetry {
  const properties = record.properties;
  if (record.modelId && record.modelId !== SNAPSHOT_MODEL) {
    throw new SnapshotIntegrityError(`${record.id} uses ${record.modelId}, not ${SNAPSHOT_MODEL}.`);
  }
  const telemetry = parseTelemetry({
    schemaVersion: properties.schemaVersion,
    messageType: properties.messageType,
    scenarioRunId: properties.scenarioRunId,
    tick: properties.tick,
    snapshotVersion: properties.snapshotVersion,
    payloadHash: properties.payloadHash,
    simulatedMinute: properties.simulatedMinute,
    sampleUtc: properties.sampleUtc,
    environment: {
      stormIntensityPct: properties.stormIntensityPct,
      dustOpacityPct: properties.dustOpacityPct,
      solarIrradiancePct: properties.solarIrradiancePct,
      externalTemperatureC: properties.externalTemperatureC,
      windSpeedMps: properties.windSpeedMps,
    },
    power: {
      solarOutputKw: properties.solarOutputKw,
      solarOutputPct: properties.solarOutputPct,
      dustDeratePct: properties.dustDeratePct,
      batteryChargePct: properties.batteryChargePct,
      batteryFlowKw: properties.batteryFlowKw,
      busAvailableKw: properties.busAvailableKw,
      busDemandKw: properties.busDemandKw,
    },
    lifeSupport: {
      oxygenGeneratorOutputPct: properties.oxygenGeneratorOutputPct,
      oxygenReservePct: properties.oxygenReservePct,
      cabinOxygenPct: properties.cabinOxygenPct,
      co2Ppm: properties.co2Ppm,
      habitatPressureKPa: properties.habitatPressureKPa,
      allocatedPowerKw: properties.allocatedPowerKw,
    },
  });
  if (telemetry.scenarioRunId !== runId || telemetry.tick !== tick) {
    throw new SnapshotIntegrityError(
      `${record.id} identifies run=${telemetry.scenarioRunId} tick=${telemetry.tick}, expected run=${runId} tick=${tick}.`,
    );
  }
  if (!snapshotVersionMatches(telemetry)) {
    throw new SnapshotIntegrityError(`${record.id} has a mismatched snapshot version.`);
  }
  const { payloadHash: _payloadHash, ...hashable } = telemetry;
  if (payloadHashFor(hashable) !== telemetry.payloadHash) {
    throw new SnapshotIntegrityError(`${record.id} has a mismatched payload hash.`);
  }
  return telemetry;
}

function controllerSnapshot(
  habitat: TwinRecord,
  telemetry: AggregateTelemetry,
  resetForNewRun: boolean,
): ControllerSnapshot {
  return {
    scenarioRunId: telemetry.scenarioRunId,
    tick: telemetry.tick,
    snapshotVersion: telemetry.snapshotVersion,
    currentState: resetForNewRun
      ? "NOMINAL"
      : stringValue<ControllerState>(habitat.properties.operationalState, "NOMINAL"),
    operatorDecision: resetForNewRun
      ? "NONE"
      : stringValue<OperatorDecision>(habitat.properties.operatorDecision, "NONE"),
    recoveryStableTicks: resetForNewRun ? 0 : integerValue(habitat.properties.recoveryStableTicks),
    resolvedStableTicks: resetForNewRun ? 0 : integerValue(habitat.properties.resolvedStableTicks),
    dustOpacityPct: telemetry.environment.dustOpacityPct,
    solarOutputPct: telemetry.power.solarOutputPct,
    batteryChargePct: telemetry.power.batteryChargePct,
    oxygenGeneratorOutputPct: telemetry.lifeSupport.oxygenGeneratorOutputPct,
    oxygenReservePct: telemetry.lifeSupport.oxygenReservePct,
  };
}

function actionIdFor(
  runId: string,
  tick: number,
  source: "telemetry" | "approval",
  decisionId?: string,
): string {
  return source === "approval"
    ? `${runId}:tick:${tick}:decision:${decisionId}`
    : `${runId}:tick:${tick}:telemetry`;
}

interface ReconciliationAction {
  readonly actionId: string;
  readonly decisionId?: string;
  readonly source: "telemetry" | "approval";
  readonly telemetry: AggregateTelemetry;
  readonly decision: ControllerDecision;
}

interface ActuatorUpdate {
  readonly id: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

function actuatorUpdates(action: ReconciliationAction): readonly ActuatorUpdate[] {
  const commands = action.decision.commands;
  const stamp = {
    lastActionId: action.actionId,
    actionRunId: action.telemetry.scenarioRunId,
    actionTick: action.telemetry.tick,
  };
  return [
    {
      id: "ares7-module-lab",
      properties: {
        ...stamp,
        operationalState: commands.isolateLab ? "ISOLATED" : "NOMINAL",
        isolated: commands.isolateLab,
        powerDemandKw: commands.isolateLab ? 0 : 7,
      },
    },
    {
      id: "ares7-module-greenhouse",
      properties: {
        ...stamp,
        operationalState: commands.isolateGreenhouse ? "ISOLATED" : "NOMINAL",
        isolated: commands.isolateGreenhouse,
        powerDemandKw: commands.isolateGreenhouse ? 0 : 6,
      },
    },
    {
      id: "ares7-airlock-main",
      properties: {
        ...stamp,
        status: commands.sealAirlock ? "SEALED" : "READY",
        sealed: commands.sealAirlock,
      },
    },
    {
      id: "ares7-battery-alpha",
      properties: { ...stamp, nonCriticalLoadShed: commands.shedNonCriticalLoad },
    },
    {
      id: "ares7-life-support",
      properties: { ...stamp, priorityMode: commands.prioritizeLifeSupport },
    },
  ];
}

function propertiesMatch(
  current: Readonly<Record<string, unknown>>,
  desired: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(desired).every(([key, value]) => Object.is(current[key], value));
}

async function reconcileActuators(store: TwinStore, action: ReconciliationAction): Promise<void> {
  for (const update of actuatorUpdates(action)) {
    const current = requireTwin(await store.getTwin(update.id), update.id);
    if (current.properties.lastActionId === action.actionId && propertiesMatch(current.properties, update.properties)) {
      continue;
    }
    await store.updateTwin(update.id, update.properties, { ifMatch: current.etag });
  }
}

function habitatUpdate(
  action: ReconciliationAction,
  now: () => string,
): Readonly<Record<string, unknown>> {
  const decision = action.decision;
  return {
    operationalState: decision.nextState,
    scenarioRunId: action.telemetry.scenarioRunId,
    snapshotVersion: action.telemetry.snapshotVersion,
    payloadHash: action.telemetry.payloadHash,
    lastProcessedTick: action.telemetry.tick,
    simulatedMinute: action.telemetry.simulatedMinute,
    alarmLevel: decision.alarmLevel,
    activeIncident: decision.nextState === "NOMINAL" || decision.nextState === "RESOLVED" ? "NONE" : "DUST_STORM",
    controllerAction: decision.action,
    operatorDecision: decision.operatorDecision,
    recoveryStableTicks: decision.recoveryStableTicks,
    resolvedStableTicks: decision.resolvedStableTicks,
    lastTransitionUtc: now(),
    totalLoadKw: decision.commands.shedNonCriticalLoad ? 21 : 34,
    lastActionId: action.actionId,
    lastActionSource: action.source,
    ...(action.decisionId ? { lastDecisionId: action.decisionId } : {}),
  };
}

async function authoritativeMessage(store: TwinStore, habitat: TwinRecord): Promise<Readonly<Record<string, unknown>>> {
  const [lab, greenhouse, airlock, battery, lifeSupport] = await Promise.all([
    store.getTwin("ares7-module-lab"),
    store.getTwin("ares7-module-greenhouse"),
    store.getTwin("ares7-airlock-main"),
    store.getTwin("ares7-battery-alpha"),
    store.getTwin("ares7-life-support"),
  ]);
  return {
    type: "ares7.controllerSnapshot",
    actionId: habitat.properties.lastActionId,
    scenarioRunId: habitat.properties.scenarioRunId,
    tick: habitat.properties.lastProcessedTick,
    snapshotVersion: habitat.properties.snapshotVersion,
    payloadHash: habitat.properties.payloadHash,
    state: habitat.properties.operationalState,
    alarmLevel: habitat.properties.alarmLevel,
    action: habitat.properties.controllerAction,
    operatorDecision: habitat.properties.operatorDecision,
    controls: {
      isolateLab: lab?.properties.isolated === true,
      isolateGreenhouse: greenhouse?.properties.isolated === true,
      sealAirlock: airlock?.properties.sealed === true,
      shedNonCriticalLoad: battery?.properties.nonCriticalLoadShed === true,
      prioritizeLifeSupport: lifeSupport?.properties.priorityMode === true,
      energizeEmergencyBus:
        battery?.properties.nonCriticalLoadShed === true || lifeSupport?.properties.priorityMode === true,
    },
  };
}

async function broadcastPendingAction(
  store: TwinStore,
  broadcaster: BroadcastPort | undefined,
  habitat: TwinRecord,
  log: (message: string) => void,
): Promise<boolean> {
  const actionId = habitat.properties.lastActionId;
  if (typeof actionId !== "string" || habitat.properties.lastBroadcastActionId === actionId) return false;
  if (!broadcaster) return false;
  await broadcaster.send(await authoritativeMessage(store, habitat));
  const current = requireTwin(await store.getTwin(HABITAT_ID), HABITAT_ID);
  if (current.properties.lastBroadcastActionId !== actionId) {
    try {
      await store.updateTwin(HABITAT_ID, { lastBroadcastActionId: actionId }, { ifMatch: current.etag });
    } catch (error) {
      if (!(error instanceof TwinConflictError)) throw error;
      log(`broadcast marker raced action=${actionId}; a later event will reconcile the marker`);
    }
  }
  return true;
}

async function reconcileAction(
  store: TwinStore,
  broadcaster: BroadcastPort | undefined,
  action: ReconciliationAction,
  log: (message: string) => void,
  now: () => string,
): Promise<TwinRecord> {
  await reconcileActuators(store, action);
  let habitat = requireTwin(await store.getTwin(HABITAT_ID), HABITAT_ID);
  if (habitat.properties.lastActionId !== action.actionId) {
    habitat = await store.updateTwin(HABITAT_ID, habitatUpdate(action, now), { ifMatch: habitat.etag });
  }
  log(
    `controller action=${action.actionId} ${action.source} state=${action.decision.nextState} ` +
      `run=${action.telemetry.scenarioRunId} tick=${action.telemetry.tick}`,
  );
  await broadcastPendingAction(store, broadcaster, habitat, log);
  return requireTwin(await store.getTwin(HABITAT_ID), HABITAT_ID);
}

function committedClockIdentity(clock: TwinRecord): {
  runId: string;
  tick: number;
  snapshotVersion: string;
  snapshotId: string;
  payloadHash: string;
} {
  const runId = clock.properties.scenarioRunId;
  const tick = clock.properties.tick;
  const snapshotVersion = clock.properties.snapshotVersion;
  const snapshotId = clock.properties.committedSnapshotId;
  const payloadHash = clock.properties.payloadHash;
  if (
    typeof runId !== "string" ||
    !Number.isInteger(tick) ||
    typeof snapshotVersion !== "string" ||
    typeof snapshotId !== "string" ||
    typeof payloadHash !== "string"
  ) {
    throw new SnapshotIntegrityError("The scenario clock does not name a complete committed snapshot.");
  }
  if (!snapshotVersionMatches({ scenarioRunId: runId, tick: tick as number, snapshotVersion })) {
    throw new SnapshotIntegrityError("The scenario clock snapshot version does not match its run and tick.");
  }
  if (snapshotId !== snapshotTwinId(runId, tick as number)) {
    throw new SnapshotIntegrityError("The scenario clock points at the wrong snapshot twin.");
  }
  return { runId, tick: tick as number, snapshotVersion, snapshotId, payloadHash };
}

async function processClockEvent(
  store: TwinStore,
  broadcaster: BroadcastPort | undefined,
  log: (message: string) => void,
  now: () => string,
): Promise<ControllerRunResult> {
  const clock = requireTwin(await store.getTwin(CLOCK_ID), CLOCK_ID);
  const committed = committedClockIdentity(clock);
  let habitat = requireTwin(await store.getTwin(HABITAT_ID), HABITAT_ID);
  const sameRun = habitat.properties.scenarioRunId === committed.runId;
  const lastProcessedTick = sameRun ? integerValue(habitat.properties.lastProcessedTick, -1) : -1;
  if (lastProcessedTick >= committed.tick) {
    const retried = await broadcastPendingAction(store, broadcaster, habitat, log);
    return { status: retried ? "broadcast-retried" : "duplicate", actions: [] };
  }

  const actions: string[] = [];
  for (let tick = lastProcessedTick + 1; tick <= committed.tick; tick += 1) {
    const id = snapshotTwinId(committed.runId, tick);
    const record = requireTwin(await store.getTwin(id), id);
    const telemetry = snapshotTelemetry(record, committed.runId, tick);
    if (tick === committed.tick) {
      if (
        id !== committed.snapshotId ||
        telemetry.snapshotVersion !== committed.snapshotVersion ||
        telemetry.payloadHash !== committed.payloadHash
      ) {
        throw new SnapshotIntegrityError("The committed clock identity does not match its immutable snapshot.");
      }
    }
    const snapshot = controllerSnapshot(habitat, telemetry, !sameRun && tick === 0);
    const decision = evaluateController(snapshot);
    const actionId = actionIdFor(committed.runId, tick, "telemetry");
    habitat = await reconcileAction(
      store,
      broadcaster,
      { actionId, source: "telemetry", telemetry, decision },
      log,
      now,
    );
    actions.push(actionId);
  }
  return { status: "processed", actions };
}

function validApproval(habitat: TwinRecord): { decisionId: string; runId: string; tick: number } | undefined {
  if (habitat.properties.operatorDecision !== "APPROVED") return undefined;
  const decisionId = habitat.properties.decisionId;
  const runId = habitat.properties.decisionScenarioRunId;
  const tick = habitat.properties.decisionTick;
  if (typeof decisionId !== "string" || !decisionId.trim() || typeof runId !== "string" || !Number.isInteger(tick)) {
    return undefined;
  }
  if (
    habitat.properties.scenarioRunId !== runId ||
    habitat.properties.lastProcessedTick !== tick ||
    habitat.properties.lastDecisionId === decisionId
  ) {
    return undefined;
  }
  return { decisionId, runId, tick: tick as number };
}

async function processApprovalEvent(
  store: TwinStore,
  broadcaster: BroadcastPort | undefined,
  log: (message: string) => void,
  now: () => string,
): Promise<ControllerRunResult> {
  let habitat = requireTwin(await store.getTwin(HABITAT_ID), HABITAT_ID);
  const approval = validApproval(habitat);
  if (!approval) {
    const retried = await broadcastPendingAction(store, broadcaster, habitat, log);
    return { status: retried ? "broadcast-retried" : "ignored", actions: [] };
  }
  if (habitat.properties.operationalState !== "LIFE_SUPPORT_RISK") {
    log(`ignored stale approval decision=${approval.decisionId} state=${habitat.properties.operationalState}`);
    return { status: "ignored", actions: [] };
  }
  const id = snapshotTwinId(approval.runId, approval.tick);
  const telemetry = snapshotTelemetry(requireTwin(await store.getTwin(id), id), approval.runId, approval.tick);
  const snapshot = controllerSnapshot(habitat, telemetry, false);
  const decision = evaluateController({ ...snapshot, operatorDecision: "APPROVED" });
  const actionId = actionIdFor(approval.runId, approval.tick, "approval", approval.decisionId);
  habitat = await reconcileAction(
    store,
    broadcaster,
    { actionId, decisionId: approval.decisionId, source: "approval", telemetry, decision },
    log,
    now,
  );
  return { status: "processed", actions: [stringValue(habitat.properties.lastActionId, actionId)] };
}

export async function emergencyControllerWithPorts(
  event: EventGridEvent,
  store: TwinStore,
  broadcaster?: BroadcastPort,
  log: (message: string) => void = () => undefined,
  now: () => string = () => new Date().toISOString(),
): Promise<ControllerRunResult> {
  const target = controllerEventTarget(event);
  if (target === "ignored") {
    log(`ignored controller event ${event.id ?? "unknown"}`);
    return { status: "ignored", actions: [] };
  }
  return target === "clock"
    ? processClockEvent(store, broadcaster, log, now)
    : processApprovalEvent(store, broadcaster, log, now);
}

export async function emergencyController(
  event: EventGridEvent,
  context: InvocationContext,
): Promise<void> {
  const pubSub = getPubSubClient();
  const broadcaster: BroadcastPort | undefined = pubSub
    ? { send: (message) => pubSub.sendToAll(message) }
    : undefined;
  await emergencyControllerWithPorts(
    event,
    getTwinStore(),
    broadcaster,
    (message) => context.log(message),
  );
}
