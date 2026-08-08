import {
  assertAzureAccount,
  expectedDeviceId,
  findSingleResourceName,
  handleFailure,
  requireExactConfirmation,
  runAzure,
  runAzureJson,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "write");
  requireExactConfirmation(
    process.env,
    "ARES7_CONFIRM_DEVICE",
    expectedDeviceId,
  );
  assertAzureAccount(scope);
  const iotHubName = findSingleResourceName(
    scope,
    "Microsoft.Devices/IotHubs",
    "iot-ares7-",
  );
  const matches = runAzureJson(scope, [
    "iot",
    "hub",
    "device-identity",
    "list",
    "--hub-name",
    iotHubName,
    "--resource-group",
    scope.resourceGroup,
    "--auth-type",
    "login",
    "--query",
    `[?deviceId == '${expectedDeviceId}'].{deviceId:deviceId,status:status,authenticationType:authentication.type}`,
  ]);
  if (matches.length > 1) throw new Error("duplicate device identities returned");
  if (matches.length === 0) {
    runAzure(scope, [
      "iot",
      "hub",
      "device-identity",
      "create",
      "--hub-name",
      iotHubName,
      "--resource-group",
      scope.resourceGroup,
      "--device-id",
      expectedDeviceId,
      "--auth-method",
      "shared_private_key",
      "--auth-type",
      "login",
      "--status",
      "enabled",
      "--output",
      "none",
    ]);
    console.log(`created device identity ${expectedDeviceId} without displaying its keys`);
  } else {
    const device = matches[0];
    if (String(device.status).toLowerCase() !== "enabled") {
      throw new Error(`${expectedDeviceId} exists but is not enabled`);
    }
    if (device.authenticationType !== "sas") {
      throw new Error(`${expectedDeviceId} exists with unexpected authentication ${device.authenticationType}`);
    }
    console.log(`verified existing device identity ${expectedDeviceId}`);
  }
} catch (error) {
  handleFailure(error);
}
