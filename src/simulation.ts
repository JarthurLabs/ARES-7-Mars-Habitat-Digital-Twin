import type { MissionEvent, ScenarioPhase, ScenarioSnapshot, Telemetry } from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number, precision = 1): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

export const PHASE_WINDOWS: ReadonlyArray<{
  phase: ScenarioPhase;
  start: number;
  end: number;
}> = [
  { phase: "watch", start: 0, end: 12 },
  { phase: "storm", start: 12, end: 31 },
  { phase: "degraded", start: 31, end: 48 },
  { phase: "containment", start: 48, end: 68 },
  { phase: "recovery", start: 68, end: Number.POSITIVE_INFINITY },
];

export const nominalTelemetry = (): Telemetry => ({
  missionSecond: 0,
  phase: "nominal",
  solarOutputKw: 82.4,
  batteryPercent: 94.2,
  oxygenPercent: 20.9,
  habitatPressureKpa: 101.2,
  co2Ppm: 612,
  dustOpacityPercent: 4,
  commsLatencyMs: 182,
  externalTemperatureC: -42,
  crewLoadKw: 18.4,
  lifeSupportLoadKw: 24.7,
  nonessentialLoadKw: 13.2,
  airlockSealed: false,
  greenhouseIsolated: false,
  loadSheddingActive: false,
  emergencyBusActive: false,
});

const event = (
  id: string,
  atSecond: number,
  severity: MissionEvent["severity"],
  source: string,
  message: string,
  action?: string,
): MissionEvent => ({ id, atSecond, severity, source, message, action });

export const MISSION_EVENTS: readonly MissionEvent[] = [
  event("evt-001", 0, "warning", "MARS-WX", "Orbital forecast upgraded: dust front ETA 12 seconds."),
  event("evt-002", 12, "warning", "ARRAY-01", "Solar yield falling faster than modeled."),
  event("evt-003", 22, "warning", "POWER-BUS-A", "Battery discharge rate exceeds nominal envelope."),
  event("evt-004", 31, "critical", "LSS-01", "Life-support reserve at risk within 18 simulated minutes."),
  event(
    "evt-005",
    38,
    "info",
    "AUTONOMY",
    "Containment plan generated from twin dependencies.",
    "Isolate greenhouse, seal external airlock, shed nonessential load.",
  ),
  event("evt-006", 48, "success", "POWER-BUS-A", "Nonessential circuits shed; emergency bus energized."),
  event("evt-007", 53, "success", "GREENHOUSE-01", "Greenhouse isolated to preserve habitat pressure."),
  event("evt-008", 58, "success", "AIRLOCK-02", "External airlock sealed and verified."),
  event("evt-009", 68, "info", "MARS-WX", "Dust opacity declining; controlled recovery started."),
  event("evt-010", 82, "success", "ARES-CONTROL", "Crew systems stable. Habitat remains on emergency bus."),
];

export function phaseAt(second: number): ScenarioPhase {
  const current = PHASE_WINDOWS.find(({ start, end }) => second >= start && second < end);
  return current?.phase ?? "recovery";
}

export function telemetryAt(second: number): Telemetry {
  const t = Math.max(0, second);
  const phase = phaseAt(t);
  const noise = Math.sin(t * 0.7) * 0.25 + Math.sin(t * 0.17) * 0.18;

  if (phase === "watch") {
    const p = t / 12;
    return {
      ...nominalTelemetry(),
      missionSecond: t,
      phase,
      solarOutputKw: round(82.4 - p * 8.5 + noise),
      batteryPercent: round(94.2 - p * 0.6),
      dustOpacityPercent: round(4 + p * 13),
      commsLatencyMs: Math.round(182 + p * 28),
    };
  }

  if (phase === "storm") {
    const p = (t - 12) / 19;
    return {
      ...nominalTelemetry(),
      missionSecond: t,
      phase,
      solarOutputKw: round(73.9 - p * 48 + noise),
      batteryPercent: round(93.6 - p * 11),
      oxygenPercent: round(20.9 - p * 0.25, 2),
      habitatPressureKpa: round(101.2 - p * 0.5),
      co2Ppm: Math.round(612 + p * 210),
      dustOpacityPercent: round(17 + p * 65),
      commsLatencyMs: Math.round(210 + p * 330),
      externalTemperatureC: round(-42 - p * 9),
    };
  }

  if (phase === "degraded") {
    const p = (t - 31) / 17;
    return {
      ...nominalTelemetry(),
      missionSecond: t,
      phase,
      solarOutputKw: round(25.9 - p * 15 + noise),
      batteryPercent: round(82.6 - p * 18),
      oxygenPercent: round(20.65 - p * 0.55, 2),
      habitatPressureKpa: round(100.7 - p * 2.7),
      co2Ppm: Math.round(822 + p * 390),
      dustOpacityPercent: round(82 + p * 12),
      commsLatencyMs: Math.round(540 + p * 310),
      externalTemperatureC: round(-51 - p * 7),
      nonessentialLoadKw: round(13.2 - p * 1.6),
    };
  }

  if (phase === "containment") {
    const p = (t - 48) / 20;
    const isolate = t >= 53;
    const seal = t >= 58;
    return {
      ...nominalTelemetry(),
      missionSecond: t,
      phase,
      solarOutputKw: round(10.9 + p * 5 + noise),
      batteryPercent: round(64.6 - p * 5.2),
      oxygenPercent: round(20.1 + p * 0.12, 2),
      habitatPressureKpa: round(98 + (seal ? p * 1.2 : 0)),
      co2Ppm: Math.round(1212 - p * 220),
      dustOpacityPercent: round(94 - p * 10),
      commsLatencyMs: Math.round(850 - p * 250),
      externalTemperatureC: round(-58 + p * 4),
      nonessentialLoadKw: 0,
      greenhouseIsolated: isolate,
      airlockSealed: seal,
      loadSheddingActive: true,
      emergencyBusActive: true,
    };
  }

  const p = clamp((t - 68) / 22, 0, 1);
  return {
    ...nominalTelemetry(),
    missionSecond: t,
    phase,
    solarOutputKw: round(15.9 + p * 31 + noise),
    batteryPercent: round(59.4 + p * 4),
    oxygenPercent: round(20.22 + p * 0.38, 2),
    habitatPressureKpa: round(99.2 + p * 1.5),
    co2Ppm: Math.round(992 - p * 260),
    dustOpacityPercent: round(84 - p * 49),
    commsLatencyMs: Math.round(600 - p * 270),
    externalTemperatureC: round(-54 + p * 8),
    nonessentialLoadKw: 0,
    greenhouseIsolated: true,
    airlockSealed: true,
    loadSheddingActive: true,
    emergencyBusActive: true,
  };
}

export function snapshotAt(second: number): ScenarioSnapshot {
  return {
    telemetry: telemetryAt(second),
    events: MISSION_EVENTS.filter(({ atSecond }) => atSecond <= second),
  };
}
