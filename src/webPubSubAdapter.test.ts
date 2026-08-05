import { describe, expect, it, vi } from "vitest";
import { connectReadOnlyLiveViewer, parseLiveViewerSnapshot } from "./webPubSubAdapter";

const telemetry = {
  missionSecond: 4,
  phase: "watch",
  solarOutputKw: 72,
  solarOutputPercent: 70,
  batteryPercent: 92,
  oxygenPercent: 20.8,
  oxygenGeneratorOutputPercent: 96,
  oxygenReservePercent: 94,
  habitatPressureKpa: 101,
  co2Ppm: 640,
  dustOpacityPercent: 22,
  commsLatencyMs: 205,
  externalTemperatureC: -44,
  crewLoadKw: 16,
  lifeSupportLoadKw: 22,
  nonessentialLoadKw: 12,
  airlockSealed: false,
  greenhouseIsolated: false,
  loadSheddingActive: false,
  emergencyBusActive: false,
};

describe("read-only Web PubSub adapter", () => {
  it("rejects incomplete or mislabeled live messages", () => {
    expect(() => parseLiveViewerSnapshot({ source: "local" })).toThrow(/unsupported source/);
    expect(() => parseLiveViewerSnapshot({ source: "azure-live", scenarioRunId: "run", tick: 0 })).toThrow();
  });

  it("accepts a complete server snapshot", () => {
    const snapshot = parseLiveViewerSnapshot({
      source: "azure-live",
      scenarioRunId: "run-1",
      tick: 4,
      snapshotVersion: "v2:run-1:tick:4",
      controllerState: "STORM_WARNING",
      telemetry,
    });
    expect(snapshot.telemetry.phase).toBe("watch");
    expect(snapshot.controllerState).toBe("STORM_WARNING");
  });

  it("negotiates without browser credentials and never exposes a send method", async () => {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    const close = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      url: "wss://example.webpubsub.azure.com/client/hubs/ares7?access_token=short-lived",
      expiresAt: "2026-08-05T03:00:00.000Z",
      permissions: "receive-only",
    }), { status: 200 }));
    const connection = await connectReadOnlyLiveViewer(
      "https://example.test/api/viewer/negotiate",
      vi.fn(),
      vi.fn(),
      fetcher as typeof fetch,
      () => ({ addEventListener: (name: string, listener: (event: MessageEvent) => void) => listeners.set(name, listener), close } as unknown as WebSocket),
    );

    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: "omit" }));
    expect(Object.keys(connection)).toEqual(["close"]);
    connection.close();
    expect(close).toHaveBeenCalled();
  });
});
