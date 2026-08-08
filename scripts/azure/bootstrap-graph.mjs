import {
  assertAzureAccount,
  expectedResourceGroup,
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
    "ARES7_CONFIRM_GRAPH_BOOTSTRAP",
    `graph-${expectedResourceGroup}`,
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
  if (!/^[-a-z0-9.]+\.digitaltwins\.azure\.net$/i.test(hostName)) {
    throw new Error(`unexpected Azure Digital Twins host ${hostName}`);
  }
  run("npm", ["--prefix", "functions", "run", "bootstrap:graph"], {
    env: { AZURE_DIGITAL_TWINS_ENDPOINT: `https://${hostName}` },
  });
  run("npm", ["--prefix", "functions", "run", "verify:graph"], {
    env: { AZURE_DIGITAL_TWINS_ENDPOINT: `https://${hostName}` },
  });
} catch (error) {
  handleFailure(error);
}
