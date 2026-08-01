export type ScenarioPhase =
  | "nominal"
  | "watch"
  | "storm"
  | "degraded"
  | "containment"
  | "recovery";

export type Severity = "info" | "success" | "warning" | "critical";

export interface SensorTelemetry {
  missionSecond: number;
  phase: ScenarioPhase;
  solarOutputKw: number;
  solarOutputPercent: number;
  batteryPercent: number;
  oxygenPercent: number;
  oxygenGeneratorOutputPercent: number;
  oxygenReservePercent: number;
  habitatPressureKpa: number;
  co2Ppm: number;
  dustOpacityPercent: number;
  commsLatencyMs: number;
  externalTemperatureC: number;
  crewLoadKw: number;
  lifeSupportLoadKw: number;
  nonessentialLoadKw: number;
}

export interface Telemetry extends SensorTelemetry {
  airlockSealed: boolean;
  greenhouseIsolated: boolean;
  loadSheddingActive: boolean;
  emergencyBusActive: boolean;
}

export interface MissionEvent {
  id: string;
  atSecond: number;
  severity: Severity;
  source: string;
  message: string;
  action?: string;
}

export interface ScenarioSnapshot {
  telemetry: SensorTelemetry;
  events: MissionEvent[];
}

export interface ModuleDefinition {
  id: string;
  label: string;
  code: string;
  kind: "command" | "habitat" | "life-support" | "greenhouse" | "power" | "airlock";
  position: readonly [number, number, number];
  criticality: "mission" | "crew" | "support";
}
