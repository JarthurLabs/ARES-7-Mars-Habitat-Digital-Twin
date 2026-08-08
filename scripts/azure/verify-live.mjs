import {
  assertAzureAccount,
  findSingleResourceName,
  handleFailure,
  run,
  runAzure,
  runAzureJson,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "read");
  assertAzureAccount(scope);
  runAzure(scope, [
    "resource",
    "list",
    "--resource-group",
    scope.resourceGroup,
    "--output",
    "table",
  ]);
  runAzure(scope, [
    "functionapp",
    "list",
    "--resource-group",
    scope.resourceGroup,
    "--query",
    "[].{name:name,state:state,kind:kind}",
    "--output",
    "table",
  ]);
  runAzure(scope, [
    "eventgrid",
    "event-subscription",
    "list",
    "--resource-group",
    scope.resourceGroup,
    "--output",
    "table",
  ]);
  const functionAppName = findSingleResourceName(scope, "Microsoft.Web/sites", "func-ares7-");
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
  for (const required of ["ingestTelemetry", "emergencyController", "negotiateViewer"]) {
    if (!functions.includes(required)) throw new Error(`missing deployed Function ${required}`);
  }
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
  const route = runAzureJson(scope, [
    "dt",
    "route",
    "show",
    "--dt-name",
    digitalTwinsName,
    "--resource-group",
    scope.resourceGroup,
    "--route-name",
    "ares7-controller-updates",
  ]);
  if (
    route.endpointName !== "ares7-controller-topic" ||
    route.filter !==
      "type = 'Microsoft.DigitalTwins.Twin.Update' AND (subject = 'ares7-clock' OR subject = 'ares7-habitat')"
  ) {
    throw new Error("Azure Digital Twins route target or filter has drift");
  }
  run("npm", ["--prefix", "functions", "run", "verify:graph"], {
    env: { AZURE_DIGITAL_TWINS_ENDPOINT: `https://${hostName}` },
  });
} catch (error) {
  handleFailure(error);
}
