import { readFile } from "node:fs/promises";

const [corePath, integrationPath] = process.argv.slice(2);
if (!corePath || !integrationPath) {
  throw new Error(
    "usage: node scripts/validate-infra.mjs <core-arm.json> <integration-arm.json>",
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
