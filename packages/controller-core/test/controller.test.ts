import { describe, expect, it } from "vitest";
import {
  evaluateController,
  formatSnapshotVersion,
  parseSnapshotVersion,
  snapshotVersionMatches,
  type ControllerSnapshot,
  type ControllerState,
} from "../src/index.js";

const base = (currentState: ControllerState): ControllerSnapshot => ({
  scenarioRunId: "run-7",
  tick: 0,
  snapshotVersion: formatSnapshotVersion("run-7", 0),
  currentState,
  operatorDecision: "NONE",
  recoveryStableTicks: 0,
  resolvedStableTicks: 0,
  dustOpacityPct: 5,
  solarOutputPct: 86,
  batteryChargePct: 92,
  oxygenGeneratorOutputPct: 100,
  oxygenReservePct: 96,
});

describe("shared controller", () => {
  it("permits only one transition per reading", () => {
    const result = evaluateController({
      ...base("NOMINAL"),
      dustOpacityPct: 94,
      solarOutputPct: 10,
      batteryChargePct: 54,
      oxygenGeneratorOutputPct: 48,
      oxygenReservePct: 85,
    });
    expect(result.nextState).toBe("STORM_WARNING");
  });

  it("emits no actuator commands while approval is pending", () => {
    const result = evaluateController({
      ...base("LIFE_SUPPORT_RISK"),
      operatorDecision: "PENDING",
    });
    expect(result.nextState).toBe("LIFE_SUPPORT_RISK");
    expect(Object.values(result.commands).every((active) => !active)).toBe(true);
  });

  it("emits containment commands only after approval", () => {
    const result = evaluateController({
      ...base("LIFE_SUPPORT_RISK"),
      operatorDecision: "APPROVED",
    });
    expect(result.nextState).toBe("CONTAINMENT");
    expect(result.commands).toMatchObject({
      isolateLab: true,
      isolateGreenhouse: true,
      sealAirlock: true,
      shedNonCriticalLoad: true,
      prioritizeLifeSupport: true,
      energizeEmergencyBus: true,
    });
  });

  it("requires two stable readings before recovery and resolution", () => {
    const recovering = evaluateController({
      ...base("CONTAINMENT"),
      solarOutputPct: 38,
      oxygenGeneratorOutputPct: 88,
      recoveryStableTicks: 1,
    });
    expect(recovering.nextState).toBe("RECOVERY");

    const resolved = evaluateController({
      ...base("RESTORATION"),
      solarOutputPct: 80,
      batteryChargePct: 72,
      oxygenReservePct: 96,
      resolvedStableTicks: 1,
    });
    expect(resolved.nextState).toBe("RESOLVED");
  });
});

describe("snapshot version helpers", () => {
  it("round-trips run IDs that contain punctuation", () => {
    const snapshotVersion = formatSnapshotVersion("local:drill-7", 12);
    expect(parseSnapshotVersion(snapshotVersion)).toEqual({
      scenarioRunId: "local:drill-7",
      tick: 12,
      snapshotVersion,
    });
    expect(snapshotVersionMatches({ scenarioRunId: "local:drill-7", tick: 12, snapshotVersion })).toBe(true);
  });

  it("rejects invalid ticks", () => {
    expect(() => formatSnapshotVersion("run-7", -1)).toThrow(/tick/);
  });
});
