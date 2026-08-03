import {
  assertAzureAccount,
  handleFailure,
  run,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "read");
  assertAzureAccount(scope);
  run("az", [
    "resource",
    "list",
    "--resource-group",
    scope.resourceGroup,
    "--output",
    "table",
  ]);
  run("az", [
    "functionapp",
    "list",
    "--resource-group",
    scope.resourceGroup,
    "--query",
    "[].{name:name,state:state,kind:kind}",
    "--output",
    "table",
  ]);
  run("az", [
    "eventgrid",
    "event-subscription",
    "list",
    "--resource-group",
    scope.resourceGroup,
    "--output",
    "table",
  ]);
  run("npm", ["--prefix", "functions", "run", "verify:graph"]);
} catch (error) {
  handleFailure(error);
}
