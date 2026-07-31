import { describe, expect, it } from "vitest";
import type { ControllerSnapshot, ControllerState } from "../src/contracts.js";
import { evaluateController } from "../src/stateMachine.js";

const base = (currentState: ControllerState): ControllerSnapshot => ({
  scenarioRunId: "run-7",
  tick: 0,
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

describe("emergency controller", () => {
  it("permits only one transition per tick", () => {
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

  it("stops at the human approval gate", () => {
    const risk = evaluateController({
      ...base("POWER_CRITICAL"),
      oxygenGeneratorOutputPct: 48,
      oxygenReservePct: 85,
    });
    expect(risk.nextState).toBe("LIFE_SUPPORT_RISK");
    expect(risk.operatorDecision).toBe("PENDING");

    const waiting = evaluateController({
      ...base("LIFE_SUPPORT_RISK"),
      operatorDecision: "PENDING",
    });
    expect(waiting.nextState).toBe("LIFE_SUPPORT_RISK");
    expect(waiting.shedNonCriticalLoad).toBe(false);
  });

  it("contains only after approval", () => {
    const result = evaluateController({
      ...base("LIFE_SUPPORT_RISK"),
      operatorDecision: "APPROVED",
    });
    expect(result.nextState).toBe("CONTAINMENT");
    expect(result.isolateLab).toBe(true);
    expect(result.isolateGreenhouse).toBe(true);
    expect(result.sealAirlock).toBe(true);
    expect(result.shedNonCriticalLoad).toBe(true);
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
