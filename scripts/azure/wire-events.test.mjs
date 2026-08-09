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
import { expectedResourceGroup } from "./common.mjs";

const subscriptionId = "11111111-1111-4111-8111-111111111111";
const digitalTwinsName = "adt-ares7-test";
const endpointName = "ares7-controller-topic";
const routeName = "ares7-controller-updates";
const routeFilter = "type = 'Microsoft.DigitalTwins.Twin.Update' AND (subject = 'ares7-clock' OR subject = 'ares7-habitat')";
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runEventWiring(mode = "missing-route") {
  const directory = mkdtempSync(join(tmpdir(), "ares7-event-wiring-test-"));
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
  const resourceType = args[args.indexOf("--resource-type") + 1];
  console.log(JSON.stringify([
    resourceType === "Microsoft.Web/sites" ? "func-ares7-test" : "${digitalTwinsName}"
  ]));
} else if (args[0] === "functionapp" && args[1] === "function" && args[2] === "list") {
  console.log(JSON.stringify(["ingestTelemetry", "emergencyController"]));
} else if (args[0] === "deployment" && args[1] === "group") {
  // Validation, What-If, and the reviewed deployment are intentionally allowed.
} else if (args[0] === "dt" && args[1] === "endpoint" && args[2] === "wait") {
  if (mode === "wait-failure") {
    console.error("endpoint did not reach the created state");
    process.exitCode = 3;
  }
} else if (args[0] === "dt" && args[1] === "route" && args[2] === "list") {
  const routes = mode === "missing-route" || mode === "wait-failure"
    ? []
    : [{
        id: "${routeName}",
        endpointName: mode === "drift" ? "unexpected-endpoint" : "${endpointName}",
        filter: ${JSON.stringify(routeFilter)}
      }];
  console.log(JSON.stringify(routes));
} else if (args[0] === "dt" && args[1] === "route" && args[2] === "create") {
  // The test inspects argv after the guarded script exits.
} else if (args[0] === "dt" && args[1] === "route" && args[2] === "show") {
  console.log(JSON.stringify({
    id: "${routeName}",
    endpointName: "${endpointName}",
    filter: ${JSON.stringify(routeFilter)}
  }));
} else {
  console.error("unexpected fake az call " + args.join(" "));
  process.exitCode = 2;
}
`,
  );
  chmodSync(fakeAz, 0o755);

  const result = spawnSync(process.execPath, ["scripts/azure/wire-events.mjs"], {
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
      ARES7_CONFIRM_EVENT_WIRING: `wire-${expectedResourceGroup}`,
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

function assertExactScope(calls) {
  for (const args of calls) {
    assert.equal(args[args.indexOf("--subscription") + 1], subscriptionId);
    if (args[0] !== "account") {
      assert.equal(args[args.indexOf("--resource-group") + 1], expectedResourceGroup);
    }
  }
}

function assertNoDestructiveEventOperation(calls) {
  const eventCalls = calls.filter(
    (args) => args[0] === "dt" && ["endpoint", "route"].includes(args[1]),
  );
  assert(!eventCalls.some((args) => ["delete", "update"].includes(args[2])));
  assert(!eventCalls.some((args) => args.includes("--force")));
}

describe("guarded Event Grid and Digital Twins wiring", () => {
  it("uses Azure's native endpoint waiter with the exact immutable scope", () => {
    const { calls, result } = runEventWiring();
    assert.equal(result.status, 0, result.stderr);
    assertExactScope(calls);
    const wait = calls.find(
      (args) => args[0] === "dt" && args[1] === "endpoint" && args[2] === "wait",
    );
    assert(wait);
    assert.equal(wait[wait.indexOf("--dt-name") + 1], digitalTwinsName);
    assert.equal(wait[wait.indexOf("--endpoint-name") + 1], endpointName);
    assert(wait.includes("--created"));
    assert.equal(wait[wait.indexOf("--interval") + 1], "10");
    assert.equal(wait[wait.indexOf("--timeout") + 1], "180");
    const routeCreate = calls.find(
      (args) => args[0] === "dt" && args[1] === "route" && args[2] === "create",
    );
    assert(routeCreate);
    assert.equal(routeCreate[routeCreate.indexOf("--route-name") + 1], routeName);
    assert.equal(routeCreate[routeCreate.indexOf("--endpoint-name") + 1], endpointName);
    assert.equal(routeCreate[routeCreate.indexOf("--filter") + 1], routeFilter);
    assertNoDestructiveEventOperation(calls);
  });

  it("fails before route operations when the native endpoint waiter fails", () => {
    const { calls, result } = runEventWiring("wait-failure");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /endpoint did not reach the created state/);
    assert(!calls.some((args) => args[0] === "dt" && args[1] === "route"));
    assertExactScope(calls);
    assertNoDestructiveEventOperation(calls);
  });

  it("refuses a drifted route without replacing or deleting it", () => {
    const { calls, result } = runEventWiring("drift");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exists with drift/);
    assert(!calls.some(
      (args) => args[0] === "dt" && args[1] === "route" && args[2] === "create",
    ));
    assertExactScope(calls);
    assertNoDestructiveEventOperation(calls);
  });
});
