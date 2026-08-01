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

  it("emits readings only, even after the modeled incident boundary", () => {
    const laterReading = telemetryAt(60);

    expect(laterReading.nonessentialLoadKw).toBeGreaterThan(0);
    expect("loadSheddingActive" in laterReading).toBe(false);
    expect("emergencyBusActive" in laterReading).toBe(false);
    expect("airlockSealed" in laterReading).toBe(false);
    expect("greenhouseIsolated" in laterReading).toBe(false);
  });

  it("emits only events that have actually occurred", () => {
    const snapshot = snapshotAt(37);
    expect(snapshot.events.at(-1)?.id).toBe("evt-004");
    expect(snapshot.events.some(({ id }) => id === "evt-005")).toBe(false);
  });
});
