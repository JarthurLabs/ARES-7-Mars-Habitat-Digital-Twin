import type { HttpRequest, InvocationContext } from "@azure/functions";
import type { WebPubSubServiceClient } from "@azure/web-pubsub";
import { describe, expect, it, vi } from "vitest";
import { createNegotiateViewer } from "../src/negotiateViewer.js";

const context = {} as InvocationContext;

function request(method = "GET", origin = "https://jarthurlabs.github.io"): HttpRequest {
  return { method, headers: new Headers(origin ? { origin } : {}) } as HttpRequest;
}

function handler(client: WebPubSubServiceClient | null = {
  getClientAccessToken: vi.fn(async () => ({ url: "wss://example.webpubsub.azure.com/client/hubs/ares7?access_token=redacted" })),
} as unknown as WebPubSubServiceClient) {
  return createNegotiateViewer({
    getClient: () => client ?? undefined,
    getAllowedOrigins: () => ["https://jarthurlabs.github.io", "http://localhost:4173"],
    createUserId: () => "test-id",
    now: () => Date.parse("2026-08-05T02:00:00.000Z"),
  });
}

describe("viewer negotiate Function", () => {
  it("rejects missing and unapproved origins before issuing a token", async () => {
    expect((await handler()(request("GET", ""), context)).status).toBe(403);
    expect((await handler()(request("GET", "https://evil.example"), context)).status).toBe(403);
  });

  it("answers a valid preflight without contacting Web PubSub", async () => {
    const getClient = vi.fn();
    const negotiate = createNegotiateViewer({
      getClient,
      getAllowedOrigins: () => ["https://jarthurlabs.github.io"],
      createUserId: () => "test-id",
      now: () => 0,
    });
    const response = await negotiate(request("OPTIONS"), context);
    expect(response.status).toBe(204);
    expect(response.headers).toMatchObject({ "access-control-allow-origin": "https://jarthurlabs.github.io" });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("rejects other methods and an unconfigured service", async () => {
    expect((await handler()(request("POST"), context)).status).toBe(405);
    expect((await handler(null)(request(), context)).status).toBe(503);
  });

  it("issues a five-minute read-only UI URL with no group roles", async () => {
    const getClientAccessToken = vi.fn(async () => ({
      url: "wss://example.webpubsub.azure.com/client/hubs/ares7?access_token=redacted",
    }));
    const response = await handler({ getClientAccessToken } as unknown as WebPubSubServiceClient)(request(), context);

    expect(response.status).toBe(200);
    expect(response.jsonBody).toEqual({
      url: expect.stringContaining("wss://"),
      expiresAt: "2026-08-05T02:05:00.000Z",
      accessMode: "read-only-ui",
      roles: [],
    });
    expect(getClientAccessToken).toHaveBeenCalledWith({
      userId: "viewer-test-id",
      roles: [],
      expirationTimeInMinutes: 5,
    });
  });
});
