import { readFile } from "node:fs/promises";

const wiring = await readFile("infra/event-wiring.bicep", "utf8");
const integration = await readFile("infra/integration.bicep", "utf8");

for (const required of [
  "Microsoft.Devices.DeviceTelemetry",
  "devices/${deviceId}",
  "Microsoft.DigitalTwins.Twin.Update",
  "ares7-clock",
  "ares7-habitat",
  "StringIn",
  "deadLetterWithResourceIdentity",
  "eventTimeToLiveInMinutes: 60",
  "maxDeliveryAttempts: 10",
  "/functions/ingestTelemetry",
  "/functions/emergencyController",
]) {
  if (!wiring.includes(required)) throw new Error(`event-wiring.bicep lost ${required}`);
}
for (const forbidden of ["SharedAccessSignature=", "AccountKey=", "@secure()"] ) {
  if (wiring.includes(forbidden)) throw new Error(`event wiring contains forbidden ${forbidden}`);
}
for (const required of [
  "AZURE_WEBPUBSUB_ENDPOINT",
  "AZURE_WEBPUBSUB_HUB: 'ares7'",
  "VIEWER_ALLOWED_ORIGINS",
  "https://jarthurlabs.github.io",
  "scope: deadLetterContainer",
]) {
  if (!integration.includes(required)) throw new Error(`integration.bicep lost ${required}`);
}

const guardedScripts = [
  "deploy-integration.mjs",
  "zip-deploy-functions.mjs",
  "bootstrap-graph.mjs",
  "provision-device.mjs",
  "wire-events.mjs",
  "run-live-scenario.mjs",
  "approve-containment.mjs",
  "upload-scene-asset.mjs",
];
for (const script of guardedScripts) {
  const source = await readFile(`scripts/azure/${script}`, "utf8");
  for (const required of [
    'validateScope(process.env, "write")',
    "assertAzureAccount(scope)",
    "requireExactConfirmation(",
  ]) {
    if (!source.includes(required)) throw new Error(`${script} lost guard ${required}`);
  }
}

console.log("validated Day 6 event filters, live settings, and guarded Azure write entry points");
