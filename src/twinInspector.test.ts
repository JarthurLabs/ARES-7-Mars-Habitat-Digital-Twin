import { describe, expect, it } from "vitest";
import { MODULES } from "./habitat";
import { telemetryWithControllerCommands } from "./localControllerAdapter";
import { nominalTelemetry } from "./simulation";
import { inspectTwin } from "./twinInspector";

describe("twin inspector", () => {
  it("ties the selected twin to the visible run, tick, and v2 snapshot", () => {
    const telemetry = telemetryWithControllerCommands(nominalTelemetry(), {
      isolateLab: false,
      isolateGreenhouse: false,
      sealAirlock: false,
      shedNonCriticalLoad: false,
      prioritizeLifeSupport: false,
      energizeEmergencyBus: false,
    });
    const result = inspectTwin(MODULES[4], telemetry, "local-replay-001", 12.9);

    expect(result.twinId).toBe("ares7-battery-alpha");
    expect(result.model).toBe("dtmi:ares7:BatteryBank;2");
    expect(result.tick).toBe(12);
    expect(result.snapshotVersion).toBe("v2:local-replay-001:tick:12");
    expect(result.relatedTwins).toContain("ares7-solar-alpha");
    expect(result.properties.batteryPercent).toBe(94.2);
  });

  it("maps every selectable scene module to an inspectable graph twin", () => {
    const telemetry = telemetryWithControllerCommands(nominalTelemetry(), {
      isolateLab: false,
      isolateGreenhouse: true,
      sealAirlock: true,
      shedNonCriticalLoad: true,
      prioritizeLifeSupport: true,
      energizeEmergencyBus: true,
    });

    const ids = MODULES.map((module) => inspectTwin(module, telemetry, "run", 0).twinId);
    expect(new Set(ids).size).toBe(MODULES.length);
  });
});
