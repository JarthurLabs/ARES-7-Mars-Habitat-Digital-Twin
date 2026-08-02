import { createHash } from "node:crypto";
import type { EventGridEvent, InvocationContext } from "@azure/functions";
import { snapshotVersionMatches } from "@ares7/controller-core";
import type { AggregateTelemetry, TelemetrySnapshot } from "./contracts.js";
import { getTwinStore } from "./clients.js";
import { TwinConflictError, type TwinRecord, type TwinStore } from "./twinStore.js";

const CLOCK_ID = "ares7-clock";
const SNAPSHOT_MODEL = "dtmi:ares7:TelemetrySnapshot;2";
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;

export class TelemetryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelemetryValidationError";
  }
}

export class TelemetrySequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelemetrySequenceError";
  }
}

export interface IngestResult {
  readonly status: "committed" | "duplicate";
  readonly snapshotId: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function payloadHashFor(telemetry: Omit<AggregateTelemetry, "payloadHash">): string {
  return createHash("sha256").update(canonicalJson(telemetry)).digest("hex");
}

function decodeJsonString(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length % 4 !== 0) {
      throw new TelemetryValidationError("Telemetry body is neither JSON nor valid Base64 JSON.");
    }
    try {
      const decoded = Buffer.from(body, "base64").toString("utf8");
      if (Buffer.from(decoded, "utf8").toString("base64") !== body) throw new Error("noncanonical");
      return JSON.parse(decoded);
    } catch {
      throw new TelemetryValidationError("Telemetry body is neither JSON nor valid Base64 JSON.");
    }
  }
}

export function decodeTelemetryBody(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const body = (data as Record<string, unknown>).body ?? data;
  return typeof body === "string" ? decodeJsonString(body) : body;
}

function requireNumber(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TelemetryValidationError(`${name} must be between ${minimum} and ${maximum}.`);
  }
}

function requireObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TelemetryValidationError(`${name} must be an object.`);
  }
}

export function parseTelemetry(value: unknown): AggregateTelemetry {
  requireObject(value, "Telemetry body");
  if (value.schemaVersion !== "2.0" || value.messageType !== "ares7.aggregateTelemetry") {
    throw new TelemetryValidationError("Unsupported telemetry schema or message type.");
  }
  if (typeof value.scenarioRunId !== "string" || !runIdPattern.test(value.scenarioRunId)) {
    throw new TelemetryValidationError("scenarioRunId must be a UUID.");
  }
  if (!Number.isInteger(value.tick) || (value.tick as number) < 0) {
    throw new TelemetryValidationError("tick must be a nonnegative integer.");
  }
  if (typeof value.snapshotVersion !== "string" || !snapshotVersionMatches(value as never)) {
    throw new TelemetryValidationError("snapshotVersion does not match this run and tick.");
  }
  if (typeof value.sampleUtc !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.sampleUtc)) {
    throw new TelemetryValidationError("sampleUtc must be an ISO 8601 UTC timestamp.");
  }
  if (Number.isNaN(Date.parse(value.sampleUtc)) || new Date(value.sampleUtc).toISOString() !== value.sampleUtc) {
    throw new TelemetryValidationError("sampleUtc is not a valid date.");
  }
  if (typeof value.payloadHash !== "string" || !hashPattern.test(value.payloadHash)) {
    throw new TelemetryValidationError("payloadHash must be a lowercase SHA-256 hash.");
  }

  requireNumber(value.simulatedMinute, "simulatedMinute", 0, 100_000);
  requireObject(value.environment, "environment");
  requireObject(value.power, "power");
  requireObject(value.lifeSupport, "lifeSupport");

  requireNumber(value.environment.stormIntensityPct, "stormIntensityPct", 0, 100);
  requireNumber(value.environment.dustOpacityPct, "dustOpacityPct", 0, 100);
  requireNumber(value.environment.solarIrradiancePct, "solarIrradiancePct", 0, 100);
  requireNumber(value.environment.externalTemperatureC, "externalTemperatureC", -150, 50);
  requireNumber(value.environment.windSpeedMps, "windSpeedMps", 0, 100);
  requireNumber(value.power.solarOutputKw, "solarOutputKw", 0, 500);
  requireNumber(value.power.solarOutputPct, "solarOutputPct", 0, 100);
  requireNumber(value.power.dustDeratePct, "dustDeratePct", 0, 100);
  requireNumber(value.power.batteryChargePct, "batteryChargePct", 0, 100);
  requireNumber(value.power.batteryFlowKw, "batteryFlowKw", -500, 500);
  requireNumber(value.power.busAvailableKw, "busAvailableKw", 0, 500);
  requireNumber(value.power.busDemandKw, "busDemandKw", 0, 500);
  requireNumber(value.lifeSupport.oxygenGeneratorOutputPct, "oxygenGeneratorOutputPct", 0, 100);
  requireNumber(value.lifeSupport.oxygenReservePct, "oxygenReservePct", 0, 100);
  requireNumber(value.lifeSupport.cabinOxygenPct, "cabinOxygenPct", 0, 30);
  requireNumber(value.lifeSupport.co2Ppm, "co2Ppm", 0, 20_000);
  requireNumber(value.lifeSupport.habitatPressureKPa, "habitatPressureKPa", 0, 120);
  requireNumber(value.lifeSupport.allocatedPowerKw, "allocatedPowerKw", 0, 100);

  const telemetry = value as unknown as AggregateTelemetry;
  const { payloadHash, ...hashable } = telemetry;
  if (payloadHashFor(hashable) !== payloadHash) {
    throw new TelemetryValidationError("payloadHash does not match the telemetry payload.");
  }
  return structuredClone(telemetry);
}

