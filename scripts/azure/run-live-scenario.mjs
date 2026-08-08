import { randomUUID } from "node:crypto";
import {
  assertAzureAccount,
  expectedDeviceId,
  findSingleResourceName,
  handleFailure,
  requireExactConfirmation,
  run,
  runAzure,
  runAzureJson,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "write");
  requireExactConfirmation(
    process.env,
    "ARES7_CONFIRM_SCENARIO",
    `run-${expectedDeviceId}`,
  );
  assertAzureAccount(scope);
  const iotHubName = findSingleResourceName(
    scope,
    "Microsoft.Devices/IotHubs",
    "iot-ares7-",
  );
  const functionAppName = findSingleResourceName(
    scope,
    "Microsoft.Web/sites",
    "func-ares7-",
  );
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
  for (const required of ["ingestTelemetry", "emergencyController"]) {
    if (!functions.includes(required)) throw new Error(`missing deployed Function ${required}`);
  }
  const digitalTwinsName = findSingleResourceName(
    scope,
    "Microsoft.DigitalTwins/digitalTwinsInstances",
    "adt-ares7-",
  );
  const controllerRoute = runAzureJson(scope, [
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
    controllerRoute.endpointName !== "ares7-controller-topic" ||
    controllerRoute.filter !==
      "type = 'Microsoft.DigitalTwins.Twin.Update' AND (subject = 'ares7-clock' OR subject = 'ares7-habitat')"
  ) {
    throw new Error("the narrow Azure Digital Twins controller route is missing or has drift");
  }
  const device = runAzureJson(scope, [
    "iot",
    "hub",
    "device-identity",
    "show",
    "--hub-name",
    iotHubName,
    "--resource-group",
    scope.resourceGroup,
    "--device-id",
    expectedDeviceId,
    "--auth-type",
    "login",
    "--query",
    "{deviceId:deviceId,status:status}",
  ]);
  if (device.deviceId !== expectedDeviceId || String(device.status).toLowerCase() !== "enabled") {
    throw new Error(`device ${expectedDeviceId} is missing or disabled`);
  }
  const connectionString = runAzure(
    scope,
    [
      "iot",
      "hub",
      "device-identity",
      "connection-string",
      "show",
      "--hub-name",
      iotHubName,
      "--resource-group",
      scope.resourceGroup,
      "--device-id",
      expectedDeviceId,
      "--auth-type",
      "login",
      "--query",
      "connectionString",
      "--output",
      "tsv",
    ],
    { capture: true },
  );
  if (!connectionString.startsWith("HostName=") || !connectionString.includes(`DeviceId=${expectedDeviceId};`)) {
    throw new Error("Azure CLI did not return the expected device-scoped credential");
  }
  const scenarioRunId = process.env.ARES7_SCENARIO_RUN_ID?.trim() || randomUUID();
  console.log(`starting ARES-7 scenario run ${scenarioRunId}`);
  console.log("Use the guarded approval command in a second Cloud Shell after the habitat reaches LIFE_SUPPORT_RISK/PENDING.");
  run("npm", ["--prefix", "simulator", "start"], {
    env: {
      IOTHUB_DEVICE_CONNECTION_STRING: connectionString,
      ARES7_SCENARIO_RUN_ID: scenarioRunId,
      ARES7_INTERVAL_SECONDS: process.env.ARES7_INTERVAL_SECONDS ?? "12",
      ARES7_DUPLICATE_TICK: process.env.ARES7_DUPLICATE_TICK ?? "11",
      ARES7_DUPLICATE_DELAY_SECONDS:
        process.env.ARES7_DUPLICATE_DELAY_SECONDS ?? process.env.ARES7_INTERVAL_SECONDS ?? "12",
    },
  });
  console.log(
    `completed 12 telemetry frames plus one exact duplicate for scenario ${scenarioRunId}; the device credential was never exported or printed`,
  );
} catch (error) {
  handleFailure(error);
}
