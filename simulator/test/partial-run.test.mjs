import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const runId = "00000000-0000-4000-8000-000000000007";
const simulatorEntryPoint = fileURLToPath(new URL("../src/index.mjs", import.meta.url));

function runSimulator(environment) {
  return spawnSync(
    process.execPath,
    [simulatorEntryPoint, "--dry-run", "--interval", "0"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ARES7_SCENARIO_RUN_ID: runId,
        ARES7_DUPLICATE_DELAY_SECONDS: "0",
        ARES7_APPROVAL_GATE_DELAY_SECONDS: "0",
        ...environment,
      },
    },
  );
}

function emittedFrames(result) {
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}

describe("partial scenario runs", () => {
  it("emits tick zero alone when the ingest barrier phase disables duplication", () => {
    const result = runSimulator({
      ARES7_START_TICK: "0",
      ARES7_END_TICK: "0",
      ARES7_DUPLICATE_TICK: "",
    });

    assert.equal(result.status, 0, result.stderr);
    const frames = emittedFrames(result);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].tick, 0);
    assert.equal(frames[0].scenarioRunId, runId);
  });

  it("emits ticks one through four without crossing the approval boundary", () => {
    const result = runSimulator({
      ARES7_START_TICK: "1",
      ARES7_END_TICK: "4",
      ARES7_DUPLICATE_TICK: "",
    });

    assert.equal(result.status, 0, result.stderr);
    const frames = emittedFrames(result);
    assert.deepEqual(frames.map(({ tick }) => tick), [1, 2, 3, 4]);
  });

  it("emits only post-approval ticks and preserves the exact tick-eleven duplicate", () => {
    const result = runSimulator({
      ARES7_START_TICK: "5",
      ARES7_END_TICK: "11",
      ARES7_DUPLICATE_TICK: "11",
    });

    assert.equal(result.status, 0, result.stderr);
    const frames = emittedFrames(result);
    assert.deepEqual(frames.map(({ tick }) => tick), [5, 6, 7, 8, 9, 10, 11, 11]);
    assert.deepEqual(frames.at(-1), frames.at(-2));
    assert.match(result.stdout, /resent exact duplicate tick=11/);
  });

  it("rejects a duplicate outside the selected range", () => {
    const result = runSimulator({
      ARES7_START_TICK: "5",
      ARES7_END_TICK: "11",
      ARES7_DUPLICATE_TICK: "4",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be inside the selected scenario tick range/);
  });
});
