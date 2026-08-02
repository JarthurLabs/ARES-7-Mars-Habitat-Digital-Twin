export interface AggregateTelemetry {
  schemaVersion: "2.0";
  messageType: "ares7.aggregateTelemetry";
  scenarioRunId: string;
  tick: number;
  snapshotVersion: string;
  payloadHash: string;
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

export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export interface TelemetrySnapshot {
  readonly scenarioRunId: string;
  readonly tick: number;
  readonly snapshotVersion: string;
  readonly payloadHash: string;
  readonly simulatedMinute: number;
  readonly sampleUtc: string;
  readonly telemetry: DeepReadonly<AggregateTelemetry>;
}
