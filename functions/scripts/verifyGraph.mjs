import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DigitalTwinsClient } from "@azure/digital-twins-core";
import { DefaultAzureCredential } from "@azure/identity";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../..");
const endpoint = process.env.AZURE_DIGITAL_TWINS_ENDPOINT;
if (!endpoint) throw new Error("AZURE_DIGITAL_TWINS_ENDPOINT is required.");
const expected = JSON.parse(await readFile(resolve(repoRoot, "models/twin-graph.json"), "utf8"));
const client = new DigitalTwinsClient(endpoint, new DefaultAzureCredential());
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requireLiveComplete = process.env.ARES7_REQUIRE_LIVE_COMPLETE === "true";

const twins = [];
for await (const twin of client.queryTwins("SELECT * FROM DIGITALTWINS")) twins.push(twin);
const relationships = [];
for (const twin of expected.twins) {
  for await (const relationship of client.listRelationships(twin.id)) relationships.push(relationship);
}

const clock = await client.getDigitalTwin("ares7-clock");
const habitat = await client.getDigitalTwin("ares7-habitat");
const failures = [];
const twinsById = new Map(twins.map((twin) => [twin.$dtId, twin]));
for (const twin of expected.twins) {
  const actual = twinsById.get(twin.id);
  if (!actual) failures.push(`missing base twin ${twin.id}`);
  else if (actual.$metadata?.$model !== twin.model) {
    failures.push(`${twin.id} uses ${actual.$metadata?.$model ?? "no model"}, expected ${twin.model}`);
  }
}
const relationshipsById = new Map(relationships.map((relationship) => [relationship.$relationshipId, relationship]));
for (const relationship of expected.relationships) {
  const actual = relationshipsById.get(relationship.id);
  if (!actual) {
    failures.push(`missing relationship ${relationship.id}`);
  } else if (
    actual.$sourceId !== relationship.source ||
    actual.$relationshipName !== relationship.name ||
    actual.$targetId !== relationship.target
  ) {
    failures.push(`relationship ${relationship.id} has drift`);
  }
}
if (relationships.length !== expected.relationships.length) {
  failures.push(
    `graph has ${relationships.length} relationships from base twins, expected exactly ${expected.relationships.length}`,
  );
}

const scenarioRunId = clock.scenarioRunId;
const runSnapshots = twins
  .filter(
    (twin) =>
      twin.$metadata?.$model === "dtmi:ares7:TelemetrySnapshot;2" &&
      twin.scenarioRunId === scenarioRunId,
  )
  .sort((left, right) => left.tick - right.tick);
if (requireLiveComplete) {
  if (typeof scenarioRunId !== "string" || !runIdPattern.test(scenarioRunId)) {
    failures.push("scenario clock does not contain a live scenario UUID");
  }
  if (clock.tick !== 11) failures.push(`scenario clock stopped at tick ${clock.tick}, expected 11`);
  if (
    runSnapshots.length !== 12 ||
    runSnapshots.some((snapshot, index) => snapshot.tick !== index)
  ) {
    failures.push(`scenario has ${runSnapshots.length} ordered immutable snapshots, expected ticks 0 through 11`);
  }
  if (habitat.scenarioRunId !== scenarioRunId || habitat.lastProcessedTick !== 11) {
    failures.push("habitat did not process the final committed scenario snapshot");
  }
  if (
    habitat.operationalState !== "RESOLVED" ||
    habitat.operatorDecision !== "APPROVED" ||
    habitat.controllerAction !== "MONITOR_POST_INCIDENT"
  ) {
    failures.push(
      `habitat ended ${habitat.operationalState}/${habitat.operatorDecision}/${habitat.controllerAction}, expected RESOLVED/APPROVED/MONITOR_POST_INCIDENT`,
    );
  }
  if (
    typeof habitat.decisionId !== "string" ||
    habitat.decisionId === "none" ||
    habitat.lastDecisionId !== habitat.decisionId
  ) {
    failures.push("the approved human decision was not reconciled exactly once");
  }
  if (
    typeof habitat.lastActionId !== "string" ||
    habitat.lastActionId !== habitat.lastBroadcastActionId
  ) {
    failures.push("the final authoritative state was not confirmed as broadcast");
  }
}
const result = {
  endpoint,
  expectedTwins: expected.twins.length,
  actualBaseTwins: expected.twins.filter((twin) => twinsById.has(twin.id)).length,
  scenarioSnapshotCount: runSnapshots.length,
  expectedRelationships: expected.relationships.length,
  actualRelationships: relationships.length,
  clock: { scenarioRunId: clock.scenarioRunId, tick: clock.tick },
  habitat: {
    state: habitat.operationalState,
    lastProcessedTick: habitat.lastProcessedTick,
    operatorDecision: habitat.operatorDecision,
    controllerAction: habitat.controllerAction
  },
  verifiedAtUtc: new Date().toISOString(),
  status:
    failures.length === 0
      ? requireLiveComplete
        ? "verified-live-complete"
        : "verified-graph"
      : "incomplete",
  failures,
};

console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
