import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SCENE_ASSET_BLOB_NAME,
  SCENE_CONFIGURATION_BLOB_NAME,
  SCENE_CONTAINER_NAME,
  SCENES_SCHEMA_VERSION,
} from "../3d/export-scene-configuration.mjs";

export const EXPECTED_SCENE_BLOBS = Object.freeze({
  [SCENE_ASSET_BLOB_NAME]: Object.freeze({
    contentType: "model/gltf-binary",
  }),
  [SCENE_CONFIGURATION_BLOB_NAME]: Object.freeze({
    contentType: "application/json",
    schemaVersion: SCENES_SCHEMA_VERSION,
  }),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasOwn(value, key) {
  return value !== null && typeof value === "object" && Object.hasOwn(value, key);
}

function candidateValues(value, paths) {
  const candidates = [];
  for (const path of paths) {
    let current = value;
    let present = true;
    for (const key of path) {
      if (!hasOwn(current, key)) {
        present = false;
        break;
      }
      current = current[key];
    }
    if (present) candidates.push(current);
  }
  return candidates;
}

function requiredConsistentField(value, paths, label) {
  const candidates = candidateValues(value, paths);
  assert(candidates.length > 0, `${label} is missing from Azure evidence`);
  const first = candidates[0];
  assert(
    candidates.every((candidate) => Object.is(candidate, first)),
    `${label} has conflicting Azure evidence values`,
  );
  return first;
}

function normalizeMetadata(metadata, blobName) {
  assert(
    metadata !== null && typeof metadata === "object" && !Array.isArray(metadata),
    `${blobName} metadata is missing from Azure evidence`,
  );
  const normalized = new Map();
  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.toLowerCase();
    assert(
      !normalized.has(normalizedKey),
      `${blobName} metadata contains duplicate case-insensitive key ${key}`,
    );
    normalized.set(normalizedKey, value);
  }
  return normalized;
}

function toBuffer(value, label) {
  assert(
    Buffer.isBuffer(value) || value instanceof Uint8Array,
    `${label} must be bytes`,
  );
  return Buffer.from(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function listedNames(listedBlobNames) {
  assert(Array.isArray(listedBlobNames), "the Azure blob-name listing must be an array");
  return listedBlobNames.map((item) => {
    if (typeof item === "string") return item;
    assert(
      item !== null && typeof item === "object" && typeof item.name === "string",
      "the Azure blob-name listing contains an invalid item",
    );
    return item.name;
  });
}

function exactNameSet(names, label) {
  const expectedNames = Object.keys(EXPECTED_SCENE_BLOBS).sort();
  const uniqueNames = [...new Set(names)].sort();
  assert(uniqueNames.length === names.length, `${label} contains duplicate blob names`);
  assert(
    JSON.stringify(uniqueNames) === JSON.stringify(expectedNames),
    `${label} must contain exactly ${expectedNames.join(", ")}`,
  );
}

export function validateSceneBundleEvidence({
  storageAccount,
  container,
  listedBlobNames,
  blobs,
  localArtifacts,
  downloadedArtifacts,
}) {
  assert(
    storageAccount !== null && typeof storageAccount === "object",
    "storage account evidence must be an object",
  );
  for (const [field, expected] of [
    ["allowBlobPublicAccess", false],
    ["allowSharedKeyAccess", false],
    ["defaultToOAuthAuthentication", true],
    ["minimumTlsVersion", "TLS1_2"],
  ]) {
    const actual = requiredConsistentField(
      storageAccount,
      [[field], ["properties", field]],
      `storage account ${field}`,
    );
    assert(actual === expected, `storage account ${field} must equal ${String(expected)}`);
  }

  const containerName = requiredConsistentField(container, [["name"]], "container name");
  assert(containerName === SCENE_CONTAINER_NAME, `container name must equal ${SCENE_CONTAINER_NAME}`);
  const publicAccess = requiredConsistentField(
    container,
    [["publicAccess"], ["properties", "publicAccess"]],
    "container publicAccess",
  );
  assert(
    publicAccess === null || publicAccess === "",
    `${SCENE_CONTAINER_NAME} must have no anonymous public access`,
  );

  const names = listedNames(listedBlobNames);
  exactNameSet(names, "the Azure blob-name listing");
  assert(Array.isArray(blobs), "blob property evidence must be an array");
  const propertyNames = blobs.map((blob) =>
    requiredConsistentField(blob, [["name"]], "blob name"),
  );
  exactNameSet(propertyNames, "blob property evidence");
  const byName = new Map(blobs.map((blob) => [blob.name, blob]));

  assert(
    localArtifacts !== null && typeof localArtifacts === "object",
    "local artifacts must be an object",
  );
  assert(
    downloadedArtifacts !== null && typeof downloadedArtifacts === "object",
    "downloaded artifacts must be an object",
  );

  const verifiedBlobs = [];
  for (const [name, expected] of Object.entries(EXPECTED_SCENE_BLOBS)) {
    assert(hasOwn(localArtifacts, name), `local artifact ${name} is missing`);
    assert(hasOwn(downloadedArtifacts, name), `downloaded artifact ${name} is missing`);
    const localBytes = toBuffer(localArtifacts[name], `local artifact ${name}`);
    const downloadedBytes = toBuffer(
      downloadedArtifacts[name],
      `downloaded artifact ${name}`,
    );
    const localDigest = sha256(localBytes);
    const downloadedDigest = sha256(downloadedBytes);
    assert(
      downloadedBytes.equals(localBytes),
      `${name} downloaded bytes do not match the generated local artifact`,
    );
    assert(
      downloadedDigest === localDigest,
      `${name} downloaded SHA-256 does not match the generated local artifact`,
    );

    const blob = byName.get(name);
    const contentType = requiredConsistentField(
      blob,
      [["contentType"], ["properties", "contentSettings", "contentType"]],
      `${name} content type`,
    );
    assert(contentType === expected.contentType, `${name} content type must equal ${expected.contentType}`);
    const contentLength = requiredConsistentField(
      blob,
      [["contentLength"], ["properties", "contentLength"]],
      `${name} content length`,
    );
    assert(
      Number.isSafeInteger(contentLength) && contentLength === localBytes.length,
      `${name} content length does not match the generated local artifact`,
    );

    const metadata = normalizeMetadata(blob.metadata, name);
    assert(
      metadata.get("sha256") === localDigest,
      `${name} SHA-256 metadata does not match the generated local artifact`,
    );
    if (expected.schemaVersion) {
      assert(
        metadata.get("schemaversion") === expected.schemaVersion,
        `${name} schemaVersion metadata must equal ${expected.schemaVersion}`,
      );
    }
    verifiedBlobs.push({
      name,
      contentType,
      contentLength,
      sha256: localDigest,
      ...(expected.schemaVersion ? { schemaVersion: expected.schemaVersion } : {}),
    });
  }

  return {
    status: "ARES7_PRIVATE_SCENE_BUNDLE_VERIFIED",
    container: SCENE_CONTAINER_NAME,
    blobs: verifiedBlobs,
  };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function usage() {
  return [
    "usage: node scripts/azure/validate-scene-bundle-evidence.mjs",
    "  <storage-account.json> <container.json> <blob-names.json>",
    "  <asset-blob.json> <configuration-blob.json>",
    "  <local.glb> <local-config.json> <downloaded.glb> <downloaded-config.json>",
  ].join(" ");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 9) throw new Error(usage());
    const [
      accountPath,
      containerPath,
      blobNamesPath,
      assetBlobPath,
      configurationBlobPath,
      localAssetPath,
      localConfigurationPath,
      downloadedAssetPath,
      downloadedConfigurationPath,
    ] = args;
    const result = validateSceneBundleEvidence({
      storageAccount: readJson(accountPath, "storage account evidence"),
      container: readJson(containerPath, "container evidence"),
      listedBlobNames: readJson(blobNamesPath, "blob-name evidence"),
      blobs: [
        readJson(assetBlobPath, "scene asset blob evidence"),
        readJson(configurationBlobPath, "scene configuration blob evidence"),
      ],
      localArtifacts: {
        [SCENE_ASSET_BLOB_NAME]: readFileSync(localAssetPath),
        [SCENE_CONFIGURATION_BLOB_NAME]: readFileSync(localConfigurationPath),
      },
      downloadedArtifacts: {
        [SCENE_ASSET_BLOB_NAME]: readFileSync(downloadedAssetPath),
        [SCENE_CONFIGURATION_BLOB_NAME]: readFileSync(downloadedConfigurationPath),
      },
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      `ARES-7 guard stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
