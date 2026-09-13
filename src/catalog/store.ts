import { CatalogError, ErrorCode } from "./errors.ts";
import type { AgentSurface, ApprovalRecord } from "./types.ts";

export interface CatalogStore {
  list(): Promise<AgentSurface[]>;
  get(id: string): Promise<AgentSurface | undefined>;
  put(record: AgentSurface): Promise<void>;
  listApprovals(): Promise<ApprovalRecord[]>;
  commitApproval(record: AgentSurface, approval: ApprovalRecord): Promise<void>;
}

function cloneRecord(record: AgentSurface): AgentSurface {
  return structuredClone(record);
}

function cloneApproval(record: ApprovalRecord): ApprovalRecord {
  return structuredClone(record);
}

export class MemoryCatalogStore implements CatalogStore {
  #records = new Map<string, AgentSurface>();
  #approvals: ApprovalRecord[] = [];

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

  listApprovals(): Promise<ApprovalRecord[]> {
    return Promise.resolve(this.#approvals.map(cloneApproval));
  }

  commitApproval(record: AgentSurface, approval: ApprovalRecord): Promise<void> {
    if (this.#approvals.some((item) => item.id === approval.id)) {
      return Promise.reject(
        new CatalogError(
          ErrorCode.ALREADY_EXISTS,
          `approval '${approval.id}' already exists`,
        ),
      );
    }
    this.#records.set(record.id, cloneRecord(record));
    this.#approvals.push(cloneApproval(approval));
    return Promise.resolve();
  }
}

interface CatalogFile {
  records: AgentSurface[];
  approvals: ApprovalRecord[];
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

  async listApprovals(): Promise<ApprovalRecord[]> {
    const file = await this.#load();
    return file.approvals.map(cloneApproval);
  }

  async commitApproval(record: AgentSurface, approval: ApprovalRecord): Promise<void> {
    const file = await this.#load();
    if (file.approvals.some((item) => item.id === approval.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `approval '${approval.id}' already exists`,
      );
    }
    const index = file.records.findIndex((item) => item.id === record.id);
    if (index >= 0) file.records[index] = cloneRecord(record);
    else file.records.push(cloneRecord(record));
    file.approvals.push(cloneApproval(approval));
    await this.#save(file);
  }

  async #load(): Promise<CatalogFile> {
    try {
      const text = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(text) as Partial<CatalogFile>;
      if (!parsed || !Array.isArray(parsed.records)) {
        throw new Error(`catalog file is corrupt: ${this.path}`);
      }
      const approvals = Array.isArray(parsed.approvals) ? parsed.approvals : [];
      return {
        records: parsed.records.map(cloneRecord),
        approvals: approvals.map(cloneApproval),
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { records: [], approvals: [] };
      }
      throw error;
    }
  }

  async #save(file: CatalogFile): Promise<void> {
    const tmp = `${this.path}.tmp`;
    const json = `${
      JSON.stringify(
        {
          records: file.records,
          approvals: file.approvals,
        },
        null,
        2,
      )
    }\n`;
    await Deno.writeTextFile(tmp, json);
    await Deno.rename(tmp, this.path);
  }
}
