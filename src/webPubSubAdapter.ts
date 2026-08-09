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
  accessMode: "read-only-ui";
  roles: readonly [];
}

export interface ReadOnlyLiveConnection {
  close: () => void;
}

export interface ConnectionRetryOptions {
  readonly negotiateAttempts?: number;
  readonly retryDelayMs?: number;
  readonly requestTimeoutMs?: number;
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
  if (
    typeof value.expiresAt !== "string" ||
    value.accessMode !== "read-only-ui" ||
    !Array.isArray(value.roles) ||
    value.roles.length !== 0
  ) {
    throw new Error("The negotiate endpoint did not return the read-only UI contract");
  }
  return value as unknown as NegotiateResponse;
}

export async function connectReadOnlyLiveViewer(
  negotiateUrl: string,
  onSnapshot: (snapshot: LiveViewerSnapshot) => void,
  onStatus: (status: "connected" | "disconnected" | "error") => void,
  fetcher: typeof fetch = fetch,
  createSocket: (url: string) => WebSocket = (url) => new WebSocket(url, "json.webpubsub.azure.v1"),
  retryOptions: ConnectionRetryOptions = {},
): Promise<ReadOnlyLiveConnection> {
  if (!negotiateUrl.startsWith("https://")) throw new Error("Live negotiate URL must use HTTPS");
  const negotiateAttempts = retryOptions.negotiateAttempts ?? 6;
  const retryDelayMs = retryOptions.retryDelayMs ?? 1_000;
  const requestTimeoutMs = retryOptions.requestTimeoutMs ?? 15_000;
  if (!Number.isInteger(negotiateAttempts) || negotiateAttempts < 1) {
    throw new Error("Live negotiate attempts must be a positive integer");
  }

  let socket: WebSocket | undefined;
  let closedByViewer = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));

  const negotiate = async (): Promise<NegotiateResponse> => {
    let lastFailure: unknown;
    for (let attempt = 1; attempt <= negotiateAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetcher(negotiateUrl, {
          method: "GET",
          credentials: "omit",
          mode: "cors",
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (error) {
        lastFailure = error;
        if (attempt < negotiateAttempts) await delay();
        continue;
      }
      if (!response.ok) {
        lastFailure = new Error(`Live negotiation failed (${response.status})`);
        if (attempt < negotiateAttempts) await delay();
        continue;
      }
      // A successful HTTP response with a malformed or over-privileged grant is
      // a contract violation, not a transient condition. Fail it closed once.
      return parseNegotiateResponse(await response.json());
    }
    throw lastFailure instanceof Error ? lastFailure : new Error("Live negotiation failed");
  };

  const establish = async (): Promise<void> => {
    const grant = await negotiate();
    if (closedByViewer) return;
    const current = createSocket(grant.url);
    socket = current;
    current.addEventListener("message", (event) => {
      try {
        const envelope = JSON.parse(String(event.data)) as unknown;
        if (isRecord(envelope) && envelope.type === "system" && envelope.event === "connected") {
          onStatus("connected");
          return;
        }
        if (!isRecord(envelope) || envelope.type !== "message" || envelope.from !== "server") return;
        const payload = envelope.dataType === "json" ? envelope.data : JSON.parse(String(envelope.data));
        onSnapshot(parseLiveViewerSnapshot(payload));
      } catch {
        onStatus("error");
      }
    });
    current.addEventListener("error", () => {
      onStatus("error");
      try {
        current.close(1011, "viewer reconnect");
      } catch {
        // The close handler or retry timer will recover the connection.
      }
    });
    current.addEventListener("close", () => {
      if (closedByViewer || current !== socket) return;
      onStatus("disconnected");
      reconnectTimer = setTimeout(() => {
        void establish().catch(() => {
          if (!closedByViewer) onStatus("error");
        });
      }, retryDelayMs);
    });
  };

  await establish();
  return {
    close: () => {
      closedByViewer = true;
      clearTimeout(reconnectTimer);
      socket?.close(1000, "viewer closed");
    },
  };
}