export function snapshotTwinId(runId: string, tick: number): string {
  return `ares7-snapshot-${runId}-${tick}`;
}

function snapshotProperties(telemetry: AggregateTelemetry): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: telemetry.schemaVersion,
    messageType: telemetry.messageType,
    scenarioRunId: telemetry.scenarioRunId,
    tick: telemetry.tick,
    snapshotVersion: telemetry.snapshotVersion,
    payloadHash: telemetry.payloadHash,
    simulatedMinute: telemetry.simulatedMinute,
    sampleUtc: telemetry.sampleUtc,
    ...telemetry.environment,
    ...telemetry.power,
    ...telemetry.lifeSupport,
  };
}

function projectionStamp(telemetry: AggregateTelemetry): Readonly<Record<string, unknown>> {
  return {
    scenarioRunId: telemetry.scenarioRunId,
    tick: telemetry.tick,
    snapshotVersion: telemetry.snapshotVersion,
    payloadHash: telemetry.payloadHash,
    sampleUtc: telemetry.sampleUtc,
  };
}

function clockIdentity(clock: TwinRecord): { runId: string; tick: number } {
  const runId = clock.properties.scenarioRunId;
  const tick = clock.properties.tick;
  if (typeof runId !== "string" || !Number.isInteger(tick)) {
    throw new Error("Scenario clock has an invalid identity.");
  }
  return { runId, tick: tick as number };
}

async function validateSequence(
  store: TwinStore,
  telemetry: AggregateTelemetry,
  clock: TwinRecord,
  existingSnapshot: TwinRecord | undefined,
): Promise<"continue" | "duplicate"> {
  const identity = clockIdentity(clock);
  if (existingSnapshot && existingSnapshot.properties.payloadHash !== telemetry.payloadHash) {
    throw new TelemetrySequenceError("A conflicting duplicate exists for this run and tick.");
  }
  if (identity.runId === telemetry.scenarioRunId) {
    if (identity.tick === telemetry.tick && existingSnapshot) return "duplicate";
    if (telemetry.tick !== identity.tick + 1) {
      throw new TelemetrySequenceError(
        telemetry.tick < identity.tick + 1 ? "Telemetry tick is stale." : "Telemetry contains a tick gap.",
      );
    }
    return "continue";
  }
  if (telemetry.tick !== 0) throw new TelemetrySequenceError("A new run must begin at tick 0.");
  if (identity.runId !== "not-started") {
    const previousStart = await store.getTwin(snapshotTwinId(telemetry.scenarioRunId, 0));
    if (previousStart) throw new TelemetrySequenceError("Telemetry belongs to a stale scenario run.");
  }
  return "continue";
}

