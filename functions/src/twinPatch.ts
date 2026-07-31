export type JsonPatch = Record<string, unknown>;

export function patches(values: Record<string, unknown>): JsonPatch[] {
  return Object.entries(values).map(([name, value]) => ({
    op: "add",
    path: `/${name}`,
    value,
  }));
}
