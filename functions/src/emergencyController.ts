import type { EventGridEvent, InvocationContext } from "@azure/functions";
import type {
  ControllerSnapshot,
  ControllerState,
  OperatorDecision,
} from "./contracts.js";
import { getPubSubClient, getTwinsClient } from "./clients.js";
import { evaluateController } from "./stateMachine.js";
import { patches } from "./twinPatch.js";

type Twin = Record<string, unknown> & { etag?: string };

const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === "number" ? value : fallback;

const stringValue = <T extends string>(value: unknown, fallback: T): T =>
  typeof value === "string" ? (value as T) : fallback;

function eventTargetsClock(event: EventGridEvent): boolean {
  const data = event.data as Record<string, unknown> | undefined;
  const twinId = data?.$dtId ?? data?.twinId;
  return twinId === "ares7-clock" || event.subject?.includes("ares7-clock") === true;
}

export async function emergencyController(
  event: EventGridEvent,
  context: InvocationContext,
): Promise<void> {
  if (!eventTargetsClock(event)) {
    context.log(`ignored non-clock event ${event.id ?? "unknown"}`);
    return;
  }

  const client = getTwinsClient();
  const [clock, habitat, environment, solar, battery, lifeSupport] = (await Promise.all([
    client.getDigitalTwin("ares7-clock"),
    client.getDigitalTwin("ares7-habitat"),
    client.getDigitalTwin("ares7-environment"),
    client.getDigitalTwin("ares7-solar-alpha"),
    client.getDigitalTwin("ares7-battery-alpha"),
    client.getDigitalTwin("ares7-life-support"),
  ])) as Twin[];

  const runId = stringValue(clock.scenarioRunId, "unknown");
  const tick = numberValue(clock.tick, -1);
  const sameRun = habitat.scenarioRunId === runId;
  const lastProcessedTick = sameRun ? numberValue(habitat.lastProcessedTick, -1) : -1;

  if (tick <= lastProcessedTick) {
    context.log(`duplicate ignored run=${runId} tick=${tick} last=${lastProcessedTick}`);
    return;
  }

  const snapshot: ControllerSnapshot = {
    scenarioRunId: runId,
    tick,
    currentState: sameRun
      ? stringValue<ControllerState>(habitat.operationalState, "NOMINAL")
      : "NOMINAL",
    operatorDecision: sameRun
      ? stringValue<OperatorDecision>(habitat.operatorDecision, "NONE")
      : "NONE",
    recoveryStableTicks: sameRun ? numberValue(habitat.recoveryStableTicks) : 0,
    resolvedStableTicks: sameRun ? numberValue(habitat.resolvedStableTicks) : 0,
    dustOpacityPct: numberValue(environment.dustOpacityPct),
    solarOutputPct: numberValue(solar.outputPct),
    batteryChargePct: numberValue(battery.chargePct),
    oxygenGeneratorOutputPct: numberValue(lifeSupport.oxygenGeneratorOutputPct),
    oxygenReservePct: numberValue(lifeSupport.oxygenReservePct),
  };

  const decision = evaluateController(snapshot);
  context.log(
    `controller run=${runId} tick=${tick} ${snapshot.currentState}->${decision.nextState} action=${decision.action}`,
  );

  await Promise.all([
    client.updateDigitalTwin(
      "ares7-module-lab",
      patches({
        operationalState: decision.isolateLab ? "ISOLATED" : "NOMINAL",
        isolated: decision.isolateLab,
        powerDemandKw: decision.isolateLab ? 0 : 7,
      }),
    ),
    client.updateDigitalTwin(
      "ares7-module-greenhouse",
      patches({
        operationalState: decision.isolateGreenhouse ? "ISOLATED" : "NOMINAL",
        isolated: decision.isolateGreenhouse,
        powerDemandKw: decision.isolateGreenhouse ? 0 : 6,
      }),
    ),
    client.updateDigitalTwin(
      "ares7-airlock-main",
      patches({
        status: decision.sealAirlock ? "SEALED" : "READY",
        sealed: decision.sealAirlock,
      }),
    ),
    client.updateDigitalTwin(
      "ares7-battery-alpha",
      patches({ nonCriticalLoadShed: decision.shedNonCriticalLoad }),
    ),
    client.updateDigitalTwin(
      "ares7-life-support",
      patches({ priorityMode: decision.prioritizeLifeSupport }),
    ),
  ]);

  await client.updateDigitalTwin(
    "ares7-habitat",
    patches({
      operationalState: decision.nextState,
      scenarioRunId: runId,
      lastProcessedTick: tick,
      simulatedMinute: numberValue(clock.simulatedMinute),
      alarmLevel: decision.alarmLevel,
      activeIncident: decision.nextState === "NOMINAL" || decision.nextState === "RESOLVED" ? "NONE" : "DUST_STORM",
      controllerAction: decision.action,
      operatorDecision: decision.operatorDecision,
      recoveryStableTicks: decision.recoveryStableTicks,
      resolvedStableTicks: decision.resolvedStableTicks,
      lastTransitionUtc: new Date().toISOString(),
      totalLoadKw: decision.shedNonCriticalLoad ? 21 : 34,
    }),
    { ifMatch: habitat.etag },
  );

  const pubSub = getPubSubClient();
  if (pubSub) {
    await pubSub.sendToAll({
      type: "ares7.controllerSnapshot",
      scenarioRunId: runId,
      tick,
      state: decision.nextState,
      alarmLevel: decision.alarmLevel,
      action: decision.action,
      operatorDecision: decision.operatorDecision,
      controls: {
        isolateLab: decision.isolateLab,
        isolateGreenhouse: decision.isolateGreenhouse,
        sealAirlock: decision.sealAirlock,
        shedNonCriticalLoad: decision.shedNonCriticalLoad,
        prioritizeLifeSupport: decision.prioritizeLifeSupport,
      },
    });
  }
}
