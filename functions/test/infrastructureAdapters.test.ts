import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TwinConflictError, AzureDigitalTwinStore } from "../src/twinStore.js";
import { patches } from "../src/twinPatch.js";

const azure = vi.hoisted(() => ({
  eventGrid: vi.fn(),
  twinsConstructor: vi.fn(),
  pubSubConstructor: vi.fn(),
}));

vi.mock("@azure/functions", () => ({ app: { eventGrid: azure.eventGrid } }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: vi.fn() }));
vi.mock("@azure/digital-twins-core", () => ({
  DigitalTwinsClient: function DigitalTwinsClient(...args: unknown[]) {
    azure.twinsConstructor(...args);
  },
}));
vi.mock("@azure/web-pubsub", () => ({
  WebPubSubServiceClient: function WebPubSubServiceClient(...args: unknown[]) {
    azure.pubSubConstructor(...args);
  },
}));

function digitalTwinsClient(overrides: Record<string, unknown> = {}) {
  return {
    getDigitalTwin: vi.fn(),
    upsertDigitalTwin: vi.fn(),
    updateDigitalTwin: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.AZURE_DIGITAL_TWINS_ENDPOINT;
  delete process.env.AZURE_WEBPUBSUB_ENDPOINT;
  delete process.env.AZURE_WEBPUBSUB_HUB;
});

afterEach(() => {
  delete process.env.AZURE_DIGITAL_TWINS_ENDPOINT;
  delete process.env.AZURE_WEBPUBSUB_ENDPOINT;
  delete process.env.AZURE_WEBPUBSUB_HUB;
});

