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
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const log = process.env.ARES7_FAKE_AZ_LOG;
const previousCalls = existsSync(log)
  ? readFileSync(log, "utf8").trim().split("\\n").filter(Boolean).map(JSON.parse)
  : [];
appendFileSync(log, JSON.stringify(args) + "\\n");
const mode = process.env.ARES7_FAKE_AZ_MODE;
const argument = (call, name) => call[call.indexOf(name) + 1];
const priorUpload = (name) => [...previousCalls].reverse().find(
  (call) => call[0] === "storage" && call[1] === "blob" && call[2] === "upload" &&
    argument(call, "--name") === name,
);
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
  const uploaded = priorUpload(argument(args, "--name"));
  console.log(mode === "conflict" || (uploaded && mode !== "post-missing") ? "true" : "false");
} else if (args[0] === "storage" && args[1] === "blob" && args[2] === "show") {
  const name = argument(args, "--name");
  const upload = priorUpload(name);
  if (mode === "conflict" || !upload) {
    console.log(JSON.stringify({
      metadata: { sha256: "wrong" },
      contentType: "application/json",
      contentLength: 1
    }));
  } else {
    const metadataStart = upload.indexOf("--metadata") + 1;
    const metadataEnd = upload.indexOf("--output", metadataStart);
    const metadata = Object.fromEntries(
      upload.slice(metadataStart, metadataEnd).map((pair) => {
        const separator = pair.indexOf("=");
        return [pair.slice(0, separator), pair.slice(separator + 1)];
      }),
    );
    if (mode === "post-corrupt" && name === "ares7-habitat-segmented.glb") {
      metadata.sha256 = "0".repeat(64);
    }
    if (mode === "post-schema" && name === "3DScenesConfiguration.json") {
      metadata.schemaVersion = "v0.0.0";
    }
    console.log(JSON.stringify({
      metadata,
      contentType: argument(upload, "--content-type"),
      contentLength: readFileSync(argument(upload, "--file")).length
    }));
  }
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
    const lastUpload = calls.findLastIndex((args) => args[2] === "upload");
    const existenceChecks = calls
      .map((args, index) => ({ args, index }))
      .filter(({ args }) => args[2] === "exists");
    assert.equal(existenceChecks.length, 4);
    assert.equal(existenceChecks.filter(({ index }) => index < firstUpload).length, 2);
    assert.equal(existenceChecks.filter(({ index }) => index > lastUpload).length, 2);
    const postUploadShows = calls.filter(
      (args, index) => args[2] === "show" && index > lastUpload,
    );
    assert.equal(postUploadShows.length, 2);
    assert.match(
      result.stdout,
      /verified private 3DScenesConfiguration\.json after upload plan/,
    );
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

  it("fails when a newly uploaded blob cannot be read back", () => {
    const { result } = runGuardedUpload("post-missing");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /was not readable after the upload plan completed/);
  });

  it("fails when Azure reads back different SHA-256 metadata", () => {
    const { result } = runGuardedUpload("post-corrupt");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected SHA-256 metadata/);
  });

  it("fails when Azure reads back the wrong configuration schema version", () => {
    const { result } = runGuardedUpload("post-schema");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /without schemaVersion v1\.0\.0/);
  });
});
