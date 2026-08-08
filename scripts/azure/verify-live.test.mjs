import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { expectedResourceGroup } from "./common.mjs";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const functionAppName = "func-ares7-test";
const systemTopicName = "egst-iot-ares7-test";
const controllerTopicName = "egt-ares7-test";
const digitalTwinsName = "adt-ares7-test";
const routeFilter =
  "type = 'Microsoft.DigitalTwins.Twin.Update' AND (subject = 'ares7-clock' OR subject = 'ares7-habitat')";
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runLiveVerification(mode = "valid") {
  const directory = mkdtempSync(join(tmpdir(), "ares7-live-verification-test-"));
  temporaryDirectories.push(directory);
  const bin = join(directory, "bin");
  const log = join(directory, "calls.ndjson");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "az"),
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.ARES7_FAKE_CALL_LOG, JSON.stringify(["az", ...args]) + "\\n");
const mode = process.env.ARES7_FAKE_AZ_MODE;
const subscriptionId = process.env.ARES7_SUBSCRIPTION_ID;
const resourceGroup = process.env.ARES7_RESOURCE_GROUP;
const functionAppName = ${JSON.stringify(functionAppName)};
const systemTopicName = ${JSON.stringify(systemTopicName)};
const controllerTopicName = ${JSON.stringify(controllerTopicName)};
const functionAppId = "/subscriptions/" + subscriptionId + "/resourceGroups/" + resourceGroup + "/providers/Microsoft.Web/sites/" + functionAppName;
if (args[0] === "account" && args[1] === "show") {
  console.log(subscriptionId);
} else if (args[0] === "resource" && args[1] === "list") {
  const typeIndex = args.indexOf("--resource-type");
  if (typeIndex === -1) {
    // The first resource table is diagnostic and intentionally contains no secrets.
  } else {
    const resourceType = args[typeIndex + 1];
    const names = {
      "Microsoft.Web/sites": [functionAppName],
      "Microsoft.EventGrid/systemTopics": [systemTopicName],
      "Microsoft.EventGrid/topics": [controllerTopicName],
      "Microsoft.DigitalTwins/digitalTwinsInstances": [${JSON.stringify(digitalTwinsName)}]
    };
    console.log(JSON.stringify(names[resourceType] ?? []));
  }
} else if (args[0] === "functionapp" && args[1] === "function" && args[2] === "list") {
  console.log(JSON.stringify(["ingestTelemetry", "emergencyController", "negotiateViewer"]));
} else if (args[0] === "functionapp" && args[1] === "list") {
  // The Function App table is diagnostic and intentionally contains no secrets.
} else if (args[0] === "eventgrid" && args[1] === "event-subscription" && args[2] === "show") {
  const sourceId = args[args.indexOf("--source-resource-id") + 1];
  const name = args[args.indexOf("--name") + 1];
  const isTelemetry = sourceId.endsWith("/systemTopics/" + systemTopicName);
  if (mode === "missing" && !isTelemetry) {
    console.error("event subscription was not found");
    process.exitCode = 3;
  } else {
    const functionName = isTelemetry ? "ingestTelemetry" : "emergencyController";
    const destination = mode === "drift" && !isTelemetry
      ? functionAppId + "/functions/unexpectedController"
      : functionAppId + "/functions/" + functionName;
    console.log(JSON.stringify({
      name,
      provisioningState: "Succeeded",
      eventDeliverySchema: "EventGridSchema",
      destination: { endpointType: "AzureFunction", resourceId: destination },
      filter: {
        includedEventTypes: [isTelemetry ? "Microsoft.Devices.DeviceTelemetry" : "Microsoft.DigitalTwins.Twin.Update"],
        subjectBeginsWith: isTelemetry ? "devices/ares7-simulator" : "",
        subjectEndsWith: isTelemetry ? "devices/ares7-simulator" : "",
        isSubjectCaseSensitive: true,
        advancedFilters: isTelemetry ? null : [{
          values: ["ares7-habitat", "ares7-clock"],
          operatorType: "StringIn",
          key: "Subject"
        }]
      },
      retryPolicy: { eventTimeToLiveInMinutes: 60, maxDeliveryAttempts: 10 }
    }));
  }
} else if (args[0] === "dt" && args[1] === "show") {
  console.log("${digitalTwinsName}.api.digitaltwins.azure.net");
} else if (args[0] === "dt" && args[1] === "route" && args[2] === "show") {
  console.log(JSON.stringify({
    id: "ares7-controller-updates",
    endpointName: "ares7-controller-topic",
    filter: ${JSON.stringify(routeFilter)}
  }));
} else {
  console.error("unexpected fake az call " + args.join(" "));
  process.exitCode = 2;
}
`,
  );
  writeFileSync(
    join(bin, "npm"),
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.ARES7_FAKE_CALL_LOG, JSON.stringify(["npm", ...process.argv.slice(2)]) + "\\n");
`,
  );
  chmodSync(join(bin, "az"), 0o755);
  chmodSync(join(bin, "npm"), 0o755);

  const result = spawnSync(process.execPath, ["scripts/azure/verify-live.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ARES7_RESOURCE_GROUP: expectedResourceGroup,
      ARES7_SUBSCRIPTION_ID: subscriptionId,
      ARES7_VERIFY_STAGE: "pre-run",
      ARES7_FAKE_CALL_LOG: log,
      ARES7_FAKE_AZ_MODE: mode,
    },
  });
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { calls, result };
}

describe("live Azure path verification", () => {
  it("shows both exact Event Grid subscriptions through their exact source resource IDs", () => {
    const { calls, result } = runLiveVerification();
    assert.equal(result.status, 0, result.stderr);
    const eventCalls = calls.filter(
      ([command, group, resource]) =>
        command === "az" && group === "eventgrid" && resource === "event-subscription",
    );
    assert.equal(eventCalls.length, 2);
    assert(eventCalls.every((call) => call[3] === "show"));
    assert.deepEqual(
      eventCalls.map((call) => call[call.indexOf("--name") + 1]),
      ["ares7-device-telemetry-to-ingest", "ares7-twin-updates-to-controller"],
    );
    assert.deepEqual(
      eventCalls.map((call) => call[call.indexOf("--source-resource-id") + 1]),
      [
        `/subscriptions/${subscriptionId}/resourceGroups/${expectedResourceGroup}/providers/Microsoft.EventGrid/systemTopics/${systemTopicName}`,
        `/subscriptions/${subscriptionId}/resourceGroups/${expectedResourceGroup}/providers/Microsoft.EventGrid/topics/${controllerTopicName}`,
      ],
    );
    for (const call of eventCalls) {
      assert.equal(call[call.indexOf("--include-full-endpoint-url") + 1], "false");
      assert.equal(call[call.indexOf("--include-attrib-secret") + 1], "false");
      assert.equal(call[call.indexOf("--subscription") + 1], subscriptionId);
      assert(!call.includes("list"));
      assert(!call.includes("--resource-group"));
    }
    assert(calls.some(([command]) => command === "npm"));
  });

  it("fails closed when an exact subscription targets the wrong Function", () => {
    const { calls, result } = runLiveVerification("drift");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /destination resource/);
    assert(!calls.some(([command]) => command === "npm"));
  });

  it("fails closed when an exact source does not contain its required subscription", () => {
    const { calls, result } = runLiveVerification("missing");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /event subscription was not found/);
    assert(!calls.some(([command]) => command === "npm"));
  });
});
