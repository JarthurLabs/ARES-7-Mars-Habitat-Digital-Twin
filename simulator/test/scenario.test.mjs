import test from "node:test";
import assert from "node:assert/strict";
import { buildFrame, payloadHashFor, SCENARIO_TICKS } from "../src/scenario.mjs";

const runId = "00000000-0000-4000-8000-000000000007";
const sample = "2026-07-31T00:00:00.000Z";

test("scenario emits the documented number of coherent ticks", () => {
  assert.equal(SCENARIO_TICKS, 12);
  for (let tick = 0; tick < SCENARIO_TICKS; tick += 1) {
    const frame = buildFrame(tick, runId, sample);
    assert.equal(frame.tick, tick);
    assert.equal(frame.simulatedMinute, tick * 30);
    assert.equal(frame.scenarioRunId, runId);
    assert.equal(frame.sampleUtc, sample);
    assert.equal(frame.schemaVersion, "2.0");
    assert.equal(frame.snapshotVersion, `v2:${runId}:tick:${tick}`);
    assert.match(frame.payloadHash, /^[a-f0-9]{64}$/);
    assert.equal(frame.payloadHash, payloadHashFor(frame));
  }
});

test("storm creates a measurable solar and life-support failure boundary", () => {
  const baseline = buildFrame(0, runId, sample);
  const critical = buildFrame(4, runId, sample);
  assert.ok(critical.power.solarOutputKw < baseline.power.solarOutputKw * 0.15);
  assert.ok(critical.power.batteryChargePct <= 60);
  assert.ok(critical.lifeSupport.oxygenGeneratorOutputPct <= 50);
  assert.ok(critical.lifeSupport.oxygenReservePct <= 86);
});

test("raw telemetry never assumes an unapproved controller action", () => {
  const pendingGate = buildFrame(5, runId, sample);
  const recovery = buildFrame(8, runId, sample);
  const resolved = buildFrame(11, runId, sample);
  assert.equal(pendingGate.power.busDemandKw, 34);
  assert.equal(pendingGate.lifeSupport.allocatedPowerKw, 14);
  assert.equal(recovery.power.busDemandKw, 34);
  assert.ok(recovery.lifeSupport.oxygenGeneratorOutputPct >= 85);
  assert.ok(resolved.power.batteryChargePct >= 70);
  assert.ok(resolved.lifeSupport.oxygenReservePct >= 95);
  assert.ok(resolved.environment.solarIrradiancePct >= 75);
});
