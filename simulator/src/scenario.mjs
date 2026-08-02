import { createHash } from "node:crypto";

const FRAMES = [
  { dust: 5, storm: 4, solar: 86, solarKw: 82.4, battery: 92, flowKw: 18, oxygenOutput: 100, oxygenReserve: 96, cabinOxygen: 20.9, co2: 612, pressure: 101.2, wind: 8, temperature: -42 },
  { dust: 35, storm: 32, solar: 64, solarKw: 61.3, battery: 89, flowKw: -7, oxygenOutput: 96, oxygenReserve: 95, cabinOxygen: 20.88, co2: 650, pressure: 101.1, wind: 18, temperature: -45 },
  { dust: 70, storm: 71, solar: 30, solarKw: 28.7, battery: 78, flowKw: -26, oxygenOutput: 82, oxygenReserve: 92, cabinOxygen: 20.72, co2: 778, pressure: 100.8, wind: 29, temperature: -51 },
  { dust: 90, storm: 92, solar: 14, solarKw: 13.4, battery: 59, flowKw: -39, oxygenOutput: 61, oxygenReserve: 88, cabinOxygen: 20.51, co2: 916, pressure: 100.3, wind: 38, temperature: -57 },
  { dust: 94, storm: 96, solar: 10, solarKw: 9.6, battery: 54, flowKw: -42, oxygenOutput: 48, oxygenReserve: 85, cabinOxygen: 20.2, co2: 1180, pressure: 98.4, wind: 42, temperature: -59 },
  { dust: 92, storm: 93, solar: 11, solarKw: 10.5, battery: 53, flowKw: -17, oxygenOutput: 72, oxygenReserve: 86, cabinOxygen: 20.22, co2: 1090, pressure: 98.9, wind: 39, temperature: -58 },
  { dust: 80, storm: 78, solar: 22, solarKw: 21.1, battery: 55, flowKw: -2, oxygenOutput: 86, oxygenReserve: 88, cabinOxygen: 20.3, co2: 940, pressure: 99.4, wind: 31, temperature: -55 },
  { dust: 60, storm: 58, solar: 38, solarKw: 36.4, battery: 58, flowKw: 7, oxygenOutput: 88, oxygenReserve: 89, cabinOxygen: 20.39, co2: 860, pressure: 99.8, wind: 24, temperature: -52 },
  { dust: 50, storm: 45, solar: 42, solarKw: 40.2, battery: 60, flowKw: 11, oxygenOutput: 91, oxygenReserve: 90, cabinOxygen: 20.48, co2: 790, pressure: 100.1, wind: 20, temperature: -49 },
  { dust: 35, storm: 30, solar: 55, solarKw: 52.7, battery: 63, flowKw: 19, oxygenOutput: 94, oxygenReserve: 92, cabinOxygen: 20.6, co2: 710, pressure: 100.5, wind: 16, temperature: -47 },
  { dust: 20, storm: 17, solar: 78, solarKw: 74.7, battery: 71, flowKw: 31, oxygenOutput: 98, oxygenReserve: 95, cabinOxygen: 20.76, co2: 655, pressure: 100.9, wind: 12, temperature: -44 },
  { dust: 8, storm: 6, solar: 86, solarKw: 82.4, battery: 76, flowKw: 34, oxygenOutput: 100, oxygenReserve: 97, cabinOxygen: 20.9, co2: 620, pressure: 101.2, wind: 8, temperature: -42 }
];

export const SCENARIO_TICKS = FRAMES.length;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function payloadHashFor(frame) {
  const { payloadHash: _payloadHash, ...payload } = frame;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function buildFrame(tick, scenarioRunId, sampleUtc) {
  if (!Number.isInteger(tick) || tick < 0 || tick >= FRAMES.length) {
    throw new RangeError(`tick must be an integer from 0 to ${FRAMES.length - 1}`);
  }
  if (!scenarioRunId) throw new Error("scenarioRunId is required");
  const frame = FRAMES[tick];
  const payload = {
    schemaVersion: "2.0",
    messageType: "ares7.aggregateTelemetry",
    scenarioRunId,
    tick,
    snapshotVersion: `v2:${scenarioRunId}:tick:${tick}`,
    simulatedMinute: tick * 30,
    sampleUtc,
    environment: {
      stormIntensityPct: frame.storm,
      dustOpacityPct: frame.dust,
      solarIrradiancePct: frame.solar,
      externalTemperatureC: frame.temperature,
      windSpeedMps: frame.wind
    },
    power: {
      solarOutputKw: frame.solarKw,
      solarOutputPct: frame.solar,
      dustDeratePct: 100 - frame.solar,
      batteryChargePct: frame.battery,
      batteryFlowKw: frame.flowKw,
      busAvailableKw: Math.max(18, frame.solarKw + Math.max(0, -frame.flowKw)),
      busDemandKw: 34
    },
    lifeSupport: {
      oxygenGeneratorOutputPct: frame.oxygenOutput,
      oxygenReservePct: frame.oxygenReserve,
      cabinOxygenPct: frame.cabinOxygen,
      co2Ppm: frame.co2,
      habitatPressureKPa: frame.pressure,
      allocatedPowerKw: 14
    }
  };
  return { ...payload, payloadHash: payloadHashFor(payload) };
}
