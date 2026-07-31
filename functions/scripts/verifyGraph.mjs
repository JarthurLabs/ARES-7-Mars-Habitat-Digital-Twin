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

const twins = [];
for await (const twin of client.queryTwins("SELECT * FROM DIGITALTWINS")) twins.push(twin);
const relationships = [];
for (const twin of expected.twins) {
  for await (const relationship of client.listRelationships(twin.id)) relationships.push(relationship);
}

const clock = await client.getDigitalTwin("ares7-clock");
const habitat = await client.getDigitalTwin("ares7-habitat");
const result = {
  endpoint,
  expectedTwins: expected.twins.length,
  actualTwins: twins.length,
  expectedRelationships: expected.relationships.length,
  actualRelationships: relationships.length,
  clock: { scenarioRunId: clock.scenarioRunId, tick: clock.tick },
  habitat: {
    state: habitat.operationalState,
    lastProcessedTick: habitat.lastProcessedTick,
    operatorDecision: habitat.operatorDecision,
    controllerAction: habitat.controllerAction
  },
  verifiedAtUtc: new Date().toISOString()
};

console.log(JSON.stringify(result, null, 2));
if (twins.length < expected.twins.length || relationships.length < expected.relationships.length) process.exitCode = 1;
