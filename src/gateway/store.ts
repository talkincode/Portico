import { serialize, writeJsonFile } from "../fs.ts";
import { cloneSeal, type SealEntry, sealRecord } from "../audit/seal.ts";
import type { GatewayAuditRecord } from "./types.ts";

export interface GatewayAuditStore {
  list(): Promise<GatewayAuditRecord[]>;
  /** The seal chain covering every appended record. */
  listSeal(): Promise<SealEntry[]>;
  append(record: GatewayAuditRecord): Promise<void>;
}

function cloneRecord(record: GatewayAuditRecord): GatewayAuditRecord {
  return structuredClone(record);
}

export class MemoryGatewayAuditStore implements GatewayAuditStore {
  #records: GatewayAuditRecord[] = [];
  #seal: SealEntry[] = [];

  list(): Promise<GatewayAuditRecord[]> {
    return Promise.resolve(this.#records.map(cloneRecord));
  }

  listSeal(): Promise<SealEntry[]> {
    return Promise.resolve(cloneSeal(this.#seal));
  }

  async append(record: GatewayAuditRecord): Promise<void> {
    this.#records.push(cloneRecord(record));
    this.#seal = await sealRecord(this.#seal, "gateway", "record", record.id, record);
  }
}

interface AuditFile {
  records: GatewayAuditRecord[];
  seal: SealEntry[];
}

export class FileGatewayAuditStore implements GatewayAuditStore {
  constructor(private readonly path: string) {}

  async list(): Promise<GatewayAuditRecord[]> {
    const file = await this.#load();
    return file.records.map(cloneRecord);
  }

  async listSeal(): Promise<SealEntry[]> {
    const file = await this.#load();
    return cloneSeal(file.seal);
  }

  append(record: GatewayAuditRecord): Promise<void> {
    return serialize(this.path, () => this.#appendImpl(record));
  }

  async #appendImpl(record: GatewayAuditRecord): Promise<void> {
    const file = await this.#load();
    file.records.push(cloneRecord(record));
    file.seal = await sealRecord(file.seal, "gateway", "record", record.id, record);
    await this.#save(file);
  }

  async #load(): Promise<AuditFile> {
    try {
      const text = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(text) as Partial<AuditFile>;
      if (!parsed || !Array.isArray(parsed.records)) {
        throw new Error(`gateway audit file is corrupt: ${this.path}`);
      }
      return {
        records: parsed.records.map(cloneRecord),
        seal: Array.isArray(parsed.seal) ? cloneSeal(parsed.seal) : [],
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { records: [], seal: [] };
      }
      throw error;
    }
  }

  async #save(file: AuditFile): Promise<void> {
    await writeJsonFile(this.path, { records: file.records, seal: file.seal });
  }
}
