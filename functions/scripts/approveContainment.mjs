import { DigitalTwinsClient } from "@azure/digital-twins-core";
import { DefaultAzureCredential } from "@azure/identity";
import { randomUUID } from "node:crypto";

const endpoint = process.env.AZURE_DIGITAL_TWINS_ENDPOINT;
if (!endpoint) throw new Error("AZURE_DIGITAL_TWINS_ENDPOINT is required.");
const client = new DigitalTwinsClient(endpoint, new DefaultAzureCredential());
const habitat = await client.getDigitalTwin("ares7-habitat");
const decisionId = randomUUID();

if (habitat.operationalState !== "LIFE_SUPPORT_RISK" || habitat.operatorDecision !== "PENDING") {
  throw new Error(
    `Approval refused: expected LIFE_SUPPORT_RISK/PENDING, found ${habitat.operationalState}/${habitat.operatorDecision}.`,
  );
}

await client.updateDigitalTwin(
  "ares7-habitat",
  [
    { op: "add", path: "/operatorDecision", value: "APPROVED" },
    { op: "add", path: "/decisionId", value: decisionId },
    { op: "add", path: "/decisionScenarioRunId", value: habitat.scenarioRunId },
    { op: "add", path: "/decisionTick", value: habitat.lastProcessedTick },
    { op: "add", path: "/controllerAction", value: "OPERATOR_APPROVED_CONTAINMENT" }
  ],
  { ifMatch: habitat.etag },
);

console.log(
  `containment decision ${decisionId} recorded for scenario ${habitat.scenarioRunId} at tick ${habitat.lastProcessedTick}`,
);
