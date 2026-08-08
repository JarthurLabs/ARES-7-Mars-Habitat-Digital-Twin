import {
  assertAzureAccount,
  handleFailure,
  run,
  runAzure,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "read");
  assertAzureAccount(scope);
  runAzure(scope, [
    "group",
    "show",
    "--name",
    scope.resourceGroup,
    "--output",
    "table",
  ]);
  run("az", [
    "bicep",
    "build",
    "--file",
    "infra/main.bicep",
    "--outfile",
    "/tmp/ares7-core.json",
  ]);
  run("az", [
    "bicep",
    "build",
    "--file",
    "infra/integration.bicep",
    "--outfile",
    "/tmp/ares7-integration.json",
  ]);
  run("az", [
    "bicep",
    "build",
    "--file",
    "infra/event-wiring.bicep",
    "--outfile",
    "/tmp/ares7-event-wiring.json",
  ]);
  run("node", [
    "scripts/validate-infra.mjs",
    "/tmp/ares7-core.json",
    "/tmp/ares7-integration.json",
    "/tmp/ares7-event-wiring.json",
  ]);
  runAzure(scope, [
    "deployment",
    "group",
    "validate",
    "--resource-group",
    scope.resourceGroup,
    "--template-file",
    "infra/integration.bicep",
    "--parameters",
    "enableEventWiring=false",
  ]);
  runAzure(scope, [
    "deployment",
    "group",
    "what-if",
    "--resource-group",
    scope.resourceGroup,
    "--template-file",
    "infra/integration.bicep",
    "--parameters",
    "enableEventWiring=false",
    "--no-pretty-print",
  ]);
} catch (error) {
  handleFailure(error);
}
