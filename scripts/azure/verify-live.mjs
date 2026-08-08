import {
  assertAzureAccount,
  findSingleResourceName,
  handleFailure,
  run,
  runAzure,
  runAzureJson,
  validateScope,
} from "./common.mjs";

const verificationStage = process.env.ARES7_VERIFY_STAGE?.trim() || "post-run";
if (!new Set(["pre-run", "post-run"]).has(verificationStage)) {
  throw new Error("ARES7_VERIFY_STAGE must be pre-run or post-run");
}
const verificationAttempts = verificationStage === "post-run" ? 12 : 1;
const verificationDelayMs = 10_000;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  for (let attempt = 1; attempt <= verificationAttempts; attempt += 1) {
    try {
      run("npm", ["--prefix", "functions", "run", "verify:graph"], {
        env: {
          AZURE_DIGITAL_TWINS_ENDPOINT: `https://${hostName}`,
          ARES7_REQUIRE_LIVE_COMPLETE:
            verificationStage === "post-run" ? "true" : "false",
        },
      });
      break;
    } catch (error) {
      if (attempt === verificationAttempts) throw error;
      console.log(
        `live state is still converging; retrying verification (${attempt}/${verificationAttempts})`,
      );
      await delay(verificationDelayMs);
    }
  }
} catch (error) {
  handleFailure(error);
}
