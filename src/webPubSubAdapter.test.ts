import { describe, expect, it, vi } from "vitest";
import { connectReadOnlyLiveViewer, parseLiveViewerSnapshot } from "./webPubSubAdapter";

type SocketListener = (event: MessageEvent | CloseEvent | Event) => void;

function fakeSocket() {
  const listeners = new Map<string, SocketListener>();
  const close = vi.fn();
  return {
    socket: {
      addEventListener: (name: string, listener: SocketListener) => listeners.set(name, listener),
      close,
    } as unknown as WebSocket,
    listeners,
    close,
  };
}

const readOnlyGrant = {
  url: "wss://example.webpubsub.azure.com/client/hubs/ares7?access_token=short-lived",
  expiresAt: "2026-08-05T03:00:00.000Z",
  accessMode: "read-only-ui",
  roles: [],
};

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
    const { socket, close } = fakeSocket();
    const fetcher = vi.fn(async () => new Response(JSON.stringify(readOnlyGrant), { status: 200 }));
    const connection = await connectReadOnlyLiveViewer(
      "https://example.test/api/viewer/negotiate",
      vi.fn(),
      vi.fn(),
      fetcher as typeof fetch,
      () => socket,
    );

    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: "omit" }));
    expect(Object.keys(connection)).toEqual(["close"]);
    connection.close();
    expect(close).toHaveBeenCalled();
  });

  it("rejects a viewer contract that claims group roles or omits the UI access mode", async () => {
    const negotiate = (body: unknown) => connectReadOnlyLiveViewer(
      "https://example.test/api/viewer/negotiate",
      vi.fn(),
      vi.fn(),
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch,
      vi.fn() as unknown as (url: string) => WebSocket,
    );
    const baseGrant = {
      url: "wss://example.webpubsub.azure.com/client/hubs/ares7?access_token=short-lived",
      expiresAt: "2026-08-05T03:00:00.000Z",
    };

    await expect(negotiate({ ...baseGrant, roles: [] })).rejects.toThrow(/read-only UI contract/);
    await expect(negotiate({ ...baseGrant, accessMode: "read-only-ui", roles: ["webpubsub.joinLeaveGroup"] }))
      .rejects.toThrow(/read-only UI contract/);
  });

  it("retries transient negotiation failures before opening a socket", async () => {
    const { socket } = fakeSocket();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("warming", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(readOnlyGrant), { status: 200 }));

    const connection = await connectReadOnlyLiveViewer(
      "https://example.test/api/viewer/negotiate",
      vi.fn(),
      vi.fn(),
      fetcher as typeof fetch,
      () => socket,
      { negotiateAttempts: 2, retryDelayMs: 0, requestTimeoutMs: 1_000 },
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    connection.close();
  });

  it("waits for the Web PubSub connected frame and reconnects with a fresh grant", async () => {
    vi.useFakeTimers();
    const sockets = [fakeSocket(), fakeSocket()];
    const statuses: string[] = [];
    const snapshots: unknown[] = [];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(readOnlyGrant), { status: 200 }));
    const createSocket = vi.fn(() => sockets[createSocket.mock.calls.length - 1].socket);

    const connection = await connectReadOnlyLiveViewer(
      "https://example.test/api/viewer/negotiate",
      (snapshot) => snapshots.push(snapshot),
      (status) => statuses.push(status),
      fetcher as typeof fetch,
      createSocket,
      { negotiateAttempts: 1, retryDelayMs: 0, requestTimeoutMs: 1_000 },
    );

    expect(statuses).toEqual([]);
    sockets[0].listeners.get("message")?.({
      data: JSON.stringify({ type: "system", event: "connected" }),
    } as MessageEvent);
    expect(statuses).toEqual(["connected"]);

    sockets[0].listeners.get("message")?.({
      data: JSON.stringify({ type: "message", from: "server", dataType: "json", data: {
        source: "azure-live",
        scenarioRunId: "run-1",
        tick: 4,
        snapshotVersion: "v2:run-1:tick:4",
        controllerState: "STORM_WARNING",
        telemetry,
      } }),
    } as MessageEvent);
    expect(snapshots).toHaveLength(1);

    sockets[0].listeners.get("close")?.({} as CloseEvent);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(createSocket).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(statuses).toContain("disconnected");

    connection.close();
    expect(sockets[1].close).toHaveBeenCalledWith(1000, "viewer closed");
    vi.useRealTimers();
  });
});
