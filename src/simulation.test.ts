import { describe, expect, it } from "vitest";
import { phaseAt, snapshotAt, telemetryAt } from "./simulation";

describe("ARES-7 deterministic storm simulation", () => {
  it("moves through the documented incident phases", () => {
    expect(phaseAt(0)).toBe("watch");
    expect(phaseAt(20)).toBe("storm");
    expect(phaseAt(40)).toBe("degraded");
    expect(phaseAt(55)).toBe("containment");
    expect(phaseAt(80)).toBe("recovery");
  });

  it("sheds load before recovery and keeps critical systems powered", () => {
    const before = telemetryAt(44);
    const after = telemetryAt(60);

    expect(before.loadSheddingActive).toBe(false);
    expect(after.loadSheddingActive).toBe(true);
    expect(after.nonessentialLoadKw).toBe(0);
    expect(after.emergencyBusActive).toBe(true);
    expect(after.airlockSealed).toBe(true);
  });

  it("emits only events that have actually occurred", () => {
    const snapshot = snapshotAt(37);
    expect(snapshot.events.at(-1)?.id).toBe("evt-004");
    expect(snapshot.events.some(({ id }) => id === "evt-005")).toBe(false);
  });
});
