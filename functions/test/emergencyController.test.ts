import { describe, expect, it } from "vitest";
import type { EventGridEvent } from "@azure/functions";
import type { AggregateTelemetry } from "../src/contracts.js";
import {
  SnapshotIntegrityError,
  controllerEventTarget,
  emergencyControllerWithPorts,
  type BroadcastPort,
} from "../src/emergencyController.js";
import { ingestTelemetryWithPorts, payloadHashFor, snapshotTwinId } from "../src/ingestTelemetry.js";
import {
  InMemoryTwinStore,
  TwinConflictError,
  type TwinRecord,
  type TwinStore,
} from "../src/twinStore.js";

const runId = "33333333-3333-4333-8333-333333333333";
const actuatorIds = [
  "ares7-module-lab",
  "ares7-module-greenhouse",
  "ares7-airlock-main",
  "ares7-battery-alpha",
  "ares7-life-support",
] as const;

function twin(id: string, properties: Record<string, unknown>, modelId?: string): TwinRecord {
  return { id, modelId, properties, etag: '"1"' };
}

function seed(): TwinRecord[] {
  const stamp = {
    scenarioRunId: "not-started",
    tick: -1,
    snapshotVersion: "not-committed",
    payloadHash: "0".repeat(64),
    sampleUtc: "2026-08-03T00:00:00.000Z",
  };
  return [
    twin("ares7-clock", { ...stamp, committedSnapshotId: "none", simulatedMinute: 0 }),
    twin("ares7-habitat", {
      operationalState: "NOMINAL",
      scenarioRunId: "not-started",
      snapshotVersion: "not-committed",
      payloadHash: "0".repeat(64),
      lastProcessedTick: -1,
      simulatedMinute: 0,
      alarmLevel: "NONE",
      activeIncident: "NONE",
      controllerAction: "MONITOR",
      operatorDecision: "NONE",
      decisionId: "none",
      decisionScenarioRunId: "not-started",
      decisionTick: -1,
      lastDecisionId: "none",
      lastActionId: "none",
      lastActionSource: "none",
      lastBroadcastActionId: "none",
      recoveryStableTicks: 0,
      resolvedStableTicks: 0,
      totalLoadKw: 34,
    }),
    twin("ares7-environment", { ...stamp, dustOpacityPct: 5 }),
    twin("ares7-solar-alpha", { ...stamp, outputPct: 86 }),
    twin("ares7-battery-alpha", {
      ...stamp,
      chargePct: 92,
      nonCriticalLoadShed: false,
      lastActionId: "none",
    }),
    twin("ares7-life-support", {
      ...stamp,
      oxygenGeneratorOutputPct: 100,
      oxygenReservePct: 96,
      priorityMode: false,
      lastActionId: "none",
    }),
    twin("ares7-module-command", { ...stamp, powerDemandKw: 8 }),
    twin("ares7-module-crew", { ...stamp, powerDemandKw: 9 }),
    twin("ares7-module-lab", {
      ...stamp,
      operationalState: "NOMINAL",
      isolated: false,
      powerDemandKw: 7,
      lastActionId: "none",
    }),
    twin("ares7-module-greenhouse", {
      ...stamp,
      operationalState: "NOMINAL",
      isolated: false,
      powerDemandKw: 6,
      lastActionId: "none",
    }),
    twin("ares7-airlock-main", {
      status: "READY",
      sealed: false,
      lastActionId: "none",
    }),
  ];
}