export async function ingestTelemetryWithPorts(
  rawData: unknown,
  store: TwinStore,
  log: (message: string) => void = () => undefined,
): Promise<IngestResult> {
  const telemetry = parseTelemetry(decodeTelemetryBody(rawData));
  const snapshotId = snapshotTwinId(telemetry.scenarioRunId, telemetry.tick);
  const clock = await store.getTwin(CLOCK_ID);
  if (!clock) throw new Error("Scenario clock twin does not exist.");
  const existingSnapshot = await store.getTwin(snapshotId);
  const sequence = await validateSequence(store, telemetry, clock, existingSnapshot);
  if (sequence === "duplicate") {
    log(`duplicate run=${telemetry.scenarioRunId} tick=${telemetry.tick}`);
    return { status: "duplicate", snapshotId };
  }

  const immutableSnapshot: TelemetrySnapshot = Object.freeze({
    scenarioRunId: telemetry.scenarioRunId,
    tick: telemetry.tick,
    snapshotVersion: telemetry.snapshotVersion,
    payloadHash: telemetry.payloadHash,
    simulatedMinute: telemetry.simulatedMinute,
    sampleUtc: telemetry.sampleUtc,
    telemetry: Object.freeze(structuredClone(telemetry)),
  });
  if (!existingSnapshot) {
    try {
      await store.createTwin(snapshotId, SNAPSHOT_MODEL, snapshotProperties(immutableSnapshot.telemetry));
    } catch (error) {
      if (!(error instanceof TwinConflictError)) throw error;
      const concurrent = await store.getTwin(snapshotId);
      if (!concurrent || concurrent.properties.payloadHash !== telemetry.payloadHash) {
        throw new TelemetrySequenceError("A conflicting duplicate was created concurrently.");
      }
    }
  }

  const stamp = projectionStamp(telemetry);
  const projections: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
    ["ares7-environment", { ...stamp, ...telemetry.environment }],
    ["ares7-solar-alpha", {
      ...stamp,
      status: telemetry.power.solarOutputPct < 15 ? "CRITICAL" : telemetry.power.solarOutputPct < 65 ? "DEGRADED" : "NOMINAL",
      outputKw: telemetry.power.solarOutputKw,
      outputPct: telemetry.power.solarOutputPct,
      dustDeratePct: telemetry.power.dustDeratePct,
    }],
    ["ares7-battery-alpha", {
      ...stamp,
      status: telemetry.power.batteryChargePct <= 60 ? "CRITICAL" : telemetry.power.batteryChargePct < 80 ? "DEGRADED" : "NOMINAL",
      chargePct: telemetry.power.batteryChargePct,
      flowKw: telemetry.power.batteryFlowKw,
      busAvailableKw: telemetry.power.busAvailableKw,
      busDemandKw: telemetry.power.busDemandKw,
    }],
    ["ares7-life-support", {
      ...stamp,
      status: telemetry.lifeSupport.oxygenGeneratorOutputPct <= 50 ? "AT_RISK" : telemetry.lifeSupport.oxygenGeneratorOutputPct < 85 ? "DEGRADED" : "NOMINAL",
      oxygenGeneratorOutputPct: telemetry.lifeSupport.oxygenGeneratorOutputPct,
      oxygenReservePct: telemetry.lifeSupport.oxygenReservePct,
      cabinOxygenPct: telemetry.lifeSupport.cabinOxygenPct,
      co2Ppm: telemetry.lifeSupport.co2Ppm,
      allocatedPowerKw: telemetry.lifeSupport.allocatedPowerKw,
    }],
    ["ares7-module-command", {
      ...stamp,
      cabinOxygenPct: telemetry.lifeSupport.cabinOxygenPct,
      pressureKPa: telemetry.lifeSupport.habitatPressureKPa,
    }],
    ["ares7-module-crew", {
      ...stamp,
      cabinOxygenPct: telemetry.lifeSupport.cabinOxygenPct,
      pressureKPa: telemetry.lifeSupport.habitatPressureKPa,
    }],
    ["ares7-module-lab", {
      ...stamp,
      cabinOxygenPct: telemetry.lifeSupport.cabinOxygenPct,
      pressureKPa: telemetry.lifeSupport.habitatPressureKPa,
    }],
    ["ares7-module-greenhouse", {
      ...stamp,
      cabinOxygenPct: telemetry.lifeSupport.cabinOxygenPct,
      pressureKPa: telemetry.lifeSupport.habitatPressureKPa,
    }],
  ];
  for (const [id, properties] of projections) await store.updateTwin(id, properties);

  await store.updateTwin(
    CLOCK_ID,
    {
      scenarioRunId: telemetry.scenarioRunId,
      tick: telemetry.tick,
      snapshotVersion: telemetry.snapshotVersion,
      committedSnapshotId: snapshotId,
      payloadHash: telemetry.payloadHash,
      simulatedMinute: telemetry.simulatedMinute,
      sampleUtc: telemetry.sampleUtc,
    },
    { ifMatch: clock.etag },
  );
  log(`committed run=${telemetry.scenarioRunId} tick=${telemetry.tick} snapshot=${snapshotId}`);
  return { status: "committed", snapshotId };
}

export async function ingestTelemetry(event: EventGridEvent, context: InvocationContext): Promise<void> {
  await ingestTelemetryWithPorts(event.data, getTwinStore(), (message) => context.log(message));
}
