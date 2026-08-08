import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertAzureAccount,
  expectedResourceGroup,
  findSingleResourceName,
  handleFailure,
  repositoryRoot,
  requireExactConfirmation,
  run,
  runAzure,
  runAzureJson,
  validateScope,
} from "./common.mjs";

try {
  const scope = validateScope(process.env, "write");
  requireExactConfirmation(
    process.env,
    "ARES7_CONFIRM_FUNCTION_DEPLOY",
    `functions-${expectedResourceGroup}`,
  );
  assertAzureAccount(scope);
  const artifact = resolve(
    repositoryRoot,
    process.env.ARES7_FUNCTION_ARTIFACT ?? "artifacts/released-package.zip",
  );
  if (!artifact.startsWith(repositoryRoot) || !existsSync(artifact)) {
    throw new Error("the Function package must exist inside the repository");
  }
  const entries = run("unzip", ["-Z1", artifact], { capture: true })
    .split("\n")
    .filter(Boolean);
  for (const required of ["host.json", "package.json", "dist/index.js"]) {
    if (!entries.includes(required)) throw new Error(`Function package is missing ${required}`);
  }
  if (entries.some((entry) => /(^|\/)\.env(?:\.|$)/.test(entry))) {
    throw new Error("Function package contains a forbidden .env file");
  }
  const functionAppName = findSingleResourceName(
    scope,
    "Microsoft.Web/sites",
    "func-ares7-",
  );
  const digest = createHash("sha256").update(readFileSync(artifact)).digest("hex");
  console.log(`deploying Function package sha256=${digest}`);
  runAzure(scope, [
    "functionapp",
    "deployment",
    "source",
    "config-zip",
    "--resource-group",
    scope.resourceGroup,
    "--name",
    functionAppName,
    "--src",
    artifact,
    "--build-remote",
    "false",
  ]);
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
  for (const required of ["ingestTelemetry", "emergencyController", "negotiateViewer"]) {
    if (!functions.includes(required)) {
      throw new Error(`deployed Function App did not discover ${required}`);
    }
  }
  console.log(`verified deployed Functions: ${functions.sort().join(", ")}`);
} catch (error) {
  handleFailure(error);
}
