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
const eventSubscriptions = [
  {
    sourceResourceType: "Microsoft.EventGrid/systemTopics",
    sourceNamePrefix: "egst-iot-ares7-",
    topicCommand: "system-topic",
    topicNameFlag: "--system-topic-name",
    name: "ares7-device-telemetry-to-ingest",
    functionName: "ingestTelemetry",
    includedEventTypes: ["Microsoft.Devices.DeviceTelemetry"],
    subjectBeginsWith: "devices/ares7-simulator",
    subjectEndsWith: "devices/ares7-simulator",
    advancedFilters: [],
  },
  {
    sourceResourceType: "Microsoft.EventGrid/topics",
    sourceNamePrefix: "egt-ares7-",
    topicCommand: "topic",
    topicNameFlag: "--topic-name",
    name: "ares7-twin-updates-to-controller",
    functionName: "emergencyController",
    includedEventTypes: ["Microsoft.DigitalTwins.Twin.Update"],
    subjectBeginsWith: "",
    subjectEndsWith: "",
    advancedFilters: [
      {
        key: "Subject",
        operatorType: "StringIn",
        values: ["ares7-clock", "ares7-habitat"],
      },
    ],
  },
];

function normalizedResourceId(value) {
  return String(value ?? "").replace(/\/$/, "").toLowerCase();
}

function sortedStrings(values) {
  return Array.isArray(values) ? values.map(String).sort() : [];
}

function normalizedAdvancedFilters(filters) {
  if (!Array.isArray(filters)) return [];
  return filters
    .map((filter) => ({
      key: String(filter?.key ?? ""),
      operatorType: String(filter?.operatorType ?? ""),
      values: sortedStrings(filter?.values),
    }))
    .sort((left, right) =>
      `${left.key}\0${left.operatorType}`.localeCompare(`${right.key}\0${right.operatorType}`),
    );
}

function assertExactEventSubscription(actual, expected, expectedDestinationId) {
  const failures = [];
  if (actual.name !== expected.name) failures.push("name");
  if (actual.provisioningState !== "Succeeded") failures.push("provisioning state");
  if (actual.eventDeliverySchema !== "EventGridSchema") failures.push("delivery schema");
  if (actual.destination?.endpointType !== "AzureFunction") failures.push("destination type");
  if (
    normalizedResourceId(actual.destination?.resourceId) !==
    normalizedResourceId(expectedDestinationId)
  ) {
    failures.push("destination resource");
  }
  if (
    JSON.stringify(sortedStrings(actual.filter?.includedEventTypes)) !==
    JSON.stringify(sortedStrings(expected.includedEventTypes))
  ) {
    failures.push("included event types");
  }
  if (actual.filter?.subjectBeginsWith !== expected.subjectBeginsWith) {
    failures.push("subject prefix");
  }
  if (actual.filter?.subjectEndsWith !== expected.subjectEndsWith) {
    failures.push("subject suffix");
  }
  if (actual.filter?.isSubjectCaseSensitive !== true) failures.push("subject case sensitivity");
  if (
    JSON.stringify(normalizedAdvancedFilters(actual.filter?.advancedFilters)) !==
    JSON.stringify(normalizedAdvancedFilters(expected.advancedFilters))
  ) {
    failures.push("advanced filters");
  }
  if (
    actual.retryPolicy?.eventTimeToLiveInMinutes !== 60 ||
    actual.retryPolicy?.maxDeliveryAttempts !== 10
  ) {
    failures.push("retry policy");
  }
  if (failures.length) {
    throw new Error(
      `Event Grid subscription ${expected.name} has drift: ${failures.join(", ")}`,
    );
  }
}

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
  const functionAppResourceId =
    `/subscriptions/${scope.subscriptionId}/resourceGroups/${scope.resourceGroup}` +
    `/providers/Microsoft.Web/sites/${functionAppName}`;
  for (const expected of eventSubscriptions) {
    const sourceName = findSingleResourceName(
      scope,
      expected.sourceResourceType,
      expected.sourceNamePrefix,
    );
    const actual = runAzureJson(scope, [
      "eventgrid",
      expected.topicCommand,
      "event-subscription",
      "show",
      "--name",
      expected.name,
      "--resource-group",
      scope.resourceGroup,
      expected.topicNameFlag,
      sourceName,
      "--include-full-endpoint-url",
      "false",
      "--include-attrib-secret",
      "false",
    ]);
    assertExactEventSubscription(
      actual,
      expected,
      `${functionAppResourceId}/functions/${expected.functionName}`,
    );
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
