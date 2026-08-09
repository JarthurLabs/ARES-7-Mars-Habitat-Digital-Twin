import {
  assertAzureAccount,
  expectedResourceGroup,
  handleFailure,
  requireExactConfirmation,
  runAzure,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "write");
  requireExactConfirmation(
    process.env,
    "ARES7_CONFIRM_INTEGRATION",
    `integration-reviewed-${expectedResourceGroup}`,
  );
  assertAzureAccount(scope);
  const deploymentArgs = [
    "deployment",
    "group",
    "--resource-group",
    scope.resourceGroup,
    "--template-file",
    "infra/integration.bicep",
    "--parameters",
    "enableEventWiring=false",
  ];
  runAzure(scope, ["deployment", "group", "validate", ...deploymentArgs.slice(2)]);
  runAzure(scope, [
    "deployment",
    "group",
    "what-if",
    ...deploymentArgs.slice(2),
    "--no-pretty-print",
  ]);
  runAzure(scope, [
    "deployment",
    "group",
    "create",
    "--name",
    "ares7-integration-live",
    ...deploymentArgs.slice(2),
  ]);
} catch (error) {
  handleFailure(error);
}
