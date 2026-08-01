import type { MissionEvent, ScenarioPhase, ScenarioSnapshot, SensorTelemetry } from "./types";

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

export const nominalTelemetry = (): SensorTelemetry => ({
  missionSecond: 0,
  phase: "nominal",
  solarOutputKw: 82.4,
  solarOutputPercent: 86,
  batteryPercent: 94.2,
  oxygenPercent: 20.9,
  oxygenGeneratorOutputPercent: 100,
  oxygenReservePercent: 96,
  habitatPressureKpa: 101.2,
  co2Ppm: 612,
  dustOpacityPercent: 4,
  commsLatencyMs: 182,
  externalTemperatureC: -42,
  crewLoadKw: 18.4,
  lifeSupportLoadKw: 24.7,
  nonessentialLoadKw: 13.2,
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
  event("evt-005", 48, "critical", "POWER-BUS-A", "Battery reserve reached the modeled low point."),
  event("evt-006", 58, "warning", "MARS-WX", "Dust opacity stopped climbing."),
  event("evt-007", 68, "info", "MARS-WX", "Dust opacity declining; recovery readings started."),
  event("evt-008", 82, "success", "LSS-01", "Oxygen production and reserve returned to a stable range."),
];

export function phaseAt(second: number): ScenarioPhase {
  const current = PHASE_WINDOWS.find(({ start, end }) => second >= start && second < end);
  return current?.phase ?? "recovery";
}

export function telemetryAt(second: number): SensorTelemetry {
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
      solarOutputPercent: round(86 - p * 16),
      batteryPercent: round(94.2 - p * 0.6),
      oxygenGeneratorOutputPercent: round(100 - p * 3),
      oxygenReservePercent: round(96 - p),
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
      solarOutputPercent: round(70 - p * 40),
      batteryPercent: round(93.6 - p * 11),
      oxygenPercent: round(20.9 - p * 0.25, 2),
      oxygenGeneratorOutputPercent: round(97 - p * 15),
      oxygenReservePercent: round(95 - p * 3),
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
      solarOutputPercent: round(Math.max(10, 30 - p * 48)),
      batteryPercent: round(Math.max(54, 82.6 - p * 55)),
      oxygenPercent: round(20.65 - p * 0.55, 2),
      oxygenGeneratorOutputPercent: round(Math.max(48, 82 - p * 83)),
      oxygenReservePercent: round(Math.max(85, 92 - p * 17)),
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
    return {
      ...nominalTelemetry(),
      missionSecond: t,
      phase,
      solarOutputKw: round(10.9 + p * 5 + noise),
      solarOutputPercent: round(10 + p * 20),
      batteryPercent: round(64.6 - p * 5.2),
      oxygenPercent: round(20.1 + p * 0.12, 2),
      oxygenGeneratorOutputPercent: round(72 + p * 13),
      oxygenReservePercent: round(85 + p * 3),
      habitatPressureKpa: round(98 + p * 1.2),
      co2Ppm: Math.round(1212 - p * 220),
      dustOpacityPercent: round(94 - p * 10),
      commsLatencyMs: Math.round(850 - p * 250),
      externalTemperatureC: round(-58 + p * 4),
      nonessentialLoadKw: 13.2,
    };
  }

  const p = clamp((t - 68) / 22, 0, 1);
  return {
    ...nominalTelemetry(),
    missionSecond: t,
    phase,
    solarOutputKw: round(15.9 + p * 31 + noise),
    solarOutputPercent: round(30 + p * 56),
    batteryPercent: round(59.4 + p * 17),
    oxygenPercent: round(20.22 + p * 0.38, 2),
    oxygenGeneratorOutputPercent: round(85 + p * 15),
    oxygenReservePercent: round(88 + p * 9),
    habitatPressureKpa: round(99.2 + p * 1.5),
    co2Ppm: Math.round(992 - p * 260),
    dustOpacityPercent: round(84 - p * 49),
    commsLatencyMs: Math.round(600 - p * 270),
    externalTemperatureC: round(-54 + p * 8),
    nonessentialLoadKw: 13.2,
  };
}

export function snapshotAt(second: number): ScenarioSnapshot {
  return {
    telemetry: telemetryAt(second),
    events: MISSION_EVENTS.filter(({ atSecond }) => atSecond <= second),
  };
}
