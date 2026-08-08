import { existsSync } from "node:fs";
import {
  assertAzureAccount,
  expectedResourceGroup,
  findSingleResourceName,
  handleFailure,
  requireExactConfirmation,
  runAzure,
  runAzureJson,
  validateScope,
} from "./common.mjs";

const routeName = "ares7-controller-updates";
const endpointName = "ares7-controller-topic";
const routeFilter = "type = 'Microsoft.DigitalTwins.Twin.Update' AND (subject = 'ares7-clock' OR subject = 'ares7-habitat')";

try {
  const scope = validateScope(process.env, "write");
  requireExactConfirmation(
    process.env,
    "ARES7_CONFIRM_EVENT_WIRING",
    `wire-${expectedResourceGroup}`,
  );
  const wiringTemplate = new URL(
    "../../infra/event-wiring.bicep",
    import.meta.url,
  );
  if (!existsSync(wiringTemplate)) {
    throw new Error(
      "infra/event-wiring.bicep must be reviewed and committed during the live-scenario milestone",
    );
  }
  assertAzureAccount(scope);
  const functionAppName = findSingleResourceName(
    scope,
    "Microsoft.Web/sites",
    "func-ares7-",
  );
  const functions = runAzureJson(scope, [
    "functionapp",
    "function",
    "list",
    "--resource-group",
    scope.resourceGroup,
    "--name",
    functionAppName,
    "--query",
    "[].name",
  ]).map((name) => String(name).split("/").at(-1));
  for (const required of ["ingestTelemetry", "emergencyController"]) {
    if (!functions.includes(required)) {
      throw new Error(`event wiring requires deployed Function ${required}`);
    }
  }
  runAzure(scope, [
    "deployment",
    "group",
    "validate",
    "--resource-group",
    scope.resourceGroup,
    "--template-file",
    "infra/event-wiring.bicep",
  ]);
  runAzure(scope, [
    "deployment",
    "group",
    "what-if",
    "--resource-group",
    scope.resourceGroup,
    "--template-file",
    "infra/event-wiring.bicep",
    "--no-pretty-print",
  ]);
  runAzure(scope, [
    "deployment",
    "group",
    "create",
    "--name",
    "ares7-event-wiring",
    "--resource-group",
    scope.resourceGroup,
    "--template-file",
    "infra/event-wiring.bicep",
  ]);
  const digitalTwinsName = findSingleResourceName(
    scope,
    "Microsoft.DigitalTwins/digitalTwinsInstances",
    "adt-ares7-",
  );
  runAzure(scope, [
    "dt",
    "endpoint",
    "wait",
    "--dt-name",
    digitalTwinsName,
    "--resource-group",
    scope.resourceGroup,
    "--endpoint-name",
    endpointName,
    "--created",
    "--interval",
    "10",
    "--timeout",
    "180",
  ]);
  const routes = runAzureJson(scope, [
    "dt",
    "route",
    "list",
    "--dt-name",
    digitalTwinsName,
    "--resource-group",
    scope.resourceGroup,
  ]);
  const existing = routes.find((route) => route.id === routeName);
  if (!existing) {
    runAzure(scope, [
      "dt",
      "route",
      "create",
      "--dt-name",
      digitalTwinsName,
      "--resource-group",
      scope.resourceGroup,
      "--route-name",
      routeName,
      "--endpoint-name",
      endpointName,
      "--filter",
      routeFilter,
      "--output",
      "none",
    ]);
  } else if (existing.endpointName !== endpointName || existing.filter !== routeFilter) {
    throw new Error(`${routeName} exists with drift; refusing to delete or replace it automatically`);
  }
  const verified = runAzureJson(scope, [
    "dt",
    "route",
    "show",
    "--dt-name",
    digitalTwinsName,
    "--resource-group",
    scope.resourceGroup,
    "--route-name",
    routeName,
  ]);
  if (verified.endpointName !== endpointName || verified.filter !== routeFilter) {
    throw new Error(`route verification failed for ${routeName}`);
  }
  console.log(`verified narrow Azure Digital Twins route ${routeName}`);
} catch (error) {
  handleFailure(error);
}