function telemetry(tick: number): AggregateTelemetry {
  const frame = [
    { dust: 40, solar: 60, battery: 88, generator: 96, reserve: 95 },
    { dust: 82, solar: 10, battery: 55, generator: 80, reserve: 90 },
    { dust: 91, solar: 8, battery: 50, generator: 40, reserve: 80 },
  ][tick];
  if (!frame) throw new RangeError("test tick is out of range");
  const hashable: Omit<AggregateTelemetry, "payloadHash"> = {
    schemaVersion: "2.0",
    messageType: "ares7.aggregateTelemetry",
    scenarioRunId: runId,
    tick,
    snapshotVersion: `v2:${runId}:tick:${tick}`,
    simulatedMinute: tick * 30,
    sampleUtc: new Date(Date.UTC(2026, 7, 3, 2, tick)).toISOString(),
    environment: {
      stormIntensityPct: frame.dust,
      dustOpacityPct: frame.dust,
      solarIrradiancePct: frame.solar,
      externalTemperatureC: -48,
      windSpeedMps: 24,
    },
    power: {
      solarOutputKw: frame.solar,
      solarOutputPct: frame.solar,
      dustDeratePct: 100 - frame.solar,
      batteryChargePct: frame.battery,
      batteryFlowKw: -8,
      busAvailableKw: 60,
      busDemandKw: 70,
    },
    lifeSupport: {
      oxygenGeneratorOutputPct: frame.generator,
      oxygenReservePct: frame.reserve,
      cabinOxygenPct: 20.1,
      co2Ppm: 930,
      habitatPressureKPa: 99.8,
      allocatedPowerKw: 13,
    },
  };
  return { ...hashable, payloadHash: payloadHashFor(hashable) };
}

function event(twinId: string, eventType = "Microsoft.DigitalTwins.Twin.Update"): EventGridEvent {
  return {
    id: `event-${twinId}`,
    eventType,
    subject: `digitaltwins/${twinId}`,
    data: { $dtId: twinId },
    eventTime: "2026-08-03T02:00:00.000Z",
    dataVersion: "1.0",
    metadataVersion: "1",
    topic: "/subscriptions/test/resourceGroups/test/providers/Microsoft.DigitalTwins/digitalTwinsInstances/ares7",
  };
}

class RecordingBroadcaster implements BroadcastPort {
  readonly messages: Array<Readonly<Record<string, unknown>>> = [];
  failures = 0;

  async send(message: Readonly<Record<string, unknown>>): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("Injected Web PubSub failure");
    }
    this.messages.push(structuredClone(message));
  }
}

async function committedStore(): Promise<InMemoryTwinStore> {
  const store = new InMemoryTwinStore(seed());
  for (let tick = 0; tick <= 2; tick += 1) await ingestTelemetryWithPorts(telemetry(tick), store);
  return store;
}

async function riskStore(): Promise<InMemoryTwinStore> {
  const store = await committedStore();
  await emergencyControllerWithPorts(event("ares7-clock"), store, undefined, undefined, () => "2026-08-03T02:01:00.000Z");
  return store;
}

async function approve(store: TwinStore, decisionId = "decision-final-tick"): Promise<void> {
  const habitat = await store.getTwin("ares7-habitat");
  if (!habitat) throw new Error("missing habitat");
  await store.updateTwin(
    "ares7-habitat",
    {
      operatorDecision: "APPROVED",
      decisionId,
      decisionScenarioRunId: runId,
      decisionTick: 2,
    },
    { ifMatch: habitat.etag },
  );
}

