import type { EventGridEvent, InvocationContext } from "@azure/functions";
import type { AggregateTelemetry } from "./contracts.js";
import { getTwinsClient } from "./clients.js";
import { patches } from "./twinPatch.js";

function decodeBody(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const body = (data as Record<string, unknown>).body ?? data;
  if (typeof body !== "string") return body;

  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(Buffer.from(body, "base64").toString("utf8"));
    } catch {
      return body;
    }
  }
}

function assertTelemetry(value: unknown): asserts value is AggregateTelemetry {
  if (!value || typeof value !== "object") throw new Error("Telemetry body must be an object.");
  const candidate = value as Partial<AggregateTelemetry>;
  if (candidate.schemaVersion !== "1.0" || candidate.messageType !== "ares7.aggregateTelemetry") {
    throw new Error("Unsupported telemetry schema or message type.");
  }
  if (!candidate.scenarioRunId || !Number.isInteger(candidate.tick)) {
    throw new Error("Telemetry requires a scenarioRunId and integer tick.");
  }
  if (!candidate.environment || !candidate.power || !candidate.lifeSupport || !candidate.sampleUtc) {
    throw new Error("Telemetry is missing a required aggregate section.");
  }
}

export async function ingestTelemetry(
  event: EventGridEvent,
  context: InvocationContext,
): Promise<void> {
  const telemetry = decodeBody(event.data);
  assertTelemetry(telemetry);
  const client = getTwinsClient();

  context.log(
    `ingest run=${telemetry.scenarioRunId} tick=${telemetry.tick} event=${event.id ?? "unknown"}`,
  );

  await Promise.all([
    client.updateDigitalTwin(
      "ares7-environment",
      patches({
        scenarioRunId: telemetry.scenarioRunId,
        tick: telemetry.tick,
        stormIntensityPct: telemetry.environment.stormIntensityPct,
        dustOpacityPct: telemetry.environment.dustOpacityPct,
        solarIrradiancePct: telemetry.environment.solarIrradiancePct,
        externalTemperatureC: telemetry.environment.externalTemperatureC,
        windSpeedMps: telemetry.environment.windSpeedMps,
      }),
    ),
    client.updateDigitalTwin(
      "ares7-solar-alpha",
      patches({
        status: telemetry.power.solarOutputPct < 15 ? "CRITICAL" : telemetry.power.solarOutputPct < 65 ? "DEGRADED" : "NOMINAL",
        outputKw: telemetry.power.solarOutputKw,
        outputPct: telemetry.power.solarOutputPct,
        dustDeratePct: telemetry.power.dustDeratePct,
      }),
    ),
    client.updateDigitalTwin(
      "ares7-battery-alpha",
      patches({
        status: telemetry.power.batteryChargePct <= 60 ? "CRITICAL" : telemetry.power.batteryChargePct < 80 ? "DEGRADED" : "NOMINAL",
        chargePct: telemetry.power.batteryChargePct,
        flowKw: telemetry.power.batteryFlowKw,
        busAvailableKw: telemetry.power.busAvailableKw,
        busDemandKw: telemetry.power.busDemandKw,
      }),
    ),
    client.updateDigitalTwin(
      "ares7-life-support",
      patches({
        status: telemetry.lifeSupport.oxygenGeneratorOutputPct <= 50 ? "AT_RISK" : telemetry.lifeSupport.oxygenGeneratorOutputPct < 85 ? "DEGRADED" : "NOMINAL",
        oxygenGeneratorOutputPct: telemetry.lifeSupport.oxygenGeneratorOutputPct,
        oxygenReservePct: telemetry.lifeSupport.oxygenReservePct,
        cabinOxygenPct: telemetry.lifeSupport.cabinOxygenPct,
        co2Ppm: telemetry.lifeSupport.co2Ppm,
        allocatedPowerKw: telemetry.lifeSupport.allocatedPowerKw,
      }),
    ),
    client.updateDigitalTwin(
      "ares7-module-command",
      patches({
        cabinOxygenPct: telemetry.lifeSupport.cabinOxygenPct,
        pressureKPa: telemetry.lifeSupport.habitatPressureKPa,
      }),
    ),
    client.updateDigitalTwin(
      "ares7-module-crew",
      patches({
        cabinOxygenPct: telemetry.lifeSupport.cabinOxygenPct,
        pressureKPa: telemetry.lifeSupport.habitatPressureKPa,
      }),
    ),
  ]);

  // Commit marker: update only after every reading for this tick has been written.
  await client.updateDigitalTwin(
    "ares7-clock",
    patches({
      scenarioRunId: telemetry.scenarioRunId,
      tick: telemetry.tick,
      simulatedMinute: telemetry.simulatedMinute,
      sampleUtc: telemetry.sampleUtc,
    }),
  );
}
