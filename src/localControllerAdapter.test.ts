import { describe, expect, it } from "vitest";
import {
  applyLocalOperatorDecision,
  createLocalController,
  ingestLocalReading,
  telemetryWithControllerCommands,
} from "./localControllerAdapter";
import { telemetryAt } from "./simulation";

function replayToApprovalGate() {
  let state = createLocalController("local-test-run");
  for (let second = 0; second <= 45; second += 1) {
    state = ingestLocalReading(state, telemetryAt(second), second);
    if (state.currentState === "LIFE_SUPPORT_RISK") return { state, second };
  }
  throw new Error("Replay did not reach the approval gate");
}

describe("local controller adapter", () => {
  it("reaches the approval gate without applying commands", () => {
    const { state, second } = replayToApprovalGate();
    const telemetry = telemetryWithControllerCommands(telemetryAt(second), state.decision.commands);

    expect(state.operatorDecision).toBe("PENDING");
    expect(telemetry.loadSheddingActive).toBe(false);
    expect(telemetry.emergencyBusActive).toBe(false);
    expect(telemetry.airlockSealed).toBe(false);
    expect(telemetry.greenhouseIsolated).toBe(false);
  });

  it("applies the shared reducer command output after approval", () => {
    const { state, second } = replayToApprovalGate();
    const approved = applyLocalOperatorDecision(state, telemetryAt(second), "APPROVED");
    const telemetry = telemetryWithControllerCommands(telemetryAt(second), approved.decision.commands);

    expect(approved.currentState).toBe("CONTAINMENT");
    expect(telemetry).toMatchObject({
      loadSheddingActive: true,
      emergencyBusActive: true,
      airlockSealed: true,
      greenhouseIsolated: true,
      nonessentialLoadKw: 0,
    });
  });

  it("does not reduce the same sensor tick twice", () => {
    const initial = createLocalController("local-test-run");
    const once = ingestLocalReading(initial, telemetryAt(20), 20);
    const duplicate = ingestLocalReading(once, telemetryAt(20.9), 20);
    expect(duplicate).toBe(once);
  });

  it("releases controller commands after stable recovery readings", () => {
    const gate = replayToApprovalGate();
    let state = applyLocalOperatorDecision(gate.state, telemetryAt(gate.second), "APPROVED");
    for (let second = gate.second + 1; second <= 90; second += 1) {
      state = ingestLocalReading(state, telemetryAt(second), second);
    }

    expect(state.currentState).toBe("RESOLVED");
    expect(Object.values(state.decision.commands).every((active) => !active)).toBe(true);
  });

  it("is deterministic for the same reading sequence", () => {
    const left = replayToApprovalGate();
    const right = replayToApprovalGate();
    expect(left).toEqual(right);
  });
});
