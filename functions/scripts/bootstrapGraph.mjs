import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DigitalTwinsClient } from "@azure/digital-twins-core";
import { DefaultAzureCredential } from "@azure/identity";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../..");
const endpoint = process.env.AZURE_DIGITAL_TWINS_ENDPOINT;
if (!endpoint) throw new Error("AZURE_DIGITAL_TWINS_ENDPOINT is required.");

const models = JSON.parse(await readFile(resolve(repoRoot, "models/ares7-models.json"), "utf8"));
const graph = JSON.parse(await readFile(resolve(repoRoot, "models/twin-graph.json"), "utf8"));
const client = new DigitalTwinsClient(endpoint, new DefaultAzureCredential());
const initialStamp = {
  scenarioRunId: "not-started",
  tick: -1,
  snapshotVersion: "not-committed",
  payloadHash: "0".repeat(64),
  sampleUtc: "2026-07-31T00:00:00.000Z"
};

const initial = {
  "ares7-habitat": {
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
    lastTransitionUtc: "2026-07-31T00:00:00.000Z",
    totalLoadKw: 34
  },
  "ares7-environment": {
    ...initialStamp,
    stormIntensityPct: 4,
    dustOpacityPct: 5,
    solarIrradiancePct: 86,
    externalTemperatureC: -42,
    windSpeedMps: 8
  },
  "ares7-solar-alpha": { ...initialStamp, status: "NOMINAL", outputKw: 82.4, outputPct: 86, dustDeratePct: 14 },
  "ares7-battery-alpha": { ...initialStamp, status: "NOMINAL", chargePct: 92, flowKw: 18, busAvailableKw: 82.4, busDemandKw: 34, nonCriticalLoadShed: false },
  "ares7-life-support": { ...initialStamp, status: "NOMINAL", oxygenGeneratorOutputPct: 100, oxygenReservePct: 96, cabinOxygenPct: 20.9, co2Ppm: 612, allocatedPowerKw: 14, priorityMode: false },
  "ares7-airlock-main": { status: "READY", sealed: false, pressureKPa: 101.2, lastActionId: "none", actionRunId: "not-started", actionTick: -1 },
  "ares7-module-command": { ...initialStamp, moduleType: "COMMAND", operationalState: "NOMINAL", priority: 1, isolated: false, occupied: true, powerDemandKw: 8, cabinOxygenPct: 20.9, pressureKPa: 101.2 },
  "ares7-module-crew": { ...initialStamp, moduleType: "CREW", operationalState: "NOMINAL", priority: 1, isolated: false, occupied: true, powerDemandKw: 9, cabinOxygenPct: 20.9, pressureKPa: 101.2 },
  "ares7-module-lab": { ...initialStamp, moduleType: "SCIENCE_LAB", operationalState: "NOMINAL", priority: 3, isolated: false, occupied: false, powerDemandKw: 7, cabinOxygenPct: 20.9, pressureKPa: 101.2 },
  "ares7-module-greenhouse": { ...initialStamp, moduleType: "GREENHOUSE", operationalState: "NOMINAL", priority: 4, isolated: false, occupied: false, powerDemandKw: 6, cabinOxygenPct: 20.9, pressureKPa: 101.2 },
  "ares7-clock": { ...initialStamp, committedSnapshotId: "none", simulatedMinute: 0 }
};

try {
  await client.createModels(models);
  console.log(`created ${models.length} models`);
} catch (error) {
  if (error?.statusCode !== 409) throw error;
  console.log("models already exist; continuing idempotently");
}

for (const twin of graph.twins) {
  const body = {
    $metadata: { $model: twin.model },
    ...(initial[twin.id] ?? {})
  };
  await client.upsertDigitalTwin(twin.id, JSON.stringify(body));
  console.log(`upserted twin ${twin.id}`);
}

for (const relationship of graph.relationships) {
  await client.upsertRelationship(relationship.source, relationship.id, {
    $relationshipId: relationship.id,
    $sourceId: relationship.source,
    $relationshipName: relationship.name,
    $targetId: relationship.target
  });
  console.log(`upserted relationship ${relationship.id}`);
}

console.log(`graph ready: ${graph.twins.length} twins, ${graph.relationships.length} relationships`);
