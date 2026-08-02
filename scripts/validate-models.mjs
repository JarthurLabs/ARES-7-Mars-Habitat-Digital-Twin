import { readFile } from "node:fs/promises";

const models = JSON.parse(await readFile(new URL("../models/ares7-models.json", import.meta.url), "utf8"));
const graph = JSON.parse(await readFile(new URL("../models/twin-graph.json", import.meta.url), "utf8"));

const requiredSnapshotProperties = new Set([
  "schemaVersion",
  "messageType",
  "scenarioRunId",
  "tick",
  "snapshotVersion",
  "payloadHash",
  "simulatedMinute",
  "sampleUtc",
]);

if (!Array.isArray(models) || models.length !== 9) {
  throw new Error(`expected 9 DTDL interfaces, found ${models.length}`);
}

const modelIds = new Set();
for (const model of models) {
  if (model["@context"] !== "dtmi:dtdl:context;2") {
    throw new Error(`${model["@id"] ?? "unknown model"} is not DTDL v2`);
  }
  if (typeof model["@id"] !== "string" || !model["@id"].endsWith(";2")) {
    throw new Error(`${model["@id"] ?? "unknown model"} does not use interface version 2`);
  }
  if (modelIds.has(model["@id"])) throw new Error(`duplicate model ${model["@id"]}`);
  modelIds.add(model["@id"]);

  const contentNames = new Set();
  for (const content of model.contents ?? []) {
    if (contentNames.has(content.name)) throw new Error(`${model["@id"]} repeats ${content.name}`);
    contentNames.add(content.name);
  }
}

for (const model of models) {
  for (const content of model.contents ?? []) {
    if (content["@type"] === "Relationship" && content.target && !modelIds.has(content.target)) {
      throw new Error(`${model["@id"]}.${content.name} targets missing model ${content.target}`);
    }
  }
}

const snapshotModel = models.find((model) => model["@id"] === "dtmi:ares7:TelemetrySnapshot;2");
if (!snapshotModel) throw new Error("TelemetrySnapshot;2 is missing");
for (const propertyName of requiredSnapshotProperties) {
  const property = snapshotModel.contents.find((content) => content.name === propertyName);
  if (!property) throw new Error(`TelemetrySnapshot;2 is missing ${propertyName}`);
  if (property.writable === true) throw new Error(`TelemetrySnapshot;2.${propertyName} must be immutable`);
}

for (const twin of graph.twins ?? []) {
  if (!modelIds.has(twin.model)) throw new Error(`${twin.id} references missing model ${twin.model}`);
}

const twinIds = new Set((graph.twins ?? []).map((twin) => twin.id));
for (const relationship of graph.relationships ?? []) {
  if (!twinIds.has(relationship.source) || !twinIds.has(relationship.target)) {
    throw new Error(`${relationship.id} references a missing graph twin`);
  }
}

console.log(`validated ${models.length} DTDL v2 interfaces and ${graph.twins.length} base twins`);
