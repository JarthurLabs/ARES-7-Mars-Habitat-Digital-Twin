import assert from "node:assert/strict";
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
import { spawnSync } from "node:child_process";
import { expectedResourceGroup } from "./common.mjs";
import { EVIDENCED_STORAGE_ACCOUNT_NAME } from "../3d/export-scene-configuration.mjs";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runGuardedUpload(fakeMode = "missing") {
  const directory = mkdtempSync(join(tmpdir(), "ares7-scene-upload-test-"));
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
  console.log(JSON.stringify([process.env.ARES7_FAKE_STORAGE_NAME]));
} else if (args[0] === "storage" && args[1] === "account" && args[2] === "show") {
  console.log(JSON.stringify({
    allowBlobPublicAccess: mode === "public",
    allowSharedKeyAccess: false,
    defaultToOAuthAuthentication: true,
    minimumTlsVersion: "TLS1_2"
  }));
} else if (args[0] === "storage" && args[1] === "blob" && args[2] === "exists") {
  console.log(mode === "conflict" ? "true" : "false");
} else if (args[0] === "storage" && args[1] === "blob" && args[2] === "show") {
  console.log(JSON.stringify({ metadata: { sha256: "wrong" }, contentType: "application/json" }));
} else if (args[0] === "storage" && args[1] === "blob" && args[2] === "upload") {
  // The test inspects argv after the guarded script exits.
} else {
  console.error("unexpected fake az call " + args.join(" "));
  process.exitCode = 2;
}
`,
  );
  chmodSync(fakeAz, 0o755);

  const result = spawnSync(process.execPath, ["scripts/azure/upload-scene-asset.mjs"], {
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
      ARES7_CONFIRM_SCENE_UPLOAD: "upload-ares7-3d-scenes-bundle",
      ARES7_FAKE_AZ_LOG: log,
      ARES7_FAKE_AZ_MODE: fakeMode,
      ARES7_FAKE_STORAGE_NAME: EVIDENCED_STORAGE_ACCOUNT_NAME,
    },
  });
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { result, calls };
}

describe("guarded 3D Scenes bundle upload", () => {
  it("plans both missing blobs before uploading with Entra auth and no overwrite", () => {
    const { result, calls } = runGuardedUpload();
    assert.equal(result.status, 0, result.stderr);
    const uploads = calls.filter(
      (args) => args[0] === "storage" && args[1] === "blob" && args[2] === "upload",
    );
    assert.equal(uploads.length, 2);
    assert.deepEqual(
      uploads.map((args) => args[args.indexOf("--name") + 1]),
      ["ares7-habitat-segmented.glb", "3DScenesConfiguration.json"],
    );
    for (const args of uploads) {
      assert.equal(args[args.indexOf("--auth-mode") + 1], "login");
      assert.equal(args[args.indexOf("--overwrite") + 1], "false");
      assert(!args.includes("--account-key"));
      assert(!args.includes("--sas-token"));
      assert(!args.includes("--public-access"));
      assert.equal(args[args.indexOf("--subscription") + 1], subscriptionId);
    }
    const firstUpload = calls.findIndex((args) => args[2] === "upload");
    const existenceChecks = calls
      .map((args, index) => ({ args, index }))
      .filter(({ args }) => args[2] === "exists");
    assert.equal(existenceChecks.length, 2);
    assert(existenceChecks.every(({ index }) => index < firstUpload));
  });

  it("fails before blob operations when anonymous account access is allowed", () => {
    const { result, calls } = runGuardedUpload("public");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /anonymous blob access to be disabled/);
    assert(!calls.some((args) => args[1] === "blob"));
  });

  it("refuses a conflicting existing blob before any upload", () => {
    const { result, calls } = runGuardedUpload("conflict");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to overwrite it/);
    assert(!calls.some((args) => args[2] === "upload"));
  });
});
