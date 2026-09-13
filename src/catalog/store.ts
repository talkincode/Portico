import type { AgentSurface } from "./types.ts";

export interface CatalogStore {
  list(): Promise<AgentSurface[]>;
  get(id: string): Promise<AgentSurface | undefined>;
  put(record: AgentSurface): Promise<void>;
}

function cloneRecord(record: AgentSurface): AgentSurface {
  return structuredClone(record);
}

export class MemoryCatalogStore implements CatalogStore {
  #records = new Map<string, AgentSurface>();

  list(): Promise<AgentSurface[]> {
    return Promise.resolve([...this.#records.values()].map(cloneRecord));
  }

  get(id: string): Promise<AgentSurface | undefined> {
    const record = this.#records.get(id);
    return Promise.resolve(record ? cloneRecord(record) : undefined);
  }

  put(record: AgentSurface): Promise<void> {
    this.#records.set(record.id, cloneRecord(record));
    return Promise.resolve();
  }
}

interface CatalogFile {
  records: AgentSurface[];
}

export class FileCatalogStore implements CatalogStore {
  constructor(private readonly path: string) {}

  async list(): Promise<AgentSurface[]> {
    const file = await this.#load();
    return file.records.map(cloneRecord);
  }

  async get(id: string): Promise<AgentSurface | undefined> {
    const file = await this.#load();
    const record = file.records.find((item) => item.id === id);
    return record ? cloneRecord(record) : undefined;
  }

  async put(record: AgentSurface): Promise<void> {
    const file = await this.#load();
    const index = file.records.findIndex((item) => item.id === record.id);
    if (index >= 0) file.records[index] = cloneRecord(record);
    else file.records.push(cloneRecord(record));
    await this.#save(file);
  }

  async #load(): Promise<CatalogFile> {
    try {
      const text = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(text) as CatalogFile;
      if (!parsed || !Array.isArray(parsed.records)) {
        throw new Error(`catalog file is corrupt: ${this.path}`);
      }
      return { records: parsed.records.map(cloneRecord) };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return { records: [] };
      throw error;
    }
  }

  async #save(file: CatalogFile): Promise<void> {
    const tmp = `${this.path}.tmp`;
    const json = `${JSON.stringify({ records: file.records }, null, 2)}\n`;
    await Deno.writeTextFile(tmp, json);
    await Deno.rename(tmp, this.path);
  }
}
