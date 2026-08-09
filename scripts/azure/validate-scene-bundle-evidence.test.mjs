import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import {
  SCENE_ASSET_BLOB_NAME,
  SCENE_CONFIGURATION_BLOB_NAME,
  SCENE_CONTAINER_NAME,
  SCENES_SCHEMA_VERSION,
} from "../3d/export-scene-configuration.mjs";
import { validateSceneBundleEvidence } from "./validate-scene-bundle-evidence.mjs";

const temporaryDirectories = [];
const assetBytes = Buffer.from("deterministic ARES-7 GLB test bytes");
const configurationBytes = Buffer.from('{"configuration":{"scenes":[]}}\n');

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function blob(name, bytes, contentType, metadata = {}) {
  return {
    name,
    metadata: {
      sha256: digest(bytes),
      ...metadata,
    },
    properties: {
      contentLength: bytes.length,
      contentSettings: { contentType },
    },
  };
}

function validEvidence() {
  return {
    storageAccount: {
      allowBlobPublicAccess: false,
      allowSharedKeyAccess: false,
      defaultToOAuthAuthentication: true,
      minimumTlsVersion: "TLS1_2",
    },
    container: {
      name: SCENE_CONTAINER_NAME,
      properties: { publicAccess: null },
    },
    listedBlobNames: [SCENE_ASSET_BLOB_NAME, SCENE_CONFIGURATION_BLOB_NAME],
    blobs: [
      blob(SCENE_ASSET_BLOB_NAME, assetBytes, "model/gltf-binary"),
      blob(
        SCENE_CONFIGURATION_BLOB_NAME,
        configurationBytes,
        "application/json",
        { schemaVersion: SCENES_SCHEMA_VERSION },
      ),
    ],
    localArtifacts: {
      [SCENE_ASSET_BLOB_NAME]: assetBytes,
      [SCENE_CONFIGURATION_BLOB_NAME]: configurationBytes,
    },
    downloadedArtifacts: {
      [SCENE_ASSET_BLOB_NAME]: Buffer.from(assetBytes),
      [SCENE_CONFIGURATION_BLOB_NAME]: Buffer.from(configurationBytes),
    },
  };
}

function cloneEvidence() {
  const source = validEvidence();
  return {
    ...structuredClone({
      storageAccount: source.storageAccount,
      container: source.container,
      listedBlobNames: source.listedBlobNames,
      blobs: source.blobs,
    }),
    localArtifacts: Object.fromEntries(
      Object.entries(source.localArtifacts).map(([name, bytes]) => [name, Buffer.from(bytes)]),
    ),
    downloadedArtifacts: Object.fromEntries(
      Object.entries(source.downloadedArtifacts).map(([name, bytes]) => [name, Buffer.from(bytes)]),
    ),
  };
}