describe("Azure adapter wiring", () => {
  it("builds JSON patches without hiding falsey values", () => {
    expect(patches({ sealed: false, count: 0 })).toEqual([
      { op: "add", path: "/sealed", value: false },
      { op: "add", path: "/count", value: 0 },
    ]);
  });

  it("requires the Digital Twins endpoint and leaves Web PubSub optional", async () => {
    const clients = await import("../src/clients.js");
    expect(() => clients.getTwinsClient()).toThrow("AZURE_DIGITAL_TWINS_ENDPOINT is not configured");
    expect(clients.getPubSubClient()).toBeUndefined();
  });

  it("constructs and caches configured Azure clients", async () => {
    process.env.AZURE_DIGITAL_TWINS_ENDPOINT = "https://twins.example.test";
    process.env.AZURE_WEBPUBSUB_ENDPOINT = "https://pubsub.example.test";
    process.env.AZURE_WEBPUBSUB_HUB = "test-hub";
    const clients = await import("../src/clients.js");

    expect(clients.getTwinsClient()).toBe(clients.getTwinsClient());
    expect(clients.getTwinStore()).toBe(clients.getTwinStore());
    expect(clients.getPubSubClient()).toBe(clients.getPubSubClient());
    expect(azure.twinsConstructor).toHaveBeenCalledTimes(1);
    expect(azure.pubSubConstructor).toHaveBeenCalledTimes(1);
    expect(azure.pubSubConstructor).toHaveBeenCalledWith(
      "https://pubsub.example.test",
      expect.anything(),
      "test-hub",
    );
  });

  it("registers both Event Grid handlers", async () => {
    await import("../src/index.js");
    expect(azure.eventGrid).toHaveBeenCalledTimes(2);
    expect(azure.eventGrid).toHaveBeenCalledWith(
      "ingestTelemetry",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
    expect(azure.eventGrid).toHaveBeenCalledWith(
      "emergencyController",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
  });
});

describe("Azure Digital Twins store", () => {
  it("maps an SDK twin into the store contract and filters metadata", async () => {
    const client = digitalTwinsClient({
      getDigitalTwin: vi.fn().mockResolvedValue({
        body: {
          $etag: '"7"',
          $metadata: { $model: "dtmi:ares7:Habitat;1" },
          operationalState: "NOMINAL",
        },
      }),
    });
    const store = new AzureDigitalTwinStore(client as never);

    await expect(store.getTwin("ares7-habitat")).resolves.toEqual({
      id: "ares7-habitat",
      modelId: "dtmi:ares7:Habitat;1",
      properties: { operationalState: "NOMINAL" },
      etag: '"7"',
    });
  });

  it("returns undefined only for a real 404", async () => {
    const missing = new AzureDigitalTwinStore(
      digitalTwinsClient({ getDigitalTwin: vi.fn().mockRejectedValue({ statusCode: 404 }) }) as never,
    );
    const unavailable = new AzureDigitalTwinStore(
      digitalTwinsClient({ getDigitalTwin: vi.fn().mockRejectedValue({ statusCode: 503 }) }) as never,
    );

    await expect(missing.getTwin("missing")).resolves.toBeUndefined();
    await expect(unavailable.getTwin("offline")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("creates and rereads a twin while translating create conflicts", async () => {
    const getDigitalTwin = vi.fn().mockResolvedValue({
      body: { $etag: '"1"', $metadata: { $model: "dtmi:ares7:Module;1" }, isolated: false },
    });
    const upsertDigitalTwin = vi.fn().mockResolvedValue({});
    const store = new AzureDigitalTwinStore(
      digitalTwinsClient({ getDigitalTwin, upsertDigitalTwin }) as never,
    );

    await expect(store.createTwin("lab", "dtmi:ares7:Module;1", { isolated: false })).resolves.toMatchObject({
      id: "lab",
      properties: { isolated: false },
    });
    expect(upsertDigitalTwin).toHaveBeenCalledWith(
      "lab",
      JSON.stringify({ $metadata: { $model: "dtmi:ares7:Module;1" }, isolated: false }),
      { ifNoneMatch: "*" },
    );

    const conflict = new AzureDigitalTwinStore(
      digitalTwinsClient({ upsertDigitalTwin: vi.fn().mockRejectedValue({ statusCode: 409 }) }) as never,
    );
    await expect(conflict.createTwin("lab", "model", {})).rejects.toBeInstanceOf(TwinConflictError);
  });

  it("fails closed when a newly created twin cannot be reread", async () => {
    const store = new AzureDigitalTwinStore(
      digitalTwinsClient({
        upsertDigitalTwin: vi.fn().mockResolvedValue({}),
        getDigitalTwin: vi.fn().mockRejectedValue({ statusCode: 404 }),
      }) as never,
    );

    await expect(store.createTwin("lab", "model", {})).rejects.toThrow(
      "Twin lab was not readable after creation",
    );
  });

  it("updates with ETag protection and translates write conflicts", async () => {
    const updateDigitalTwin = vi.fn().mockResolvedValue({});
    const client = digitalTwinsClient({
      updateDigitalTwin,
      getDigitalTwin: vi.fn().mockResolvedValue({
        body: { $etag: '"3"', $metadata: { $model: "dtmi:ares7:Habitat;1" }, sealed: true },
      }),
    });
    const store = new AzureDigitalTwinStore(client as never);

    await expect(store.updateTwin("habitat", { sealed: true }, { ifMatch: '"2"' })).resolves.toMatchObject({
      etag: '"3"',
      properties: { sealed: true },
    });
    expect(updateDigitalTwin).toHaveBeenCalledWith(
      "habitat",
      [{ op: "add", path: "/sealed", value: true }],
      { ifMatch: '"2"' },
    );

    const conflict = new AzureDigitalTwinStore(
      digitalTwinsClient({ updateDigitalTwin: vi.fn().mockRejectedValue({ statusCode: 412 }) }) as never,
    );
    await expect(conflict.updateTwin("habitat", { sealed: true })).rejects.toBeInstanceOf(
      TwinConflictError,
    );
  });

  it("fails closed when an updated twin cannot be reread", async () => {
    const store = new AzureDigitalTwinStore(
      digitalTwinsClient({
        updateDigitalTwin: vi.fn().mockResolvedValue({}),
        getDigitalTwin: vi.fn().mockRejectedValue({ statusCode: 404 }),
      }) as never,
    );

    await expect(store.updateTwin("habitat", { sealed: true })).rejects.toThrow(
      "Twin habitat was not readable after update",
    );
  });
});
