import { formatSnapshotVersion } from "@ares7/controller-core";
import type { ModuleDefinition, Telemetry } from "./types";

export interface TwinInspectorSnapshot {
  label: string;
  model: string;
  twinId: string;
  relatedTwins: readonly string[];
  scenarioRunId: string;
  tick: number;
  snapshotVersion: string;
  properties: Readonly<Record<string, string | number | boolean>>;
}

interface TwinDefinition {
  model: string;
  twinId: string;
  relatedTwins: readonly string[];
  properties: (telemetry: Telemetry) => TwinInspectorSnapshot["properties"];
}

const DEFINITIONS: Readonly<Record<string, TwinDefinition>> = Object.freeze({
  "command-01": {
    model: "dtmi:ares7:Module;2",
    twinId: "ares7-module-command",
    relatedTwins: ["ares7-habitat", "ares7-battery-alpha", "ares7-life-support"],
    properties: (telemetry) => ({
      crewLoadKw: telemetry.crewLoadKw,
      nonessentialLoadKw: telemetry.nonessentialLoadKw,
      loadSheddingActive: telemetry.loadSheddingActive,
      emergencyBusActive: telemetry.emergencyBusActive,
    }),
  },
  "hab-01": {
    model: "dtmi:ares7:Module;2",
    twinId: "ares7-module-crew",
    relatedTwins: ["ares7-habitat", "ares7-battery-alpha", "ares7-life-support", "ares7-airlock-main"],
    properties: (telemetry) => ({
      habitatPressureKpa: telemetry.habitatPressureKpa,
      oxygenPercent: telemetry.oxygenPercent,
      co2Ppm: telemetry.co2Ppm,
      airlockSealed: telemetry.airlockSealed,
    }),
  },
  "lss-01": {
    model: "dtmi:ares7:LifeSupport;2",
    twinId: "ares7-life-support",
    relatedTwins: ["ares7-module-command", "ares7-module-crew", "ares7-module-lab", "ares7-module-greenhouse"],
    properties: (telemetry) => ({
      oxygenPercent: telemetry.oxygenPercent,
      generatorOutputPercent: telemetry.oxygenGeneratorOutputPercent,
      oxygenReservePercent: telemetry.oxygenReservePercent,
      lifeSupportLoadKw: telemetry.lifeSupportLoadKw,
    }),
  },
  "greenhouse-01": {
    model: "dtmi:ares7:Module;2",
    twinId: "ares7-module-greenhouse",
    relatedTwins: ["ares7-habitat", "ares7-battery-alpha", "ares7-life-support"],
    properties: (telemetry) => ({
      isolated: telemetry.greenhouseIsolated,
      oxygenPercent: telemetry.oxygenPercent,
      habitatPressureKpa: telemetry.habitatPressureKpa,
      nonessentialLoadKw: telemetry.nonessentialLoadKw,
    }),
  },
  "power-01": {
    model: "dtmi:ares7:BatteryBank;2",
    twinId: "ares7-battery-alpha",
    relatedTwins: ["ares7-solar-alpha", "ares7-module-command", "ares7-module-crew", "ares7-module-lab", "ares7-module-greenhouse"],
    properties: (telemetry) => ({
      batteryPercent: telemetry.batteryPercent,
      solarOutputKw: telemetry.solarOutputKw,
      solarOutputPercent: telemetry.solarOutputPercent,
      emergencyBusActive: telemetry.emergencyBusActive,
    }),
  },
  "airlock-02": {
    model: "dtmi:ares7:Airlock;2",
    twinId: "ares7-airlock-main",
    relatedTwins: ["ares7-module-crew"],
    properties: (telemetry) => ({
      sealed: telemetry.airlockSealed,
      habitatPressureKpa: telemetry.habitatPressureKpa,
      externalTemperatureC: telemetry.externalTemperatureC,
      commsLatencyMs: telemetry.commsLatencyMs,
    }),
  },
});

export function inspectTwin(
  module: ModuleDefinition,
  telemetry: Telemetry,
  scenarioRunId: string,
  tick: number,
): TwinInspectorSnapshot {
  const definition = DEFINITIONS[module.id];
  if (!definition) throw new Error(`No twin definition exists for ${module.id}`);
  const safeTick = Math.max(0, Math.floor(tick));
  return {
    label: module.label,
    model: definition.model,
    twinId: definition.twinId,
    relatedTwins: definition.relatedTwins,
    scenarioRunId,
    tick: safeTick,
    snapshotVersion: formatSnapshotVersion(scenarioRunId, safeTick),
    properties: definition.properties(telemetry),
  };
}
