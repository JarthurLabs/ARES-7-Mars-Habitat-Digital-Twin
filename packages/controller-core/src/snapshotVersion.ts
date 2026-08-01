import { SNAPSHOT_VERSION, type SnapshotIdentity } from "./contracts.js";

const separator = ":tick:";

export function formatSnapshotVersion(scenarioRunId: string, tick: number): string {
  if (!scenarioRunId.trim()) throw new Error("scenarioRunId is required");
  if (!Number.isInteger(tick) || tick < 0) throw new RangeError("tick must be a non-negative integer");
  return `v${SNAPSHOT_VERSION}:${scenarioRunId}${separator}${tick}`;
}

export function parseSnapshotVersion(snapshotVersion: string): SnapshotIdentity {
  const prefix = `v${SNAPSHOT_VERSION}:`;
  if (!snapshotVersion.startsWith(prefix)) throw new Error("Unsupported snapshot version");

  const encoded = snapshotVersion.slice(prefix.length);
  const splitAt = encoded.lastIndexOf(separator);
  if (splitAt <= 0) throw new Error("Malformed snapshot version");

  const scenarioRunId = encoded.slice(0, splitAt);
  const tick = Number(encoded.slice(splitAt + separator.length));
  if (!Number.isInteger(tick) || tick < 0) throw new Error("Malformed snapshot tick");

  return { scenarioRunId, tick, snapshotVersion };
}

export function snapshotVersionMatches(identity: SnapshotIdentity): boolean {
  return identity.snapshotVersion === formatSnapshotVersion(identity.scenarioRunId, identity.tick);
}
