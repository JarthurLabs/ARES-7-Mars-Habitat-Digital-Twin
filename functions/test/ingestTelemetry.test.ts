import { describe, expect, it } from "vitest";
import type { AggregateTelemetry } from "../src/contracts.js";
import {
  TelemetryValidationError,
  ingestTelemetryWithPorts,
  payloadHashFor,
  snapshotTwinId,
} from "../src/ingestTelemetry.js";
import {
  InMemoryTwinStore,
  TwinConflictError,
  type TwinRecord,
  type TwinStore,
} from "../src/twinStore.js";

const runOne = "11111111-1111-4111-8111-111111111111";
const runTwo = "22222222-2222-4222-8222-222222222222";
const projectionIds = [
  "ares7-environment",
  "ares7-solar-alpha",
  "ares7-battery-alpha",
  "ares7-life-support",
  "ares7-module-command",
  "ares7-module-crew",
  "ares7-module-lab",
  "ares7-module-greenhouse",
] as const;

function twin(id: string, properties: Record<string, unknown>): TwinRecord {
  return { id, properties, etag: '"1"' };
}

function seed(): TwinRecord[] {
  return [
    twin("ares7-clock", {
      scenarioRunId: "not-started",
      tick: -1,
      snapshotVersion: "not-committed",
    }),
    ...projectionIds.map((id) => twin(id, { scenarioRunId: "not-started", tick: -1 })),
  ];
}

function telemetry(runId = runOne, tick = 0): AggregateTelemetry {
  const hashable: Omit<AggregateTelemetry, "payloadHash"> = {
    schemaVersion: "2.0",
    messageType: "ares7.aggregateTelemetry",
    scenarioRunId: runId,
    tick,
    snapshotVersion: `v2:${runId}:tick:${tick}`,
    simulatedMinute: tick * 10,
    sampleUtc: new Date(Date.UTC(2026, 7, 2, 2, tick)).toISOString(),
    environment: {
      stormIntensityPct: 72,
      dustOpacityPct: 64,
      solarIrradiancePct: 31,
      externalTemperatureC: -48,
      windSpeedMps: 22,
    },
    power: {
      solarOutputKw: 31,
      solarOutputPct: 38,
      dustDeratePct: 62,
      batteryChargePct: 71,
      batteryFlowKw: -8,
      busAvailableKw: 62,
      busDemandKw: 70,
    },
    lifeSupport: {
      oxygenGeneratorOutputPct: 74,
      oxygenReservePct: 82,
      cabinOxygenPct: 20.1,
      co2Ppm: 930,
      habitatPressureKPa: 99.8,
      allocatedPowerKw: 13,
    },
  };
  return { ...hashable, payloadHash: payloadHashFor(hashable) };
}

function rehash(value: AggregateTelemetry): AggregateTelemetry {
  const { payloadHash: _oldHash, ...hashable } = value;
  return { ...hashable, payloadHash: payloadHashFor(hashable) };
}