describe("controller Function orchestration", () => {
  it("filters Event Grid traffic before reading controller state", async () => {
    expect(controllerEventTarget(event("ares7-clock"))).toBe("clock");
    expect(controllerEventTarget(event("ares7-habitat"))).toBe("approval");
    expect(controllerEventTarget(event("ares7-module-lab"))).toBe("ignored");
    expect(controllerEventTarget(event("ares7-clock", "Microsoft.Storage.BlobCreated"))).toBe("ignored");

    const result = await emergencyControllerWithPorts(
      event("ares7-module-lab"),
      new InMemoryTwinStore(),
    );
    expect(result.status).toBe("ignored");
  });

  it("loads exact immutable snapshots and catches up every missing transition in order", async () => {
    const store = await committedStore();
    const broadcaster = new RecordingBroadcaster();

    const result = await emergencyControllerWithPorts(
      event("ares7-clock"),
      store,
      broadcaster,
      undefined,
      () => "2026-08-03T02:02:00.000Z",
    );

    expect(result.actions).toEqual([
      `${runId}:tick:0:telemetry`,
      `${runId}:tick:1:telemetry`,
      `${runId}:tick:2:telemetry`,
    ]);
    await expect(store.getTwin("ares7-habitat")).resolves.toMatchObject({
      properties: {
        operationalState: "LIFE_SUPPORT_RISK",
        operatorDecision: "PENDING",
        lastProcessedTick: 2,
        snapshotVersion: `v2:${runId}:tick:2`,
        payloadHash: telemetry(2).payloadHash,
      },
    });
    expect(broadcaster.messages.map((message) => message.controllerState)).toEqual([
      "STORM_WARNING",
      "POWER_CRITICAL",
      "LIFE_SUPPORT_RISK",
    ]);
    expect(broadcaster.messages.at(-1)).toMatchObject({
      source: "azure-live",
      scenarioRunId: runId,
      tick: 2,
      snapshotVersion: `v2:${runId}:tick:2`,
      controllerState: "LIFE_SUPPORT_RISK",
      telemetry: {
        missionSecond: 24,
        phase: "degraded",
        solarOutputKw: 8,
        solarOutputPercent: 8,
        batteryPercent: 50,
        oxygenPercent: 20.1,
        oxygenGeneratorOutputPercent: 40,
        oxygenReservePercent: 80,
        habitatPressureKpa: 99.8,
        co2Ppm: 930,
        dustOpacityPercent: 91,
        commsLatencyMs: 180,
        externalTemperatureC: -48,
        crewLoadKw: 17,
        lifeSupportLoadKw: 13,
        nonessentialLoadKw: 13,
        airlockSealed: false,
        greenhouseIsolated: false,
        loadSheddingActive: false,
        emergencyBusActive: false,
      },
    });
  });

  it("rejects a clock that names the wrong immutable snapshot", async () => {
    const store = await committedStore();
    const clock = await store.getTwin("ares7-clock");
    if (!clock) throw new Error("missing clock");
    await store.updateTwin(
      "ares7-clock",
      { committedSnapshotId: snapshotTwinId(runId, 1) },
      { ifMatch: clock.etag },
    );
    await expect(emergencyControllerWithPorts(event("ares7-clock"), store)).rejects.toBeInstanceOf(
      SnapshotIntegrityError,
    );
  });

  it("rejects a modified snapshot even when its run and tick still look right", async () => {
    const store = await committedStore();
    const id = snapshotTwinId(runId, 1);
    const snapshot = await store.getTwin(id);
    if (!snapshot) throw new Error("missing snapshot");
    await store.updateTwin(id, { solarOutputPct: 99 }, { ifMatch: snapshot.etag });
    await expect(emergencyControllerWithPorts(event("ares7-clock"), store)).rejects.toThrow(
      "payloadHash does not match",
    );
  });

  it("uses a separate decision and action ID so approval after the final tick enters containment", async () => {
    const store = await riskStore();
    const telemetryAction = (await store.getTwin("ares7-habitat"))?.properties.lastActionId;
    await approve(store);
    const broadcaster = new RecordingBroadcaster();

    const result = await emergencyControllerWithPorts(event("ares7-habitat"), store, broadcaster);

    expect(result.status).toBe("processed");
    expect(result.actions).toEqual([`${runId}:tick:2:decision:decision-final-tick`]);
    expect(result.actions[0]).not.toBe(telemetryAction);
    await expect(store.getTwin("ares7-habitat")).resolves.toMatchObject({
      properties: {
        operationalState: "CONTAINMENT",
        lastProcessedTick: 2,
        lastDecisionId: "decision-final-tick",
        lastActionSource: "approval",
      },
    });
    expect(broadcaster.messages).toHaveLength(1);
  });

  it("ignores stale and duplicate approvals and its own habitat update loop", async () => {
    const store = await riskStore();
    const habitat = await store.getTwin("ares7-habitat");
    if (!habitat) throw new Error("missing habitat");
    await store.updateTwin(
      "ares7-habitat",
      {
        operatorDecision: "APPROVED",
        decisionId: "stale-decision",
        decisionScenarioRunId: runId,
        decisionTick: 1,
      },
      { ifMatch: habitat.etag },
    );
    await expect(emergencyControllerWithPorts(event("ares7-habitat"), store)).resolves.toMatchObject({
      status: "ignored",
    });
    expect((await store.getTwin("ares7-habitat"))?.properties.operationalState).toBe("LIFE_SUPPORT_RISK");

    await approve(store, "fresh-decision");
    await emergencyControllerWithPorts(event("ares7-habitat"), store);
    await expect(emergencyControllerWithPorts(event("ares7-habitat"), store)).resolves.toMatchObject({
      status: "ignored",
    });
  });

  it.each(actuatorIds)("resumes safely after an injected %s write failure", async (failedTwinId) => {
    const store = await riskStore();
    await approve(store);
    store.injectFailure({ operation: "update", twinId: failedTwinId, occurrence: 1 });

    await expect(emergencyControllerWithPorts(event("ares7-habitat"), store)).rejects.toThrow(
      "Injected failure",
    );
    expect((await store.getTwin("ares7-habitat"))?.properties.operationalState).toBe("LIFE_SUPPORT_RISK");

    await expect(emergencyControllerWithPorts(event("ares7-habitat"), store)).resolves.toMatchObject({
      status: "processed",
    });
    const actionId = `${runId}:tick:2:decision:decision-final-tick`;
    for (const id of actuatorIds) {
      expect((await store.getTwin(id))?.properties.lastActionId).toBe(actionId);
    }
    expect((await store.getTwin("ares7-habitat"))?.properties.operationalState).toBe("CONTAINMENT");
  });

  it("surfaces a habitat approval race, then converges without repeating actuator commands", async () => {
    const backing = await riskStore();
    await approve(backing, "racing-decision");
    let raceOnce = true;
    const racingStore: TwinStore = {
      getTwin: (id) => backing.getTwin(id),
      createTwin: (id, modelId, properties) => backing.createTwin(id, modelId, properties),
      updateTwin: async (id, properties, options) => {
        if (id === "ares7-habitat" && properties.lastActionId && options?.ifMatch && raceOnce) {
          raceOnce = false;
          await backing.updateTwin(id, { competingWriter: true });
        }
        return backing.updateTwin(id, properties, options);
      },
    };

    await expect(emergencyControllerWithPorts(event("ares7-habitat"), racingStore)).rejects.toBeInstanceOf(
      TwinConflictError,
    );
    const beforeRetry = await Promise.all(actuatorIds.map((id) => backing.getTwin(id)));
    await emergencyControllerWithPorts(event("ares7-habitat"), backing);
    const afterRetry = await Promise.all(actuatorIds.map((id) => backing.getTwin(id)));
    expect(afterRetry.map((record) => record?.etag)).toEqual(beforeRetry.map((record) => record?.etag));
    expect((await backing.getTwin("ares7-habitat"))?.properties.operationalState).toBe("CONTAINMENT");
  });

  it("keeps authoritative state after Web PubSub fails and retries only the broadcast", async () => {
    const store = await riskStore();
    await approve(store, "pubsub-decision");
    const broadcaster = new RecordingBroadcaster();
    broadcaster.failures = 1;

    await expect(
      emergencyControllerWithPorts(event("ares7-habitat"), store, broadcaster),
    ).rejects.toThrow("Injected Web PubSub failure");
    const authoritative = await store.getTwin("ares7-habitat");
    expect(authoritative?.properties.operationalState).toBe("CONTAINMENT");
    expect(authoritative?.properties.lastBroadcastActionId).not.toBe(authoritative?.properties.lastActionId);
    const actuatorEtags = await Promise.all(actuatorIds.map(async (id) => (await store.getTwin(id))?.etag));

    await expect(
      emergencyControllerWithPorts(event("ares7-habitat"), store, broadcaster),
    ).resolves.toMatchObject({ status: "broadcast-retried" });
    expect(await Promise.all(actuatorIds.map(async (id) => (await store.getTwin(id))?.etag))).toEqual(
      actuatorEtags,
    );
    const completed = await store.getTwin("ares7-habitat");
    expect(completed?.properties.lastBroadcastActionId).toBe(completed?.properties.lastActionId);
    expect(broadcaster.messages).toHaveLength(1);
  });
});
