import {
  assertAzureAccount,
  expectedResourceGroup,
  handleFailure,
  run,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "cleanup");
  assertAzureAccount(scope);
  run("az", [
    "group",
    "show",
    "--name",
    expectedResourceGroup,
    "--output",
    "table",
  ]);
  run("az", ["group", "delete", "--name", expectedResourceGroup, "--yes"]);
  const exists = run(
    "az",
    ["group", "exists", "--name", expectedResourceGroup],
    { capture: true },
  );
  if (exists !== "false")
    throw new Error(`cleanup verification returned ${exists}`);
  console.log(`verified deletion of ${expectedResourceGroup}`);
} catch (error) {
  handleFailure(error);
}
