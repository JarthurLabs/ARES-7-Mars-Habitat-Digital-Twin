import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const expectedResourceGroup = "rg-ares7-lab-eus2";
export const expectedDeviceId = "ares7-simulator";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function validateScope(env, mode = "read") {
  const resourceGroup = required(env, "ARES7_RESOURCE_GROUP");
  if (resourceGroup !== expectedResourceGroup) {
    throw new Error(
      `refusing resource group ${resourceGroup}; expected ${expectedResourceGroup}`,
    );
  }

  const subscriptionId = required(env, "ARES7_SUBSCRIPTION_ID");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      subscriptionId,
    )
  ) {
    throw new Error(
      "ARES7_SUBSCRIPTION_ID must be one exact subscription UUID",
    );
  }

  if (mode === "write") {
    if (env.ARES7_MILESTONE !== "live-scenario") {
      throw new Error(
        "Azure writes are allowed only when ARES7_MILESTONE=live-scenario",
      );
    }
    if (env.ARES7_CONFIRM_WRITE !== `deploy-${expectedResourceGroup}`) {
      throw new Error(
        `set ARES7_CONFIRM_WRITE=deploy-${expectedResourceGroup} after reviewing What-If`,
      );
    }
    const maxSpendUsd = Number(env.ARES7_MAX_SPEND_USD);
    if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0 || maxSpendUsd > 10) {
      throw new Error(
        "ARES7_MAX_SPEND_USD must be a positive number no greater than 10",
      );
    }
  }

  if (mode === "cleanup") {
    if (env.ARES7_MILESTONE !== "cleanup") {
      throw new Error(
        "resource deletion is allowed only when ARES7_MILESTONE=cleanup",
      );
    }
    if (env.ARES7_CONFIRM_DELETE !== `delete-${expectedResourceGroup}`) {
      throw new Error(
        `set ARES7_CONFIRM_DELETE=delete-${expectedResourceGroup} after preserving evidence`,
      );
    }
  }

  return { resourceGroup, subscriptionId };
}

export function requireExactConfirmation(env, name, expected) {
  if (env[name] !== expected) {
    throw new Error(`${name} must equal ${expected}`);
  }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? `: ${(result.stderr || result.stdout).trim()}`
      : "";
    throw new Error(`${command} exited ${result.status}${detail}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

export function runAzure(scope, args, options = {}) {
  if (args.includes("--subscription")) {
    throw new Error("runAzure owns the exact --subscription argument");
  }
  return run(
    "az",
    [...args, "--subscription", scope.subscriptionId],
    options,
  );
}

export function runAzureJson(scope, args) {
  const output = runAzure(scope, [...args, "--output", "json"], {
    capture: true,
  });
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Azure CLI returned non-JSON output for az ${args.join(" ")}`);
  }
}

export function findSingleResourceName(scope, resourceType, namePrefix) {
  const names = runAzureJson(scope, [
    "resource",
    "list",
    "--resource-group",
    scope.resourceGroup,
    "--resource-type",
    resourceType,
    "--query",
    `[?starts_with(name, '${namePrefix}')].name`,
  ]);
  if (!Array.isArray(names) || names.length !== 1) {
    throw new Error(
      `expected exactly one ${resourceType} named ${namePrefix}*, found ${Array.isArray(names) ? names.length : "invalid output"}`,
    );
  }
  return names[0];
}

export function assertAzureAccount(scope) {
  const actual = runAzure(
    scope,
    ["account", "show", "--query", "id", "--output", "tsv"],
    {
      capture: true,
    },
  );
  if (actual.toLowerCase() !== scope.subscriptionId.toLowerCase()) {
    throw new Error(
      `Azure CLI is on subscription ${actual}; expected ${scope.subscriptionId}`,
    );
  }
}

export function handleFailure(error) {
  console.error(
    `ARES-7 guard stopped: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
