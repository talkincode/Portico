import { writeJsonFile } from "../fs.ts";
import type { GatewayAuditRecord } from "./types.ts";

export interface GatewayAuditStore {
  list(): Promise<GatewayAuditRecord[]>;
  append(record: GatewayAuditRecord): Promise<void>;
}

function cloneRecord(record: GatewayAuditRecord): GatewayAuditRecord {
  return structuredClone(record);
}

export class MemoryGatewayAuditStore implements GatewayAuditStore {
  #records: GatewayAuditRecord[] = [];

  list(): Promise<GatewayAuditRecord[]> {
    return Promise.resolve(this.#records.map(cloneRecord));
  }

  append(record: GatewayAuditRecord): Promise<void> {
    this.#records.push(cloneRecord(record));
    return Promise.resolve();
  }
}

interface AuditFile {
  records: GatewayAuditRecord[];
}

export class FileGatewayAuditStore implements GatewayAuditStore {
  constructor(private readonly path: string) {}

  async list(): Promise<GatewayAuditRecord[]> {
    const file = await this.#load();
    return file.records.map(cloneRecord);
  }

  async append(record: GatewayAuditRecord): Promise<void> {
    const file = await this.#load();
    file.records.push(cloneRecord(record));
    await this.#save(file);
  }

  async #load(): Promise<AuditFile> {
    try {
      const text = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(text) as Partial<AuditFile>;
      if (!parsed || !Array.isArray(parsed.records)) {
        throw new Error(`gateway audit file is corrupt: ${this.path}`);
      }
      return { records: parsed.records.map(cloneRecord) };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { records: [] };
      }
      throw error;
    }
  }

  async #save(file: AuditFile): Promise<void> {
    await writeJsonFile(this.path, { records: file.records });
  }
}
