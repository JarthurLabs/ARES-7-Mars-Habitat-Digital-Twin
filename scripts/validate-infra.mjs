import { readFile } from "node:fs/promises";

const [corePath, integrationPath, eventWiringPath] = process.argv.slice(2);
if (!corePath || !integrationPath) {
  throw new Error(
    "usage: node scripts/validate-infra.mjs <core-arm.json> <integration-arm.json> [event-wiring-arm.json]",
  );
}

const [core, integration] = await Promise.all(
  [corePath, integrationPath].map(async (path) =>
    JSON.parse(await readFile(path, "utf8")),
  ),
);

const coreText = JSON.stringify(core);
const integrationText = JSON.stringify(integration);

const requiredCoreGates = ["F1", "Free_F1", "Standard_LRS"];
for (const gate of requiredCoreGates) {
  if (!coreText.includes(gate))
    throw new Error(`core template lost cost gate ${gate}`);
}

const requiredIntegrationControls = [
  "FlexConsumption",
  "FC1",
  "event-dead-letter",
  "function-packages",
  "managedidentity",
  "Authorization=AAD",
  "bcd981a7-7f74-457b-83e1-cceb9e632ffe",
  "12cf5a90-567b-43ae-8102-96cf46c7d9b4",
];
for (const control of requiredIntegrationControls) {
  if (!integrationText.includes(control))
    throw new Error(`integration template lost control ${control}`);
}

const integrationResources = integration.resources ?? [];
const functionApp = integrationResources.find(
  (resource) => resource.type === "Microsoft.Web/sites",
);
const workspace = integrationResources.find(
  (resource) => resource.type === "Microsoft.OperationalInsights/workspaces",
);

if (!functionApp || !workspace) {
  throw new Error(
    "integration template must contain the Function App and Log Analytics workspace",
  );
}
if (integrationText.includes("alwaysReady")) {
  throw new Error(
    "always-ready instances are forbidden for this short evidence lab",
  );
}
if (
  functionApp.properties?.functionAppConfig?.scaleAndConcurrency
    ?.maximumInstanceCount !== 40
) {
  throw new Error(
    "Flex Consumption maximumInstanceCount must stay at the minimum supported value, 40",
  );
}
const dailyQuota = workspace.properties?.workspaceCapping?.dailyQuotaGb;
if (dailyQuota !== 0.1 && dailyQuota !== "[json('0.1')]") {
  throw new Error("Log Analytics daily cap must stay at 0.1 GB");
}
if (integration.parameters?.enableEventWiring?.defaultValue !== false) {
  throw new Error("event wiring must compile with a false default");
}
if (
  integrationResources.some((resource) =>
    resource.type?.includes("eventSubscriptions"),
  )
) {
  throw new Error(
    "event subscriptions must not exist before the live-scenario milestone",
  );
}

console.log(
  "validated core and integration ARM templates, cost gates, identity roles, and disabled event wiring",
);

if (eventWiringPath) {
  const eventWiring = JSON.parse(await readFile(eventWiringPath, "utf8"));
  const eventText = JSON.stringify(eventWiring);
  const requiredWiringControls = [
    "Microsoft.Devices.DeviceTelemetry",
    "Microsoft.DigitalTwins.Twin.Update",
    "ingestTelemetry",
    "emergencyController",
    "ares7-simulator",
    "ares7-clock",
    "ares7-habitat",
    "ares7-controller-updates",
    "StorageBlob",
    "UserAssigned",
    "StringIn",
  ];
  for (const control of requiredWiringControls) {
    if (!eventText.includes(control)) throw new Error(`event wiring lost control ${control}`);
  }
  if (/SharedAccessSignature|\?sv=|AccountKey=/i.test(eventText)) {
    throw new Error("event wiring must not contain a SAS or storage account key");
  }
  const resources = eventWiring.resources ?? [];
  const systemTopics = resources.filter(
    (resource) => resource.type === "Microsoft.EventGrid/systemTopics",
  );
  const eventSubscriptions = resources.filter((resource) =>
    resource.type?.endsWith("/eventSubscriptions"),
  );
  const endpoints = resources.filter(
    (resource) => resource.type === "Microsoft.DigitalTwins/digitalTwinsInstances/endpoints",
  );
  if (systemTopics.length !== 1 || eventSubscriptions.length !== 2 || endpoints.length !== 1) {
    throw new Error("event wiring must contain one IoT system topic, two subscriptions, and one Digital Twins endpoint");
  }
  if (systemTopics[0].properties?.topicType !== "Microsoft.Devices.IoTHubs") {
    throw new Error("the only system topic must be scoped to IoT Hub");
  }
  for (const subscription of eventSubscriptions) {
    const destination = subscription.properties?.destination;
    const retryReference = subscription.properties?.retryPolicy;
    const retry = retryReference === "[variables('retryPolicy')]"
      ? eventWiring.variables?.retryPolicy
      : retryReference;
    const deadLetter = subscription.properties?.deadLetterWithResourceIdentity;
    if (destination?.endpointType !== "AzureFunction" || destination.properties?.maxEventsPerBatch !== 1) {
      throw new Error("every event subscription must deliver single events to an Azure Function");
    }
    if (retry?.eventTimeToLiveInMinutes !== 60 || retry?.maxDeliveryAttempts !== 10) {
      throw new Error("every event subscription must retain the reviewed 60-minute/10-attempt policy");
    }
    if (
      deadLetter?.deadLetterDestination?.endpointType !== "StorageBlob" ||
      deadLetter?.identity?.type !== "UserAssigned"
    ) {
      throw new Error("every event subscription must use identity-based blob dead-lettering");
    }
  }
  console.log("validated narrow post-Function event wiring, filters, retry, and dead-letter controls");
}
