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
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { expectedDeviceId, expectedResourceGroup } from "./common.mjs";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const scenarioRunId = "00000000-0000-4000-8000-000000000007";
const digitalTwinsName = "adt-ares7-test";
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runGuardedScenario(mode = "committed", environment = {}) {
  const directory = mkdtempSync(join(tmpdir(), "ares7-live-scenario-test-"));
  temporaryDirectories.push(directory);
  const bin = join(directory, "bin");
  const log = join(directory, "calls.ndjson");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "az"),
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.ARES7_FAKE_CALL_LOG, JSON.stringify({ command: "az", args }) + "\\n");
const mode = process.env.ARES7_FAKE_AZ_MODE;
const runId = process.env.ARES7_SCENARIO_RUN_ID;
if (args[0] === "account" && args[1] === "show") {
  console.log(process.env.ARES7_SUBSCRIPTION_ID);
} else if (args[0] === "resource" && args[1] === "list") {
  const resourceType = args[args.indexOf("--resource-type") + 1];
  const names = {
    "Microsoft.Devices/IotHubs": ["iot-ares7-test"],
    "Microsoft.Web/sites": ["func-ares7-test"],
    "Microsoft.DigitalTwins/digitalTwinsInstances": [${JSON.stringify(digitalTwinsName)}]
  };
  console.log(JSON.stringify(names[resourceType] ?? []));
} else if (args[0] === "functionapp" && args[1] === "function" && args[2] === "list") {
  console.log(JSON.stringify(["ingestTelemetry", "emergencyController"]));
} else if (args[0] === "dt" && args[1] === "route" && args[2] === "show") {
  console.log(JSON.stringify({
    endpointName: "ares7-controller-topic",
    filter: "type = 'Microsoft.DigitalTwins.Twin.Update' AND (subject = 'ares7-clock' OR subject = 'ares7-habitat')"
  }));
} else if (args[0] === "iot" && args[1] === "hub" && args[2] === "device-identity" && args[3] === "show") {
  console.log(JSON.stringify({ deviceId: ${JSON.stringify(expectedDeviceId)}, status: "enabled" }));
} else if (args[0] === "iot" && args[1] === "hub" && args[2] === "device-identity" && args[3] === "connection-string") {
  console.log("HostName=ares7-test.azure-devices.net;DeviceId=${expectedDeviceId};Authentication=test-fixture");
} else if (args[0] === "dt" && args[1] === "twin" && args[2] === "show") {
  const twinId = args[args.indexOf("--twin-id") + 1];
  if (twinId === "ares7-clock") {
    console.log(JSON.stringify(mode === "committed" ? {
      scenarioRunId: runId,
      tick: 0,
      snapshotVersion: "v2:" + runId + ":tick:0",
      committedSnapshotId: "ares7-snapshot-" + runId + "-0"
    } : {
      scenarioRunId: "not-started",
      tick: -1,
      snapshotVersion: "not-started",
      committedSnapshotId: "not-started"
    }));
  } else {
    console.error("snapshot twin not found");
    process.exitCode = 3;
  }
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
appendFileSync(process.env.ARES7_FAKE_CALL_LOG, JSON.stringify({
  command: "npm",
  args: process.argv.slice(2),
  environment: {
    scenarioRunId: process.env.ARES7_SCENARIO_RUN_ID,
    startTick: process.env.ARES7_START_TICK,
    endTick: process.env.ARES7_END_TICK,
    duplicateTick: process.env.ARES7_DUPLICATE_TICK,
    duplicateDelaySeconds: process.env.ARES7_DUPLICATE_DELAY_SECONDS,
    approvalGateDelaySeconds: process.env.ARES7_APPROVAL_GATE_DELAY_SECONDS
  }
}) + "\\n");
`,
  );
  chmodSync(join(bin, "az"), 0o755);
  chmodSync(join(bin, "npm"), 0o755);

  const result = spawnSync(process.execPath, ["scripts/azure/run-live-scenario.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
      ARES7_RESOURCE_GROUP: expectedResourceGroup,
      ARES7_SUBSCRIPTION_ID: subscriptionId,
      ARES7_MILESTONE: "live-scenario",
      ARES7_CONFIRM_WRITE: `deploy-${expectedResourceGroup}`,
      ARES7_MAX_SPEND_USD: "10",
      ARES7_CONFIRM_SCENARIO: `run-${expectedDeviceId}`,
      ARES7_SCENARIO_RUN_ID: scenarioRunId,
      ARES7_INTERVAL_SECONDS: "0",
      ARES7_DUPLICATE_TICK: "11",
      ARES7_DUPLICATE_DELAY_SECONDS: "0",
      ARES7_APPROVAL_GATE_DELAY_SECONDS: "0",
      ARES7_INGEST_BARRIER_ATTEMPTS: "2",
      ARES7_INGEST_BARRIER_DELAY_MS: "0",
      ARES7_FAKE_CALL_LOG: log,
      ARES7_FAKE_AZ_MODE: mode,
      ...environment,
    },
  });
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { calls, result };
}

describe("guarded live scenario ingest barrier", () => {
  it("releases the remaining ticks only after the exact tick-zero commit", () => {
    const { calls, result } = runGuardedScenario();
    assert.equal(result.status, 0, result.stderr);

    const simulatorCalls = calls.filter(({ command }) => command === "npm");
    assert.equal(simulatorCalls.length, 2);
    assert.deepEqual(simulatorCalls[0].args, ["--prefix", "simulator", "start"]);
    assert.deepEqual(simulatorCalls[0].environment, {
      scenarioRunId,
      startTick: "0",
      endTick: "0",
      duplicateTick: "",
      duplicateDelaySeconds: "0",
      approvalGateDelaySeconds: "0",
    });
    assert.deepEqual(simulatorCalls[1].environment, {
      scenarioRunId,
      startTick: "1",
      endTick: "11",
      duplicateTick: "11",
      duplicateDelaySeconds: "0",
      approvalGateDelaySeconds: "0",
    });

    const firstSimulatorIndex = calls.indexOf(simulatorCalls[0]);
    const secondSimulatorIndex = calls.indexOf(simulatorCalls[1]);
    const clockReadIndex = calls.findIndex(
      ({ command, args }) => command === "az" && args[0] === "dt" && args[1] === "twin" && args.includes("ares7-clock"),
    );
    assert(firstSimulatorIndex < clockReadIndex);
    assert(clockReadIndex < secondSimulatorIndex);
    const clockRead = calls[clockReadIndex].args;
    assert.equal(clockRead[clockRead.indexOf("--dt-name") + 1], digitalTwinsName);
    assert.equal(clockRead[clockRead.indexOf("--resource-group") + 1], expectedResourceGroup);
    assert.equal(clockRead[clockRead.indexOf("--subscription") + 1], subscriptionId);
    assert.match(result.stdout, /committed run .* tick 0; releasing ticks 1-11/);
  });

  it("fails closed with clock and snapshot diagnostics before tick one", () => {
    const { calls, result } = runGuardedScenario("not-committed");
    assert.equal(result.status, 1);
    assert.equal(calls.filter(({ command }) => command === "npm").length, 1);
    assert.equal(
      calls.filter(
        ({ command, args }) => command === "az" && args[0] === "dt" && args[1] === "twin" && args.includes("ares7-clock"),
      ).length,
      2,
    );
    assert.match(result.stderr, /did not commit to Azure Digital Twins after 2 checks/);
    assert.match(result.stderr, /run=not-started, tick=-1/);
    assert.match(result.stderr, /Expected snapshot .* is missing or unreadable/);
    assert.match(result.stderr, /Stopped before tick 1/);
  });

  it("rejects an incompatible duplicate before sending tick zero", () => {
    const { calls, result } = runGuardedScenario("committed", {
      ARES7_DUPLICATE_TICK: "0",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be an integer from 1 to 11/);
    assert.equal(calls.filter(({ command }) => command === "npm").length, 0);
  });
});
