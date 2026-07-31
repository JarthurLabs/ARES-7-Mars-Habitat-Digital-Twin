import { DigitalTwinsClient } from "@azure/digital-twins-core";
import { DefaultAzureCredential } from "@azure/identity";

const endpoint = process.env.AZURE_DIGITAL_TWINS_ENDPOINT;
if (!endpoint) throw new Error("AZURE_DIGITAL_TWINS_ENDPOINT is required.");
const client = new DigitalTwinsClient(endpoint, new DefaultAzureCredential());
const habitat = await client.getDigitalTwin("ares7-habitat");

if (habitat.operationalState !== "LIFE_SUPPORT_RISK" || habitat.operatorDecision !== "PENDING") {
  throw new Error(
    `Approval refused: expected LIFE_SUPPORT_RISK/PENDING, found ${habitat.operationalState}/${habitat.operatorDecision}.`,
  );
}

await client.updateDigitalTwin(
  "ares7-habitat",
  [
    { op: "add", path: "/operatorDecision", value: "APPROVED" },
    { op: "add", path: "/controllerAction", value: "OPERATOR_APPROVED_CONTAINMENT" }
  ],
  { ifMatch: habitat.etag },
);

console.log(`containment approved for scenario ${habitat.scenarioRunId} after tick ${habitat.lastProcessedTick}`);
