import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  expectedResourceGroup,
  requireExactConfirmation,
  validateScope,
} from "./azure/common.mjs";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const base = {
  ARES7_RESOURCE_GROUP: expectedResourceGroup,
  ARES7_SUBSCRIPTION_ID: subscriptionId,
};

assert.deepEqual(validateScope(base, "read"), {
  resourceGroup: expectedResourceGroup,
  subscriptionId,
});
assert.throws(() =>
  validateScope({ ...base, ARES7_RESOURCE_GROUP: "rg-something-else" }, "read"),
);
assert.throws(() =>
  validateScope({ ...base, ARES7_SUBSCRIPTION_ID: "current" }, "read"),
);
assert.throws(() => validateScope(base, "write"));
assert.throws(() =>
  validateScope({ ...base, ARES7_MILESTONE: "live-scenario" }, "write"),
);
assert.throws(() =>
  validateScope(
    {
      ...base,
      ARES7_MILESTONE: "live-scenario",
      ARES7_CONFIRM_WRITE: `deploy-${expectedResourceGroup}`,
    },
    "write",
  ),
);
assert.deepEqual(
  validateScope(
    {
      ...base,
      ARES7_MILESTONE: "live-scenario",
      ARES7_CONFIRM_WRITE: `deploy-${expectedResourceGroup}`,
      ARES7_MAX_SPEND_USD: "10",
    },
    "write",
  ),
  { resourceGroup: expectedResourceGroup, subscriptionId },
);

assert.doesNotThrow(() =>
  requireExactConfirmation(
    { ARES7_CONFIRM_EVENT_WIRING: `wire-${expectedResourceGroup}` },
    "ARES7_CONFIRM_EVENT_WIRING",
    `wire-${expectedResourceGroup}`,
  ),
);
assert.throws(() =>
  requireExactConfirmation(
    { ARES7_CONFIRM_EVENT_WIRING: "yes" },
    "ARES7_CONFIRM_EVENT_WIRING",
    `wire-${expectedResourceGroup}`,
  ),
);
assert.throws(() => validateScope(base, "cleanup"));
assert.throws(() =>
  validateScope({ ...base, ARES7_MILESTONE: "cleanup" }, "cleanup"),
);
assert.deepEqual(
  validateScope(
    {
      ...base,
      ARES7_MILESTONE: "cleanup",
      ARES7_CONFIRM_DELETE: `delete-${expectedResourceGroup}`,
    },
    "cleanup",
  ),
  { resourceGroup: expectedResourceGroup, subscriptionId },
);

const cleanupSource = readFileSync("scripts/azure/cleanup.mjs", "utf8");
assert.match(cleanupSource, /runAzure\(scope, \["group", "delete"/);
assert.doesNotMatch(cleanupSource, /run\("az", \["group", "delete"/);

console.log(
  "validated exact resource-group, subscription, live-write, and cleanup guards",
);
