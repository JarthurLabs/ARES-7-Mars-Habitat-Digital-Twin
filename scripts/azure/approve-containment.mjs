import {
  assertAzureAccount,
  findSingleResourceName,
  handleFailure,
  requireExactConfirmation,
  run,
  runAzure,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "write");
  requireExactConfirmation(
    process.env,
    "ARES7_CONFIRM_APPROVAL",
    "approve-containment",
  );
  assertAzureAccount(scope);
  const digitalTwinsName = findSingleResourceName(
    scope,
    "Microsoft.DigitalTwins/digitalTwinsInstances",
    "adt-ares7-",
  );
  const hostName = runAzure(
    scope,
    [
      "dt",
      "show",
      "--dt-name",
      digitalTwinsName,
      "--resource-group",
      scope.resourceGroup,
      "--query",
      "hostName",
      "--output",
      "tsv",
    ],
    { capture: true },
  );
  run("npm", ["--prefix", "functions", "run", "approve:containment"], {
    env: { AZURE_DIGITAL_TWINS_ENDPOINT: `https://${hostName}` },
  });
} catch (error) {
  handleFailure(error);
}
