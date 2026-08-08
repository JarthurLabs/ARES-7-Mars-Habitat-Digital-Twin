import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { validateAres7Glb } from "../3d/validate-glb.mjs";
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

const blobName = "ares7-habitat-segmented.glb";
const containerName = "ares7-3d-scenes";

try {
  const scope = validateScope(process.env, "write");
  requireExactConfirmation(
    process.env,
    "ARES7_CONFIRM_SCENE_UPLOAD",
    `upload-${blobName}`,
  );
  assertAzureAccount(scope);
  const asset = resolve(
    repositoryRoot,
    process.env.ARES7_SCENE_ASSET ?? `models/3d/${blobName}`,
  );
  const relativeAsset = relative(repositoryRoot, asset);
  if (relativeAsset.startsWith("..") || relativeAsset === "" || !existsSync(asset)) {
    throw new Error("the scene asset must exist inside the repository");
  }
  const bytes = readFileSync(asset);
  validateAres7Glb(bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const storageName = findSingleResourceName(
    scope,
    "Microsoft.Storage/storageAccounts",
    "stares7",
  );
  const exists = runAzure(
    scope,
    [
      "storage",
      "blob",
      "exists",
      "--account-name",
      storageName,
      "--container-name",
      containerName,
      "--name",
      blobName,
      "--auth-mode",
      "login",
      "--query",
      "exists",
      "--output",
      "tsv",
    ],
    { capture: true },
  );
  if (exists === "true") {
    const metadata = runAzureJson(scope, [
      "storage",
      "blob",
      "show",
      "--account-name",
      storageName,
      "--container-name",
      containerName,
      "--name",
      blobName,
      "--auth-mode",
      "login",
      "--query",
      "metadata",
    ]);
    if (metadata?.sha256 !== digest) {
      throw new Error(`${blobName} already exists with a different digest; refusing to overwrite it`);
    }
    console.log(`verified existing private scene asset sha256=${digest}`);
  } else if (exists === "false") {
    runAzure(scope, [
      "storage",
      "blob",
      "upload",
      "--account-name",
      storageName,
      "--container-name",
      containerName,
      "--name",
      blobName,
      "--file",
      asset,
      "--auth-mode",
      "login",
      "--overwrite",
      "false",
      "--content-type",
      "model/gltf-binary",
      "--metadata",
      `sha256=${digest}`,
      "--output",
      "none",
    ]);
    console.log(`uploaded private scene asset sha256=${digest}`);
  } else {
    throw new Error(`unexpected blob existence result ${exists}`);
  }
} catch (error) {
  handleFailure(error);
}
