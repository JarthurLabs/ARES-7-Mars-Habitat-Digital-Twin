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
import { expectedDeviceId, expectedResourceGroup } from "./common.mjs";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runProvisioning(mode) {
  const directory = mkdtempSync(join(tmpdir(), "ares7-device-provision-test-"));
  temporaryDirectories.push(directory);
  const bin = join(directory, "bin");
  const log = join(directory, "az-calls.ndjson");
  mkdirSync(bin);
  const fakeAz = join(bin, "az");
  writeFileSync(
    fakeAz,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.ARES7_FAKE_AZ_LOG, JSON.stringify(args) + "\\n");
const mode = process.env.ARES7_FAKE_AZ_MODE;
if (args[0] === "account" && args[1] === "show") {
  console.log(process.env.ARES7_SUBSCRIPTION_ID);
} else if (args[0] === "resource" && args[1] === "list") {
  console.log(JSON.stringify(["iot-ares7-test"]));
} else if (args[0] === "iot" && args[1] === "hub" && args[2] === "device-identity" && args[3] === "list") {
  console.log(JSON.stringify(mode === "missing" ? [] : [{
    deviceId: "${expectedDeviceId}",
    status: mode === "disabled" ? "disabled" : "enabled",
    authenticationType: null
  }]));
} else if (args[3] === "create") {
  // The test inspects argv after the guarded script exits.
} else if (args[3] === "show") {
  console.log(JSON.stringify({
    deviceId: "${expectedDeviceId}",
    status: mode === "disabled" ? "disabled" : "enabled"
  }));
} else if (args[3] === "connection-string" && args[4] === "show") {
  console.log(JSON.stringify({
    deviceIdMatches: true,
    hasSharedAccessKey: mode !== "no-device-key",
    hasSharedAccessKeyName: mode === "policy-key"
  }));
} else {
  console.error("unexpected fake az call " + args.join(" "));
  process.exitCode = 2;
}
`,
  );
  chmodSync(fakeAz, 0o755);

  const result = spawnSync(process.execPath, ["scripts/azure/provision-device.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ARES7_RESOURCE_GROUP: expectedResourceGroup,
      ARES7_SUBSCRIPTION_ID: subscriptionId,
      ARES7_MILESTONE: "live-scenario",
      ARES7_CONFIRM_WRITE: `deploy-${expectedResourceGroup}`,
      ARES7_MAX_SPEND_USD: "10",
      ARES7_CONFIRM_DEVICE: expectedDeviceId,
      ARES7_FAKE_AZ_LOG: log,
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

function deviceCalls(calls) {
  return calls.filter(
    (args) => args[0] === "iot" && args[1] === "hub" && args[2] === "device-identity",
  );
}

describe("guarded simulator device provisioning", () => {
  it("accepts an enabled existing identity when list omits its authentication type", () => {
    const { calls, result } = runProvisioning("existing-redacted");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /verified existing device identity ares7-simulator/);
    assert.match(result.stdout, /without displaying it/);
    assert(!deviceCalls(calls).some((args) => args[3] === "create"));
    assert(!result.stdout.includes("SharedAccessKey="));
  });

  it("creates a missing identity and verifies its device-only credential capability", () => {
    const { calls, result } = runProvisioning("missing");
    assert.equal(result.status, 0, result.stderr);
    const create = deviceCalls(calls).find((args) => args[3] === "create");
    assert(create);
    assert.equal(create[create.indexOf("--auth-method") + 1], "shared_private_key");
    assert.match(result.stdout, /created and verified device identity ares7-simulator/);
  });

  it("fails closed for a disabled identity before requesting its credential", () => {
    const { calls, result } = runProvisioning("disabled");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing or is not enabled/);
    assert(!deviceCalls(calls).some((args) => args[3] === "connection-string"));
  });

  it("fails closed if a device-only shared key is unavailable", () => {
    const { result } = runProvisioning("no-device-key");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /device-only shared-key credential capability/);
  });

  it("rejects a hub-policy credential shape", () => {
    const { result } = runProvisioning("policy-key");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /device-only shared-key credential capability/);
  });

  it("keeps every device operation on Entra login and the exact subscription", () => {
    const { calls, result } = runProvisioning("existing-redacted");
    assert.equal(result.status, 0, result.stderr);
    for (const args of deviceCalls(calls)) {
      assert.equal(args[args.indexOf("--auth-type") + 1], "login");
      assert.equal(args[args.indexOf("--subscription") + 1], subscriptionId);
    }
  });
});
