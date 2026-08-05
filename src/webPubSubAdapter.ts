import type { ControllerState } from "@ares7/controller-core";
import type { Telemetry } from "./types";

export interface LiveViewerSnapshot {
  source: "azure-live";
  scenarioRunId: string;
  tick: number;
  snapshotVersion: string;
  controllerState: ControllerState;
  telemetry: Telemetry;
}

interface NegotiateResponse {
  url: string;
  expiresAt: string;
  permissions: "receive-only";
}

export interface ReadOnlyLiveConnection {
  close: () => void;
}

const controllerStates: readonly ControllerState[] = [
  "NOMINAL",
  "STORM_WARNING",
  "POWER_CRITICAL",
  "LIFE_SUPPORT_RISK",
  "CONTAINMENT",
  "RECOVERY",
  "RESTORATION",
  "RESOLVED",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(record: Record<string, unknown>, key: keyof Telemetry): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid live field: ${key}`);
  return value;
}

function booleanValue(record: Record<string, unknown>, key: keyof Telemetry): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`Invalid live field: ${key}`);
  return value;
}

export function parseLiveViewerSnapshot(value: unknown): LiveViewerSnapshot {
  if (!isRecord(value) || value.source !== "azure-live") throw new Error("Live message has an unsupported source");
  if (typeof value.scenarioRunId !== "string" || !value.scenarioRunId.trim()) throw new Error("Live message is missing a run ID");
  if (!Number.isInteger(value.tick) || (value.tick as number) < 0) throw new Error("Live message has an invalid tick");
  if (typeof value.snapshotVersion !== "string") throw new Error("Live message is missing a snapshot version");
  if (typeof value.controllerState !== "string" || !controllerStates.includes(value.controllerState as ControllerState)) {
    throw new Error("Live message has an invalid controller state");
  }
  if (!isRecord(value.telemetry)) throw new Error("Live message is missing telemetry");
  const telemetry = value.telemetry;
  const phase = telemetry.phase;
  if (!['nominal', 'watch', 'storm', 'degraded', 'containment', 'recovery'].includes(String(phase))) {
    throw new Error("Live message has an invalid phase");
  }
  return {
    source: "azure-live",
    scenarioRunId: value.scenarioRunId,
    tick: value.tick as number,
    snapshotVersion: value.snapshotVersion,
    controllerState: value.controllerState as ControllerState,
    telemetry: {
      missionSecond: finiteNumber(telemetry, "missionSecond"),
      phase: phase as Telemetry["phase"],
      solarOutputKw: finiteNumber(telemetry, "solarOutputKw"),
      solarOutputPercent: finiteNumber(telemetry, "solarOutputPercent"),
      batteryPercent: finiteNumber(telemetry, "batteryPercent"),
      oxygenPercent: finiteNumber(telemetry, "oxygenPercent"),
      oxygenGeneratorOutputPercent: finiteNumber(telemetry, "oxygenGeneratorOutputPercent"),
      oxygenReservePercent: finiteNumber(telemetry, "oxygenReservePercent"),
      habitatPressureKpa: finiteNumber(telemetry, "habitatPressureKpa"),
      co2Ppm: finiteNumber(telemetry, "co2Ppm"),
      dustOpacityPercent: finiteNumber(telemetry, "dustOpacityPercent"),
      commsLatencyMs: finiteNumber(telemetry, "commsLatencyMs"),
      externalTemperatureC: finiteNumber(telemetry, "externalTemperatureC"),
      crewLoadKw: finiteNumber(telemetry, "crewLoadKw"),
      lifeSupportLoadKw: finiteNumber(telemetry, "lifeSupportLoadKw"),
      nonessentialLoadKw: finiteNumber(telemetry, "nonessentialLoadKw"),
      airlockSealed: booleanValue(telemetry, "airlockSealed"),
      greenhouseIsolated: booleanValue(telemetry, "greenhouseIsolated"),
      loadSheddingActive: booleanValue(telemetry, "loadSheddingActive"),
      emergencyBusActive: booleanValue(telemetry, "emergencyBusActive"),
    },
  };
}

function parseNegotiateResponse(value: unknown): NegotiateResponse {
  if (!isRecord(value) || typeof value.url !== "string" || !value.url.startsWith("wss://")) {
    throw new Error("The negotiate endpoint returned an invalid client URL");
  }
  if (typeof value.expiresAt !== "string" || value.permissions !== "receive-only") {
    throw new Error("The negotiate endpoint did not return a receive-only grant");
  }
  return value as unknown as NegotiateResponse;
}

export async function connectReadOnlyLiveViewer(
  negotiateUrl: string,
  onSnapshot: (snapshot: LiveViewerSnapshot) => void,
  onStatus: (status: "connected" | "disconnected" | "error") => void,
  fetcher: typeof fetch = fetch,
  createSocket: (url: string) => WebSocket = (url) => new WebSocket(url, "json.webpubsub.azure.v1"),
): Promise<ReadOnlyLiveConnection> {
  if (!negotiateUrl.startsWith("https://")) throw new Error("Live negotiate URL must use HTTPS");
  const response = await fetcher(negotiateUrl, { method: "GET", credentials: "omit", mode: "cors" });
  if (!response.ok) throw new Error(`Live negotiation failed (${response.status})`);
  const grant = parseNegotiateResponse(await response.json());
  const socket = createSocket(grant.url);
  socket.addEventListener("open", () => onStatus("connected"));
  socket.addEventListener("close", () => onStatus("disconnected"));
  socket.addEventListener("error", () => onStatus("error"));
  socket.addEventListener("message", (event) => {
    try {
      const envelope = JSON.parse(String(event.data)) as unknown;
      if (!isRecord(envelope) || envelope.type !== "message" || envelope.from !== "server") return;
      const payload = envelope.dataType === "json" ? envelope.data : JSON.parse(String(envelope.data));
      onSnapshot(parseLiveViewerSnapshot(payload));
    } catch {
      onStatus("error");
    }
  });
  return { close: () => socket.close(1000, "viewer closed") };
}