describe("private 3D Scenes bundle evidence", () => {
  it("accepts exact private properties, metadata, content lengths, and downloaded bytes", () => {
    const result = validateSceneBundleEvidence(validEvidence());
    assert.equal(result.status, "ARES7_PRIVATE_SCENE_BUNDLE_VERIFIED");
    assert.equal(result.container, SCENE_CONTAINER_NAME);
    assert.deepEqual(
      result.blobs.map(({ name }) => name),
      [SCENE_ASSET_BLOB_NAME, SCENE_CONFIGURATION_BLOB_NAME],
    );
    assert.equal(result.blobs[0].sha256, digest(assetBytes));
    assert.equal(result.blobs[1].schemaVersion, SCENES_SCHEMA_VERSION);
  });

  it("rejects blob-list evidence that omitted application metadata", () => {
    const evidence = cloneEvidence();
    evidence.blobs[0].metadata = null;
    assert.throws(
      () => validateSceneBundleEvidence(evidence),
      /metadata is missing from Azure evidence/,
    );
  });

  it("rejects a well-formed metadata digest that is not the local digest", () => {
    const evidence = cloneEvidence();
    evidence.blobs[0].metadata.sha256 = "0".repeat(64);
    assert.throws(
      () => validateSceneBundleEvidence(evidence),
      /SHA-256 metadata does not match/,
    );
  });

  it("rejects downloaded bytes that differ even when Azure metadata looks exact", () => {
    const evidence = cloneEvidence();
    evidence.downloadedArtifacts[SCENE_ASSET_BLOB_NAME][0] ^= 0xff;
    assert.throws(
      () => validateSceneBundleEvidence(evidence),
      /downloaded bytes do not match/,
    );
  });

  it("rejects an incorrect configuration schema version", () => {
    const evidence = cloneEvidence();
    evidence.blobs[1].metadata.schemaVersion = "v0.0.0";
    assert.throws(
      () => validateSceneBundleEvidence(evidence),
      /schemaVersion metadata must equal/,
    );
  });

  it("accepts Azure's case normalization for configuration metadata", () => {
    const evidence = cloneEvidence();
    evidence.blobs[1].metadata.schemaversion =
      evidence.blobs[1].metadata.schemaVersion;
    delete evidence.blobs[1].metadata.schemaVersion;
    assert.doesNotThrow(() => validateSceneBundleEvidence(evidence));
  });

  it("rejects public, missing, or conflicting container access evidence", () => {
    const publicEvidence = cloneEvidence();
    publicEvidence.container.properties.publicAccess = "blob";
    assert.throws(
      () => validateSceneBundleEvidence(publicEvidence),
      /must have no anonymous public access/,
    );

    const missingEvidence = cloneEvidence();
    delete missingEvidence.container.properties.publicAccess;
    assert.throws(
      () => validateSceneBundleEvidence(missingEvidence),
      /publicAccess is missing/,
    );

    const conflictingEvidence = cloneEvidence();
    conflictingEvidence.container.publicAccess = null;
    conflictingEvidence.container.properties.publicAccess = "container";
    assert.throws(
      () => validateSceneBundleEvidence(conflictingEvidence),
      /conflicting Azure evidence values/,
    );
  });

  it("rejects insecure storage account evidence", () => {
    for (const [field, value] of [
      ["allowBlobPublicAccess", true],
      ["allowSharedKeyAccess", true],
      ["defaultToOAuthAuthentication", false],
      ["minimumTlsVersion", "TLS1_0"],
    ]) {
      const evidence = cloneEvidence();
      evidence.storageAccount[field] = value;
      assert.throws(
        () => validateSceneBundleEvidence(evidence),
        new RegExp(`storage account ${field} must equal`),
      );
    }
  });

  it("rejects extra, missing, or duplicate blob names", () => {
    for (const names of [
      [SCENE_ASSET_BLOB_NAME],
      [SCENE_ASSET_BLOB_NAME, SCENE_CONFIGURATION_BLOB_NAME, "unexpected.txt"],
      [SCENE_ASSET_BLOB_NAME, SCENE_ASSET_BLOB_NAME],
    ]) {
      const evidence = cloneEvidence();
      evidence.listedBlobNames = names;
      assert.throws(() => validateSceneBundleEvidence(evidence), /blob-name listing/);
    }
  });

  it("rejects wrong content type or content length", () => {
    const wrongType = cloneEvidence();
    wrongType.blobs[0].properties.contentSettings.contentType = "application/octet-stream";
    assert.throws(() => validateSceneBundleEvidence(wrongType), /content type must equal/);

    const wrongLength = cloneEvidence();
    wrongLength.blobs[0].properties.contentLength += 1;
    assert.throws(() => validateSceneBundleEvidence(wrongLength), /content length does not match/);
  });

  it("runs as a fail-closed CLI and emits a normalized verification summary", () => {
    const evidence = validEvidence();
    const directory = mkdtempSync(join(tmpdir(), "ares7-scene-evidence-test-"));
    temporaryDirectories.push(directory);
    const downloads = join(directory, "downloads");
    mkdirSync(downloads);
    const paths = {
      account: join(directory, "account.json"),
      container: join(directory, "container.json"),
      names: join(directory, "names.json"),
      assetBlob: join(directory, "asset-blob.json"),
      configurationBlob: join(directory, "configuration-blob.json"),
      localAsset: join(directory, "local.glb"),
      localConfiguration: join(directory, "local-config.json"),
      downloadedAsset: join(downloads, "downloaded.glb"),
      downloadedConfiguration: join(downloads, "downloaded-config.json"),
    };
    for (const [path, value] of [
      [paths.account, evidence.storageAccount],
      [paths.container, evidence.container],
      [paths.names, evidence.listedBlobNames],
      [paths.assetBlob, evidence.blobs[0]],
      [paths.configurationBlob, evidence.blobs[1]],
    ]) {
      writeFileSync(path, JSON.stringify(value));
    }
    writeFileSync(paths.localAsset, assetBytes);
    writeFileSync(paths.localConfiguration, configurationBytes);
    writeFileSync(paths.downloadedAsset, assetBytes);
    writeFileSync(paths.downloadedConfiguration, configurationBytes);

    const result = spawnSync(
      process.execPath,
      ["scripts/azure/validate-scene-bundle-evidence.mjs", ...Object.values(paths)],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      JSON.parse(result.stdout).status,
      "ARES7_PRIVATE_SCENE_BUNDLE_VERIFIED",
    );
  });
});
