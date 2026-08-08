import { readFile } from "node:fs/promises";

const wiring = await readFile("infra/event-wiring.bicep", "utf8");
const integration = await readFile("infra/integration.bicep", "utf8");
const functionHost = JSON.parse(await readFile("functions/host.json", "utf8"));

if (
  functionHost.extensionBundle?.id !== "Microsoft.Azure.Functions.ExtensionBundle" ||
  functionHost.extensionBundle?.version !== "[4.0.0, 5.0.0)"
) {
  throw new Error("functions/host.json must load the Azure Functions v4 extension bundle for Event Grid triggers");
}

for (const required of [
  "Microsoft.Devices.DeviceTelemetry",
  "devices/${deviceId}",
  "Microsoft.DigitalTwins.Twin.Update",
  "ares7-clock",
  "ares7-habitat",
  "StringIn",
  "key: 'Subject'",
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
  "scope: storage",
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

const liveScenario = await readFile("scripts/azure/run-live-scenario.mjs", "utf8");
if (!liveScenario.includes("runIdPattern.test(scenarioRunId)")) {
  throw new Error("run-live-scenario.mjs must reject scenario IDs that the telemetry contract cannot ingest");
}

const deviceProvisioning = await readFile("scripts/azure/provision-device.mjs", "utf8");
for (const required of [
  '"connection-string"',
  "deviceIdMatches:contains(connectionString",
  "hasSharedAccessKey:contains(connectionString",
  "hasSharedAccessKeyName:contains(connectionString",
]) {
  if (!deviceProvisioning.includes(required)) {
    throw new Error(`provision-device.mjs lost secret-free credential check ${required}`);
  }
}
if (deviceProvisioning.includes("authentication.type")) {
  throw new Error("provision-device.mjs must not rely on the omitted list authentication.type field");
}

const sceneUpload = await readFile("scripts/azure/upload-scene-asset.mjs", "utf8");
for (const required of [
  "upload-ares7-3d-scenes-bundle",
  "allowBlobPublicAccess !== false",
  "allowSharedKeyAccess !== false",
  "defaultToOAuthAuthentication !== true",
  '"--auth-mode",\n      "login"',
  '"--overwrite",\n    "false"',
  "validateAres7SceneConfiguration",
  "SCENE_CONFIGURATION_BLOB_NAME",
]) {
  if (!sceneUpload.includes(required)) {
    throw new Error(`upload-scene-asset.mjs lost private bundle control ${required}`);
  }
}
for (const forbidden of ["generate-sas", "--account-key", "--sas-token", "--public-access"]) {
  if (sceneUpload.includes(forbidden)) {
    throw new Error(`upload-scene-asset.mjs contains forbidden storage option ${forbidden}`);
  }
}

const eventWiringScript = await readFile("scripts/azure/wire-events.mjs", "utf8");
for (const required of [
  '"endpoint",\n    "wait"',
  '"--created"',
  '"--interval"',
  '"--timeout"',
]) {
  if (!eventWiringScript.includes(required)) {
    throw new Error(`wire-events.mjs lost endpoint readiness control ${required}`);
  }
}
for (const forbidden of ["provisioningState", '"endpoint",\n      "delete"']) {
  if (eventWiringScript.includes(forbidden)) {
    throw new Error(`wire-events.mjs contains forbidden endpoint operation ${forbidden}`);
  }
}

const graphVerification = await readFile("functions/scripts/verifyGraph.mjs", "utf8");
for (const required of [
  "ARES7_REQUIRE_LIVE_COMPLETE",
  "verified-live-complete",
  "MONITOR_POST_INCIDENT",
  "lastBroadcastActionId",
]) {
  if (!graphVerification.includes(required)) {
    throw new Error(`verifyGraph.mjs lost strict live assertion ${required}`);
  }
}

const liveVerification = await readFile("scripts/azure/verify-live.mjs", "utf8");
for (const required of [
  "ares7-device-telemetry-to-ingest",
  "ares7-twin-updates-to-controller",
  "Microsoft.EventGrid/systemTopics",
  "Microsoft.EventGrid/topics",
  'topicCommand: "system-topic"',
  'topicCommand: "topic"',
  '"--system-topic-name"',
  '"--topic-name"',
  '"--include-full-endpoint-url"',
  '"--include-attrib-secret"',
  "assertExactEventSubscription",
]) {
  if (!liveVerification.includes(required)) {
    throw new Error(`verify-live.mjs lost exact secret-free Event Grid check ${required}`);
  }
}
if (/"event-subscription",\s*"list"/.test(liveVerification)) {
  throw new Error("verify-live.mjs must show each Event Grid subscription through its exact topic");
}
if (liveVerification.includes('"--source-resource-id"')) {
  throw new Error("verify-live.mjs must use the dedicated Event Grid topic read commands");
}

console.log("validated Day 6 event filters, live settings, and guarded Azure write entry points");