describe("versioned telemetry ingest", () => {
  it("accepts plain telemetry, creates one immutable snapshot, stamps projections, then commits the clock", async () => {
    const store = new InMemoryTwinStore(seed());
    const frame = telemetry();

    const result = await ingestTelemetryWithPorts(frame, store);

    expect(result).toEqual({ status: "committed", snapshotId: snapshotTwinId(runOne, 0) });
    const snapshot = await store.getTwin(result.snapshotId);
    expect(snapshot?.modelId).toBe("dtmi:ares7:TelemetrySnapshot;2");
    expect(snapshot?.properties).toMatchObject({
      scenarioRunId: runOne,
      tick: 0,
      snapshotVersion: frame.snapshotVersion,
      payloadHash: frame.payloadHash,
    });
    for (const id of projectionIds) {
      await expect(store.getTwin(id)).resolves.toMatchObject({
        properties: {
          scenarioRunId: runOne,
          tick: 0,
          snapshotVersion: frame.snapshotVersion,
          payloadHash: frame.payloadHash,
          sampleUtc: frame.sampleUtc,
        },
      });
    }
    await expect(store.getTwin("ares7-clock")).resolves.toMatchObject({
      properties: {
        scenarioRunId: runOne,
        tick: 0,
        committedSnapshotId: result.snapshotId,
      },
    });
    await expect(
      store.createTwin(result.snapshotId, "dtmi:ares7:TelemetrySnapshot;2", { payloadHash: "different" }),
    ).rejects.toBeInstanceOf(TwinConflictError);
  });

  it("accepts Base64-wrapped JSON", async () => {
    const store = new InMemoryTwinStore(seed());
    const body = Buffer.from(JSON.stringify(telemetry()), "utf8").toString("base64");
    await expect(ingestTelemetryWithPorts({ body }, store)).resolves.toMatchObject({ status: "committed" });
  });

  it.each([
    ["plain junk", { body: "this is not json" }],
    ["Base64 junk", { body: Buffer.from("still not json", "utf8").toString("base64") }],
  ])("rejects malformed %s", async (_label, body) => {
    await expect(ingestTelemetryWithPorts(body, new InMemoryTwinStore(seed()))).rejects.toBeInstanceOf(
      TelemetryValidationError,
    );
  });

  it("rejects unsupported schema versions", async () => {
    const frame = { ...telemetry(), schemaVersion: "1.0" };
    await expect(ingestTelemetryWithPorts(frame, new InMemoryTwinStore(seed()))).rejects.toThrow(
      "Unsupported telemetry schema",
    );
  });

  it.each([
    ["a non-UUID run ID", (frame: AggregateTelemetry) => ({ ...frame, scenarioRunId: "weekend-run" })],
    ["a negative tick", (frame: AggregateTelemetry) => ({ ...frame, tick: -1 })],
    ["a mismatched snapshot version", (frame: AggregateTelemetry) => ({ ...frame, snapshotVersion: "v2:nope:tick:0" })],
    ["a non-UTC sample time", (frame: AggregateTelemetry) => ({ ...frame, sampleUtc: "2026-08-02T09:00:00+07:00" })],
  ])("rejects telemetry with %s", async (_label, change) => {
    await expect(
      ingestTelemetryWithPorts(change(telemetry()), new InMemoryTwinStore(seed())),
    ).rejects.toBeInstanceOf(TelemetryValidationError);
  });

  it("rejects invalid ranges before writing", async () => {
    const frame = telemetry();
    frame.environment.stormIntensityPct = 101;
    const store = new InMemoryTwinStore(seed());
    await expect(ingestTelemetryWithPorts(frame, store)).rejects.toThrow("stormIntensityPct");
    await expect(store.getTwin(snapshotTwinId(runOne, 0))).resolves.toBeUndefined();
  });

  it("rejects an altered payload hash", async () => {
    const frame = { ...telemetry(), payloadHash: "0".repeat(64) };
    await expect(ingestTelemetryWithPorts(frame, new InMemoryTwinStore(seed()))).rejects.toThrow(
      "payloadHash does not match",
    );
  });

  it("treats an identical redelivery as a duplicate without advancing the ETag", async () => {
    const store = new InMemoryTwinStore(seed());
    const frame = telemetry();
    await ingestTelemetryWithPorts(frame, store);
    const before = await store.getTwin("ares7-clock");

    await expect(ingestTelemetryWithPorts(frame, store)).resolves.toMatchObject({ status: "duplicate" });
    expect((await store.getTwin("ares7-clock"))?.etag).toBe(before?.etag);
  });

  it("rejects a conflicting duplicate for the same run and tick", async () => {
    const store = new InMemoryTwinStore(seed());
    await ingestTelemetryWithPorts(telemetry(), store);
    const changed = telemetry();
    changed.environment.windSpeedMps = 23;

    await expect(ingestTelemetryWithPorts(rehash(changed), store)).rejects.toThrow(
      "conflicting duplicate",
    );
  });

  it("rejects a gap in an active run", async () => {
    const store = new InMemoryTwinStore(seed());
    await ingestTelemetryWithPorts(telemetry(runOne, 0), store);
    await expect(ingestTelemetryWithPorts(telemetry(runOne, 2), store)).rejects.toThrow("tick gap");
  });

  it("rejects a stale run after a newer run has started", async () => {
    const store = new InMemoryTwinStore(seed());
    await ingestTelemetryWithPorts(telemetry(runOne, 0), store);
    await ingestTelemetryWithPorts(telemetry(runTwo, 0), store);

    await expect(ingestTelemetryWithPorts(telemetry(runOne, 0), store)).rejects.toThrow("stale scenario run");
  });

  it("leaves the clock uncommitted after a partial projection failure and can safely retry", async () => {
    const store = new InMemoryTwinStore(seed(), [
      { operation: "update", twinId: "ares7-life-support", occurrence: 1 },
    ]);
    const frame = telemetry();

    await expect(ingestTelemetryWithPorts(frame, store)).rejects.toThrow("Injected failure");
    expect((await store.getTwin("ares7-clock"))?.properties.tick).toBe(-1);
    expect((await store.getTwin("ares7-environment"))?.properties.tick).toBe(0);
    expect((await store.getTwin("ares7-life-support"))?.properties.tick).toBe(-1);
    await expect(store.getTwin(snapshotTwinId(runOne, 0))).resolves.toBeDefined();

    await expect(ingestTelemetryWithPorts(frame, store)).resolves.toMatchObject({ status: "committed" });
  });

  it("surfaces an ETag conflict when another writer wins the clock commit", async () => {
    const backing = new InMemoryTwinStore(seed());
    let raceOnce = true;
    const racingStore: TwinStore = {
      getTwin: (id) => backing.getTwin(id),
      createTwin: (id, modelId, properties) => backing.createTwin(id, modelId, properties),
      updateTwin: async (id, properties, options) => {
        if (id === "ares7-clock" && options?.ifMatch && raceOnce) {
          raceOnce = false;
          await backing.updateTwin(id, { competingWriter: true });
        }
        return backing.updateTwin(id, properties, options);
      },
    };

    await expect(ingestTelemetryWithPorts(telemetry(), racingStore)).rejects.toBeInstanceOf(TwinConflictError);
    expect((await backing.getTwin("ares7-clock"))?.properties.tick).toBe(-1);
    await expect(backing.getTwin(snapshotTwinId(runOne, 0))).resolves.toBeDefined();
  });
});
