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
