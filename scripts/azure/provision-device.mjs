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
    `[?deviceId == '${expectedDeviceId}'].{deviceId:deviceId,status:status}`,
  ]);
  if (matches.length > 1) throw new Error("duplicate device identities returned");
  let created = false;
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
    created = true;
  }

  // Azure IoT's list projection can omit authentication metadata even for a
  // symmetric-key device. Verify the exact identity directly, then ask the CLI
  // to reduce the device-only connection string to booleans. No key or
  // connection string is printed, logged, or returned to this process.
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
  if (
    device.deviceId !== expectedDeviceId ||
    String(device.status).toLowerCase() !== "enabled"
  ) {
    throw new Error(`${expectedDeviceId} is missing or is not enabled`);
  }

  const credentialCapability = runAzureJson(scope, [
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
    `{deviceIdMatches:contains(connectionString, 'DeviceId=${expectedDeviceId}'),hasSharedAccessKey:contains(connectionString, 'SharedAccessKey='),hasSharedAccessKeyName:contains(connectionString, 'SharedAccessKeyName=')}`,
  ]);
  if (
    credentialCapability.deviceIdMatches !== true ||
    credentialCapability.hasSharedAccessKey !== true ||
    credentialCapability.hasSharedAccessKeyName !== false
  ) {
    throw new Error(
      `${expectedDeviceId} does not expose the expected device-only shared-key credential capability`,
    );
  }

  console.log(
    `${created ? "created and verified" : "verified existing"} device identity ${expectedDeviceId}`,
  );
  console.log("verified device-only shared-key credential capability without displaying it");
} catch (error) {
  handleFailure(error);
}
