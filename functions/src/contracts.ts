export interface AggregateTelemetry {
  schemaVersion: "1.0";
  messageType: "ares7.aggregateTelemetry";
  scenarioRunId: string;
  tick: number;
  simulatedMinute: number;
  sampleUtc: string;
  environment: {
    stormIntensityPct: number;
    dustOpacityPct: number;
    solarIrradiancePct: number;
    externalTemperatureC: number;
    windSpeedMps: number;
  };
  power: {
    solarOutputKw: number;
    solarOutputPct: number;
    dustDeratePct: number;
    batteryChargePct: number;
    batteryFlowKw: number;
    busAvailableKw: number;
    busDemandKw: number;
  };
  lifeSupport: {
    oxygenGeneratorOutputPct: number;
    oxygenReservePct: number;
    cabinOxygenPct: number;
    co2Ppm: number;
    habitatPressureKPa: number;
    allocatedPowerKw: number;
  };
}

export type ControllerState =
  | "NOMINAL"
  | "STORM_WARNING"
  | "POWER_CRITICAL"
  | "LIFE_SUPPORT_RISK"
  | "CONTAINMENT"
  | "RECOVERY"
  | "RESTORATION"
  | "RESOLVED";

export type OperatorDecision = "NONE" | "PENDING" | "APPROVED" | "HELD";

export interface ControllerSnapshot {
  scenarioRunId: string;
  tick: number;
  currentState: ControllerState;
  operatorDecision: OperatorDecision;
  recoveryStableTicks: number;
  resolvedStableTicks: number;
  dustOpacityPct: number;
  solarOutputPct: number;
  batteryChargePct: number;
  oxygenGeneratorOutputPct: number;
  oxygenReservePct: number;
}

export interface ControllerDecision {
  nextState: ControllerState;
  transitioned: boolean;
  alarmLevel: "NONE" | "WATCH" | "CRITICAL" | "RECOVERING";
  action: string;
  operatorDecision: OperatorDecision;
  recoveryStableTicks: number;
  resolvedStableTicks: number;
  isolateLab: boolean;
  isolateGreenhouse: boolean;
  sealAirlock: boolean;
  shedNonCriticalLoad: boolean;
  prioritizeLifeSupport: boolean;
}
