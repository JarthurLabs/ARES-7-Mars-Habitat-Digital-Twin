import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
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

const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clockTwinId = "ares7-clock";
const habitatTwinId = "ares7-habitat";
const approvalGateTick = 4;

function positiveIntegerEnvironmentValue(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeIntegerEnvironmentValue(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function boundedNonNegativeNumberEnvironmentValue(name, fallback, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be a number from 0 to ${maximum}`);
  }
  return value;
}

function clockMatchesTickZero(clock, scenarioRunId, expectedSnapshotId) {
  return clock?.scenarioRunId === scenarioRunId &&
    clock?.tick === 0 &&
    clock?.snapshotVersion === `v2:${scenarioRunId}:tick:0` &&
    clock?.committedSnapshotId === expectedSnapshotId;
}

function habitatMatchesPendingGate(habitat, scenarioRunId) {
  return habitat?.scenarioRunId === scenarioRunId &&
    habitat?.lastProcessedTick === approvalGateTick &&
    habitat?.snapshotVersion === `v2:${scenarioRunId}:tick:${approvalGateTick}` &&
    habitat?.operationalState === "LIFE_SUPPORT_RISK" &&
    habitat?.operatorDecision === "PENDING";
}

function validDecisionId(value) {
  return typeof value === "string" && value.trim() !== "" && value !== "none";
}

function habitatMatchesReconciledApproval(habitat, scenarioRunId) {
  return habitat?.scenarioRunId === scenarioRunId &&
    habitat?.lastProcessedTick === approvalGateTick &&
    habitat?.snapshotVersion === `v2:${scenarioRunId}:tick:${approvalGateTick}` &&
    habitat?.operationalState === "CONTAINMENT" &&
    habitat?.operatorDecision === "APPROVED" &&
    habitat?.decisionScenarioRunId === scenarioRunId &&
    habitat?.decisionTick === approvalGateTick &&
    validDecisionId(habitat?.decisionId) &&
    habitat?.lastDecisionId === habitat.decisionId &&
    habitat?.lastActionSource === "approval";
}

function printableClock(clock) {
  if (!clock) return "unreadable";
  return `run=${String(clock.scenarioRunId ?? "missing")}, tick=${String(clock.tick ?? "missing")}, snapshot=${String(clock.committedSnapshotId ?? "missing")}`;
}

function printableHabitat(habitat) {
  if (!habitat) return "unreadable";
  return `run=${String(habitat.scenarioRunId ?? "missing")}, ` +
    `tick=${String(habitat.lastProcessedTick ?? "missing")}, ` +
    `state=${String(habitat.operationalState ?? "missing")}, ` +
    `decision=${String(habitat.operatorDecision ?? "missing")}, ` +
    `decisionRun=${String(habitat.decisionScenarioRunId ?? "missing")}, ` +
    `decisionTick=${String(habitat.decisionTick ?? "missing")}, ` +
    `decisionId=${String(habitat.decisionId ?? "missing")}, ` +
    `lastDecisionId=${String(habitat.lastDecisionId ?? "missing")}, ` +
    `lastActionSource=${String(habitat.lastActionSource ?? "missing")}`;
}

function readHabitat(scope, digitalTwinsName) {
  return runAzureJson(scope, [
    "dt",
    "twin",
    "show",
    "--dt-name",
    digitalTwinsName,
    "--resource-group",
    scope.resourceGroup,
    "--twin-id",
    habitatTwinId,
    "--query",
    "{scenarioRunId:scenarioRunId,lastProcessedTick:lastProcessedTick,snapshotVersion:snapshotVersion,operationalState:operationalState,operatorDecision:operatorDecision,decisionScenarioRunId:decisionScenarioRunId,decisionTick:decisionTick,decisionId:decisionId,lastDecisionId:lastDecisionId,lastActionSource:lastActionSource}",
  ]);
}

async function awaitTickZeroCommit(
  scope,
  digitalTwinsName,
  scenarioRunId,
  attempts,
  delayMs,
) {
  const expectedSnapshotId = `ares7-snapshot-${scenarioRunId}-0`;
  let observedClock;
  let lastClockReadError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      observedClock = runAzureJson(scope, [
        "dt",
        "twin",
        "show",
        "--dt-name",
        digitalTwinsName,
        "--resource-group",
        scope.resourceGroup,
        "--twin-id",
        clockTwinId,
        "--query",
        "{scenarioRunId:scenarioRunId,tick:tick,snapshotVersion:snapshotVersion,committedSnapshotId:committedSnapshotId}",
      ]);
      lastClockReadError = undefined;
      if (clockMatchesTickZero(observedClock, scenarioRunId, expectedSnapshotId)) {
        console.log(`Azure Digital Twins committed run ${scenarioRunId} tick 0; releasing ticks 1-4`);
        return;
      }
    } catch (error) {
      lastClockReadError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) {
      console.log(`waiting for Azure Digital Twins tick 0 commit (${attempt}/${attempts})`);
      if (delayMs > 0) await wait(delayMs);
    }
  }

  let snapshotDiagnostic = "missing or unreadable";
  try {
    const snapshot = runAzureJson(scope, [
      "dt",
      "twin",
      "show",
      "--dt-name",
      digitalTwinsName,
      "--resource-group",
      scope.resourceGroup,
      "--twin-id",
      expectedSnapshotId,
      "--query",
      "{scenarioRunId:scenarioRunId,tick:tick,snapshotVersion:snapshotVersion}",
    ]);
    snapshotDiagnostic =
      snapshot?.scenarioRunId === scenarioRunId && snapshot?.tick === 0
        ? "present for the expected run and tick"
        : `present with unexpected identity run=${String(snapshot?.scenarioRunId ?? "missing")}, tick=${String(snapshot?.tick ?? "missing")}`;
  } catch {
    // Missing snapshot state is reported below without masking the clock diagnosis.
  }

  const readErrorDiagnostic = lastClockReadError
    ? ` Last clock read failed: ${lastClockReadError}.`
    : "";
  throw new Error(
    `tick 0 reached the IoT Hub client but did not commit to Azure Digital Twins after ${attempts} checks. ` +
      `Observed clock: ${printableClock(observedClock)}. Expected snapshot ${expectedSnapshotId} is ${snapshotDiagnostic}. ` +
      `Stopped before tick 1. Inspect ingestTelemetry Function exceptions, the IoT Hub Event Grid delivery subscription, and its dead-letter destination.${readErrorDiagnostic}`,
  );
}

async function awaitPendingApprovalGate(
  scope,
  digitalTwinsName,
  scenarioRunId,
  attempts,
  delayMs,
) {
  let observedHabitat;
  let lastReadError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      observedHabitat = readHabitat(scope, digitalTwinsName);
      lastReadError = undefined;
      if (habitatMatchesPendingGate(observedHabitat, scenarioRunId)) {
        console.log(
          `controller reached run ${scenarioRunId} tick ${approvalGateTick} LIFE_SUPPORT_RISK/PENDING; waiting for guarded external approval`,
        );
        return;
      }
    } catch (error) {
      lastReadError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) {
      console.log(`waiting for the exact controller approval gate (${attempt}/${attempts})`);
      if (delayMs > 0) await wait(delayMs);
    }
  }

  const readErrorDiagnostic = lastReadError
    ? ` Last habitat read failed: ${lastReadError}.`
    : "";
  throw new Error(
    `ticks 1-4 reached the IoT Hub client, but the controller did not establish ` +
      `run ${scenarioRunId} tick ${approvalGateTick} LIFE_SUPPORT_RISK/PENDING after ${attempts} checks. ` +
      `Observed habitat: ${printableHabitat(observedHabitat)}. ` +
      `Stopped before approval and before tick 5. Inspect emergencyController Function exceptions and the Azure Digital Twins controller route.${readErrorDiagnostic}`,
  );
}

async function awaitReconciledApproval(
  scope,
  digitalTwinsName,
  scenarioRunId,
  attempts,
  delayMs,
) {
  let observedHabitat;
  let lastReadError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      observedHabitat = readHabitat(scope, digitalTwinsName);
      lastReadError = undefined;
      if (habitatMatchesReconciledApproval(observedHabitat, scenarioRunId)) {
        console.log(
          `guarded approval reconciled for run ${scenarioRunId} on tick ${approvalGateTick}; entering the evidence capture hold`,
        );
        return;
      }
    } catch (error) {
      lastReadError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) {
      console.log(`waiting for same-run approval reconciliation (${attempt}/${attempts})`);
      if (delayMs > 0) await wait(delayMs);
    }
  }

  const readErrorDiagnostic = lastReadError
    ? ` Last habitat read failed: ${lastReadError}.`
    : "";
  throw new Error(
    `guarded approval for run ${scenarioRunId} tick ${approvalGateTick} did not reconcile after ${attempts} checks. ` +
      `Observed habitat: ${printableHabitat(observedHabitat)}. ` +
      `Stopped before tick 5. Run the guarded containment approval in a second authenticated shell, then inspect emergencyController if the approved decision does not become a same-tick containment action.${readErrorDiagnostic}`,
  );
}

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
  if (!runIdPattern.test(scenarioRunId)) {
    throw new Error("ARES7_SCENARIO_RUN_ID must be a UUID accepted by the live telemetry contract");
  }
  const duplicateTick = Number(process.env.ARES7_DUPLICATE_TICK?.trim() || 11);
  if (!Number.isInteger(duplicateTick) || duplicateTick <= approvalGateTick || duplicateTick > 11) {
    throw new Error("ARES7_DUPLICATE_TICK must be an integer from 5 to 11 for the guarded scenario");
  }
  console.log(`starting ARES-7 scenario run ${scenarioRunId}`);
  console.log("Use the guarded approval command in a second Cloud Shell after the habitat reaches LIFE_SUPPORT_RISK/PENDING.");
  const barrierAttempts = positiveIntegerEnvironmentValue(
    "ARES7_INGEST_BARRIER_ATTEMPTS",
    12,
  );
  const barrierDelayMs = nonNegativeIntegerEnvironmentValue(
    "ARES7_INGEST_BARRIER_DELAY_MS",
    5_000,
  );
  const controllerBarrierAttempts = positiveIntegerEnvironmentValue(
    "ARES7_CONTROLLER_BARRIER_ATTEMPTS",
    barrierAttempts,
  );
  const controllerBarrierDelayMs = nonNegativeIntegerEnvironmentValue(
    "ARES7_CONTROLLER_BARRIER_DELAY_MS",
    barrierDelayMs,
  );
  const approvalWaitAttempts = positiveIntegerEnvironmentValue(
    "ARES7_APPROVAL_WAIT_ATTEMPTS",
    120,
  );
  const approvalWaitDelayMs = nonNegativeIntegerEnvironmentValue(
    "ARES7_APPROVAL_WAIT_DELAY_MS",
    5_000,
  );
  const approvalCaptureHoldSeconds = boundedNonNegativeNumberEnvironmentValue(
    "ARES7_APPROVAL_GATE_DELAY_SECONDS",
    process.env.ARES7_INTERVAL_SECONDS ?? "12",
    300,
  );
  run("npm", ["--prefix", "simulator", "start"], {
    env: {
      IOTHUB_DEVICE_CONNECTION_STRING: connectionString,
      ARES7_SCENARIO_RUN_ID: scenarioRunId,
      ARES7_INTERVAL_SECONDS: process.env.ARES7_INTERVAL_SECONDS ?? "12",
      ARES7_START_TICK: "0",
      ARES7_END_TICK: "0",
      ARES7_DUPLICATE_TICK: "",
      ARES7_DUPLICATE_DELAY_SECONDS: "0",
      ARES7_APPROVAL_GATE_DELAY_SECONDS: "0",
    },
  });
  await awaitTickZeroCommit(
    scope,
    digitalTwinsName,
    scenarioRunId,
    barrierAttempts,
    barrierDelayMs,
  );
  run("npm", ["--prefix", "simulator", "start"], {
    env: {
      IOTHUB_DEVICE_CONNECTION_STRING: connectionString,
      ARES7_SCENARIO_RUN_ID: scenarioRunId,
      ARES7_INTERVAL_SECONDS: process.env.ARES7_INTERVAL_SECONDS ?? "12",
      ARES7_START_TICK: "1",
      ARES7_END_TICK: String(approvalGateTick),
      ARES7_DUPLICATE_TICK: "",
      ARES7_DUPLICATE_DELAY_SECONDS: "0",
      ARES7_APPROVAL_GATE_DELAY_SECONDS: "0",
    },
  });
  await awaitPendingApprovalGate(
    scope,
    digitalTwinsName,
    scenarioRunId,
    controllerBarrierAttempts,
    controllerBarrierDelayMs,
  );
  await awaitReconciledApproval(
    scope,
    digitalTwinsName,
    scenarioRunId,
    approvalWaitAttempts,
    approvalWaitDelayMs,
  );
  if (approvalCaptureHoldSeconds > 0) {
    await wait(approvalCaptureHoldSeconds * 1_000);
  }
  console.log(
    `post-approval evidence capture hold completed after ${approvalCaptureHoldSeconds} seconds; releasing ticks 5-11`,
  );
  run("npm", ["--prefix", "simulator", "start"], {
    env: {
      IOTHUB_DEVICE_CONNECTION_STRING: connectionString,
      ARES7_SCENARIO_RUN_ID: scenarioRunId,
      ARES7_INTERVAL_SECONDS: process.env.ARES7_INTERVAL_SECONDS ?? "12",
      ARES7_START_TICK: String(approvalGateTick + 1),
      ARES7_END_TICK: "11",
      ARES7_DUPLICATE_TICK: String(duplicateTick),
      ARES7_DUPLICATE_DELAY_SECONDS:
        process.env.ARES7_DUPLICATE_DELAY_SECONDS ?? process.env.ARES7_INTERVAL_SECONDS ?? "12",
      ARES7_APPROVAL_GATE_DELAY_SECONDS: "0",
    },
  });
  console.log(
    `completed 12 telemetry frames plus one exact duplicate for scenario ${scenarioRunId}; the device credential was never exported or printed`,
  );
} catch (error) {
  handleFailure(error);
}
