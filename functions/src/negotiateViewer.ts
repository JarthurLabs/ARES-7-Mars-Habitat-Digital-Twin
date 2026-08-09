import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import type { WebPubSubServiceClient } from "@azure/web-pubsub";
import { randomUUID } from "node:crypto";
import { getPubSubClient } from "./clients.js";

const TOKEN_LIFETIME_MINUTES = 5;

interface Dependencies {
  getClient: () => WebPubSubServiceClient | undefined;
  getAllowedOrigins: () => readonly string[];
  createUserId: () => string;
  now: () => number;
}

function configuredOrigins(): readonly string[] {
  return (process.env.VIEWER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

export function createNegotiateViewer(dependencies: Dependencies) {
  return async function negotiateViewer(
    request: HttpRequest,
    _context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const origin = request.headers.get("origin") ?? "";
    const allowedOrigins = dependencies.getAllowedOrigins();
    if (!origin || !allowedOrigins.includes(origin)) {
      return { status: 403, jsonBody: { error: "Origin is not allowed." }, headers: { "cache-control": "no-store" } };
    }
    const headers = corsHeaders(origin);
    if (request.method === "OPTIONS") return { status: 204, headers };
    if (request.method !== "GET") return { status: 405, jsonBody: { error: "Method not allowed." }, headers };

    const client = dependencies.getClient();
    if (!client) {
      return { status: 503, jsonBody: { error: "Live replay is not configured." }, headers };
    }

    const grant = await client.getClientAccessToken({
      userId: `viewer-${dependencies.createUserId()}`,
      roles: [],
      expirationTimeInMinutes: TOKEN_LIFETIME_MINUTES,
    });
    return {
      status: 200,
      headers,
      jsonBody: {
        url: grant.url,
        expiresAt: new Date(dependencies.now() + TOKEN_LIFETIME_MINUTES * 60_000).toISOString(),
        accessMode: "read-only-ui",
        roles: [],
      },
    };
  };
}

export const negotiateViewer = createNegotiateViewer({
  getClient: getPubSubClient,
  getAllowedOrigins: configuredOrigins,
  createUserId: randomUUID,
  now: Date.now,
});
