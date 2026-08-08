import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  SCENE_ASSET_BLOB_NAME,
  SCENE_CONFIGURATION_BLOB_NAME,
  SCENE_CONTAINER_NAME,
  SCENES_SCHEMA_VERSION,
} from "../3d/export-scene-configuration.mjs";
import { validateAres7Glb } from "../3d/validate-glb.mjs";
import { validateAres7SceneConfiguration } from "../3d/validate-scene-configuration.mjs";
import {
  assertAzureAccount,
  findSingleResourceName,
  handleFailure,
  repositoryRoot,
  requireExactConfirmation,
  runAzure,
  runAzureJson,
  validateScope,
} from "./common.mjs";

function repositoryFile(input, label) {
  const candidate = resolve(repositoryRoot, input);
  if (!existsSync(candidate)) {
    throw new Error(`${label} must exist inside the repository`);
  }
  const realRepositoryRoot = realpathSync(repositoryRoot);
  const file = realpathSync(candidate);
  const repositoryRelative = relative(realRepositoryRoot, file);
  if (
    repositoryRelative.startsWith("..") ||
    repositoryRelative === "" ||
    !statSync(file).isFile()
  ) {
    throw new Error(`${label} must exist inside the repository`);
  }
  return file;
}

function verifyPrivateStorageAccount(scope, storageName) {
  const properties = runAzureJson(scope, [
    "storage",
    "account",
    "show",
    "--name",
    storageName,
    "--resource-group",
    scope.resourceGroup,
    "--query",
    "{allowBlobPublicAccess:allowBlobPublicAccess,allowSharedKeyAccess:allowSharedKeyAccess,defaultToOAuthAuthentication:defaultToOAuthAuthentication,minimumTlsVersion:minimumTlsVersion}",
  ]);
  if (properties?.allowBlobPublicAccess !== false) {
    throw new Error("scene upload requires anonymous blob access to be disabled at the storage account");
  }
  if (properties.allowSharedKeyAccess !== false) {
    throw new Error("scene upload requires Shared Key authorization to be disabled");
  }
  if (properties.defaultToOAuthAuthentication !== true) {
    throw new Error("scene upload requires OAuth to be the storage account default");
  }
  if (properties.minimumTlsVersion !== "TLS1_2") {
    throw new Error("scene upload requires storage minimumTlsVersion TLS1_2");
  }
}

function inspectBlob(scope, storageName, artifact) {
  const exists = runAzure(
    scope,
    [
      "storage",
      "blob",
      "exists",
      "--account-name",
      storageName,
      "--container-name",
      SCENE_CONTAINER_NAME,
      "--name",
      artifact.blobName,
      "--auth-mode",
      "login",
      "--query",
      "exists",
      "--output",
      "tsv",
    ],
    { capture: true },
  );
  if (exists === "false") return false;
  if (exists !== "true") {
    throw new Error(`unexpected blob existence result ${exists}`);
  }
  const existing = runAzureJson(scope, [
    "storage",
    "blob",
    "show",
    "--account-name",
    storageName,
    "--container-name",
    SCENE_CONTAINER_NAME,
    "--name",
    artifact.blobName,
    "--auth-mode",
    "login",
    "--query",
    "{metadata:metadata,contentType:properties.contentSettings.contentType}",
  ]);
  if (existing?.metadata?.sha256 !== artifact.digest) {
    throw new Error(
      `${artifact.blobName} already exists without the expected SHA-256 metadata; refusing to overwrite it`,
    );
  }
  if (existing.contentType !== artifact.contentType) {
    throw new Error(
      `${artifact.blobName} already exists with content type ${existing.contentType}; expected ${artifact.contentType}`,
    );
  }
  return true;
}

function uploadBlob(scope, storageName, artifact) {
  const metadata = [`sha256=${artifact.digest}`];
  if (artifact.schemaVersion) metadata.push(`schemaVersion=${artifact.schemaVersion}`);
  runAzure(scope, [
    "storage",
    "blob",
    "upload",
    "--account-name",
    storageName,
    "--container-name",
    SCENE_CONTAINER_NAME,
    "--name",
    artifact.blobName,
    "--file",
    artifact.file,
    "--auth-mode",
    "login",
    "--overwrite",
    "false",
    "--content-type",
    artifact.contentType,
    "--metadata",
    ...metadata,
    "--output",
    "none",
  ]);
}

try {
  const scope = validateScope(process.env, "write");
  requireExactConfirmation(
    process.env,
    "ARES7_CONFIRM_SCENE_UPLOAD",
    "upload-ares7-3d-scenes-bundle",
  );
  assertAzureAccount(scope);
  const asset = repositoryFile(
    process.env.ARES7_SCENE_ASSET ?? `models/3d/${SCENE_ASSET_BLOB_NAME}`,
    "the scene asset",
  );
  const configurationFile = repositoryFile(
    process.env.ARES7_SCENE_CONFIGURATION ??
      `models/3d/${SCENE_CONFIGURATION_BLOB_NAME}`,
    "the scene configuration",
  );
  const assetBytes = readFileSync(asset);
  validateAres7Glb(assetBytes);
  const configurationBytes = readFileSync(configurationFile);
  const configuration = JSON.parse(configurationBytes.toString("utf8"));
  const storageName = findSingleResourceName(
    scope,
    "Microsoft.Storage/storageAccounts",
    "stares7",
  );
  verifyPrivateStorageAccount(scope, storageName);
  validateAres7SceneConfiguration(configuration, {
    glbBuffer: assetBytes,
    expectedStorageAccountName: storageName,
  });

  const artifacts = [
    {
      blobName: SCENE_ASSET_BLOB_NAME,
      file: asset,
      contentType: "model/gltf-binary",
      digest: createHash("sha256").update(assetBytes).digest("hex"),
    },
    {
      blobName: SCENE_CONFIGURATION_BLOB_NAME,
      file: configurationFile,
      contentType: "application/json",
      digest: createHash("sha256").update(configurationBytes).digest("hex"),
      schemaVersion: SCENES_SCHEMA_VERSION,
    },
  ];
  const uploadPlan = artifacts.map((artifact) => ({
    artifact,
    exists: inspectBlob(scope, storageName, artifact),
  }));
  for (const { artifact, exists } of uploadPlan) {
    if (exists) {
      console.log(
        `verified existing private ${artifact.blobName} sha256=${artifact.digest}`,
      );
      continue;
    }
    uploadBlob(scope, storageName, artifact);
    console.log(`uploaded private ${artifact.blobName} sha256=${artifact.digest}`);
  }
} catch (error) {
  handleFailure(error);
}
