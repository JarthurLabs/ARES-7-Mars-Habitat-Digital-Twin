import {
  assertAzureAccount,
  expectedResourceGroup,
  handleFailure,
  runAzure,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "cleanup");
  assertAzureAccount(scope);
  runAzure(scope, [
    "group",
    "show",
    "--name",
    expectedResourceGroup,
    "--output",
    "table",
  ]);
  runAzure(scope, ["group", "delete", "--name", expectedResourceGroup, "--yes"]);
  const exists = runAzure(
    scope,
    ["group", "exists", "--name", expectedResourceGroup],
    { capture: true },
  );
  if (exists !== "false")
    throw new Error(`cleanup verification returned ${exists}`);
  console.log(`verified deletion of ${expectedResourceGroup}`);
} catch (error) {
  handleFailure(error);
}
