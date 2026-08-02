import type { DigitalTwinsClient } from "@azure/digital-twins-core";
import { patches } from "./twinPatch.js";

export interface TwinRecord {
  readonly id: string;
  readonly modelId?: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly etag: string;
}

export interface TwinStore {
  getTwin(id: string): Promise<TwinRecord | undefined>;
  createTwin(id: string, modelId: string, properties: Readonly<Record<string, unknown>>): Promise<TwinRecord>;
  updateTwin(
    id: string,
    properties: Readonly<Record<string, unknown>>,
    options?: { readonly ifMatch?: string },
  ): Promise<TwinRecord>;
}

export class TwinConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwinConflictError";
  }
}

export class InjectedStoreFailure extends Error {
  constructor(operation: string, twinId: string) {
    super(`Injected failure during ${operation} for ${twinId}`);
    this.name = "InjectedStoreFailure";
  }
}

export interface FailureRule {
  readonly operation: "get" | "create" | "update";
  readonly twinId?: string;
  readonly occurrence?: number;
}

interface MutableTwin {
  id: string;
  modelId?: string;
  properties: Record<string, unknown>;
  version: number;
}

function copy(record: MutableTwin): TwinRecord {
  return {
    id: record.id,
    modelId: record.modelId,
    properties: structuredClone(record.properties),
    etag: `"${record.version}"`,
  };
}

export class InMemoryTwinStore implements TwinStore {
  readonly #twins = new Map<string, MutableTwin>();
  readonly #rules: Array<FailureRule & { seen: number }>;

  constructor(seed: readonly TwinRecord[] = [], failureRules: readonly FailureRule[] = []) {
    for (const twin of seed) {
      const version = Number(twin.etag.replaceAll('"', ""));
      this.#twins.set(twin.id, {
        id: twin.id,
        modelId: twin.modelId,
        properties: structuredClone(twin.properties),
        version: Number.isInteger(version) ? version : 1,
      });
    }
    this.#rules = failureRules.map((rule) => ({ ...rule, seen: 0 }));
  }

  async getTwin(id: string): Promise<TwinRecord | undefined> {
    this.#maybeFail("get", id);
    const twin = this.#twins.get(id);
    return twin ? copy(twin) : undefined;
  }

  async createTwin(
    id: string,
    modelId: string,
    properties: Readonly<Record<string, unknown>>,
  ): Promise<TwinRecord> {
    this.#maybeFail("create", id);
    if (this.#twins.has(id)) throw new TwinConflictError(`Twin ${id} already exists`);
    const twin = { id, modelId, properties: structuredClone(properties), version: 1 };
    this.#twins.set(id, twin);
    return copy(twin);
  }

  async updateTwin(
    id: string,
    properties: Readonly<Record<string, unknown>>,
    options: { readonly ifMatch?: string } = {},
  ): Promise<TwinRecord> {
    this.#maybeFail("update", id);
    const twin = this.#twins.get(id);
    if (!twin) throw new Error(`Twin ${id} does not exist`);
    if (options.ifMatch !== undefined && options.ifMatch !== `"${twin.version}"`) {
      throw new TwinConflictError(`ETag mismatch for ${id}`);
    }
    twin.properties = { ...twin.properties, ...structuredClone(properties) };
    twin.version += 1;
    return copy(twin);
  }

  #maybeFail(operation: FailureRule["operation"], twinId: string): void {
    for (const rule of this.#rules) {
      if (rule.operation !== operation || (rule.twinId && rule.twinId !== twinId)) continue;
      rule.seen += 1;
      if (rule.seen === (rule.occurrence ?? 1)) throw new InjectedStoreFailure(operation, twinId);
    }
  }
}

export class AzureDigitalTwinStore implements TwinStore {
  constructor(private readonly client: DigitalTwinsClient) {}

  async getTwin(id: string): Promise<TwinRecord | undefined> {
    try {
      const response = await this.client.getDigitalTwin(id);
      const body = response.body as Record<string, unknown>;
      const metadata = body.$metadata as Record<string, unknown> | undefined;
      const properties = Object.fromEntries(Object.entries(body).filter(([key]) => !key.startsWith("$")));
      return {
        id,
        modelId: typeof metadata?.$model === "string" ? metadata.$model : undefined,
        properties,
        etag: String(body.$etag ?? response.etag ?? ""),
      };
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return undefined;
      throw error;
    }
  }

  async createTwin(
    id: string,
    modelId: string,
    properties: Readonly<Record<string, unknown>>,
  ): Promise<TwinRecord> {
    try {
      await this.client.upsertDigitalTwin(
        id,
        JSON.stringify({ $metadata: { $model: modelId }, ...properties }),
        { ifNoneMatch: "*" },
      );
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 409) {
        throw new TwinConflictError(`Twin ${id} already exists`);
      }
      throw error;
    }
    const created = await this.getTwin(id);
    if (!created) throw new Error(`Twin ${id} was not readable after creation`);
    return created;
  }

  async updateTwin(
    id: string,
    properties: Readonly<Record<string, unknown>>,
    options: { readonly ifMatch?: string } = {},
  ): Promise<TwinRecord> {
    try {
      await this.client.updateDigitalTwin(id, patches({ ...properties }), options);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 412) {
        throw new TwinConflictError(`ETag mismatch for ${id}`);
      }
      throw error;
    }
    const updated = await this.getTwin(id);
    if (!updated) throw new Error(`Twin ${id} was not readable after update`);
    return updated;
  }
}
