import { serialize, writeJsonFile } from "../fs.ts";
import { cloneSeal, type SealEntry, sealRecord } from "../audit/seal.ts";
import { CatalogError, ErrorCode } from "./errors.ts";
import type { AgentSurface, ApprovalRecord, CatalogChangeRecord, TrashedSurface } from "./types.ts";

export interface CatalogStore {
  list(): Promise<AgentSurface[]>;
  get(id: string): Promise<AgentSurface | undefined>;
  put(record: AgentSurface): Promise<void>;
  listApprovals(): Promise<ApprovalRecord[]>;
  listChanges(): Promise<CatalogChangeRecord[]>;
  /** The seal chain covering `listChanges()` and `listApprovals()`. */
  listSeal(): Promise<SealEntry[]>;
  commitChange(record: AgentSurface, change: CatalogChangeRecord): Promise<void>;
  commitApproval(record: AgentSurface, approval: ApprovalRecord): Promise<void>;
  /** Drop the surface and append the change. Approvals stay; the trail is not rewritten. */
  commitRemoval(id: string, change: CatalogChangeRecord): Promise<void>;
  /** Soft-deleted surfaces, newest last. */
  listTrash(): Promise<TrashedSurface[]>;
  /** Move a live surface into the trash and append the change. */
  commitTrash(entry: TrashedSurface, change: CatalogChangeRecord): Promise<void>;
  /** Move a trashed surface back to the live catalog as `record` and append the change. */
  commitRestore(record: AgentSurface, change: CatalogChangeRecord): Promise<void>;
  /** Drop a trashed surface permanently and append the change. */
  commitPurge(id: string, change: CatalogChangeRecord): Promise<void>;
}

function cloneTrashed(entry: TrashedSurface): TrashedSurface {
  return structuredClone(entry);
}

function cloneRecord(record: AgentSurface): AgentSurface {
  return structuredClone(record);
}

function cloneApproval(record: ApprovalRecord): ApprovalRecord {
  return structuredClone(record);
}

function cloneChange(record: CatalogChangeRecord): CatalogChangeRecord {
  return structuredClone(record);
}

export class MemoryCatalogStore implements CatalogStore {
  #records = new Map<string, AgentSurface>();
  #trash = new Map<string, TrashedSurface>();
  #approvals: ApprovalRecord[] = [];
  #changes: CatalogChangeRecord[] = [];
  #seal: SealEntry[] = [];

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

  listChanges(): Promise<CatalogChangeRecord[]> {
    return Promise.resolve(this.#changes.map(cloneChange));
  }

  listSeal(): Promise<SealEntry[]> {
    return Promise.resolve(cloneSeal(this.#seal));
  }

  async commitChange(record: AgentSurface, change: CatalogChangeRecord): Promise<void> {
    if (this.#changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    this.#records.set(record.id, cloneRecord(record));
    this.#changes.push(cloneChange(change));
    this.#seal = await sealRecord(this.#seal, "catalog", "change", change.id, change);
  }

  async commitApproval(record: AgentSurface, approval: ApprovalRecord): Promise<void> {
    if (this.#approvals.some((item) => item.id === approval.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `approval '${approval.id}' already exists`,
      );
    }
    this.#records.set(record.id, cloneRecord(record));
    this.#approvals.push(cloneApproval(approval));
    this.#seal = await sealRecord(this.#seal, "catalog", "approval", approval.id, approval);
  }

  async commitRemoval(id: string, change: CatalogChangeRecord): Promise<void> {
    if (this.#changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    this.#records.delete(id);
    this.#changes.push(cloneChange(change));
    this.#seal = await sealRecord(this.#seal, "catalog", "change", change.id, change);
  }

  listTrash(): Promise<TrashedSurface[]> {
    return Promise.resolve([...this.#trash.values()].map(cloneTrashed));
  }

  async commitTrash(entry: TrashedSurface, change: CatalogChangeRecord): Promise<void> {
    if (this.#changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    this.#records.delete(entry.record.id);
    this.#trash.set(entry.record.id, cloneTrashed(entry));
    this.#changes.push(cloneChange(change));
    this.#seal = await sealRecord(this.#seal, "catalog", "change", change.id, change);
  }

  async commitRestore(record: AgentSurface, change: CatalogChangeRecord): Promise<void> {
    if (this.#changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    if (!this.#trash.has(record.id)) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `trashed surface '${record.id}' was not found`);
    }
    this.#trash.delete(record.id);
    this.#records.set(record.id, cloneRecord(record));
    this.#changes.push(cloneChange(change));
    this.#seal = await sealRecord(this.#seal, "catalog", "change", change.id, change);
  }

  async commitPurge(id: string, change: CatalogChangeRecord): Promise<void> {
    if (this.#changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    if (!this.#trash.has(id)) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `trashed surface '${id}' was not found`);
    }
    this.#trash.delete(id);
    this.#changes.push(cloneChange(change));
    this.#seal = await sealRecord(this.#seal, "catalog", "change", change.id, change);
  }
}

interface CatalogFile {
  records: AgentSurface[];
  approvals: ApprovalRecord[];
  changes: CatalogChangeRecord[];
  seal: SealEntry[];
  trashed: TrashedSurface[];
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

  put(record: AgentSurface): Promise<void> {
    return serialize(this.path, () => this.#putImpl(record));
  }

  async #putImpl(record: AgentSurface): Promise<void> {
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

  async listChanges(): Promise<CatalogChangeRecord[]> {
    const file = await this.#load();
    return file.changes.map(cloneChange);
  }

  async listSeal(): Promise<SealEntry[]> {
    const file = await this.#load();
    return cloneSeal(file.seal);
  }

  commitChange(record: AgentSurface, change: CatalogChangeRecord): Promise<void> {
    return serialize(this.path, () => this.#commitChangeImpl(record, change));
  }

  async #commitChangeImpl(record: AgentSurface, change: CatalogChangeRecord): Promise<void> {
    const file = await this.#load();
    if (file.changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    const index = file.records.findIndex((item) => item.id === record.id);
    if (index >= 0) file.records[index] = cloneRecord(record);
    else file.records.push(cloneRecord(record));
    file.changes.push(cloneChange(change));
    file.seal = await sealRecord(file.seal, "catalog", "change", change.id, change);
    await this.#save(file);
  }

  commitApproval(record: AgentSurface, approval: ApprovalRecord): Promise<void> {
    return serialize(this.path, () => this.#commitApprovalImpl(record, approval));
  }

  async #commitApprovalImpl(record: AgentSurface, approval: ApprovalRecord): Promise<void> {
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
    file.seal = await sealRecord(file.seal, "catalog", "approval", approval.id, approval);
    await this.#save(file);
  }

  commitRemoval(id: string, change: CatalogChangeRecord): Promise<void> {
    return serialize(this.path, () => this.#commitRemovalImpl(id, change));
  }

  async #commitRemovalImpl(id: string, change: CatalogChangeRecord): Promise<void> {
    const file = await this.#load();
    if (file.changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    file.records = file.records.filter((item) => item.id !== id);
    file.changes.push(cloneChange(change));
    file.seal = await sealRecord(file.seal, "catalog", "change", change.id, change);
    await this.#save(file);
  }

  async listTrash(): Promise<TrashedSurface[]> {
    const file = await this.#load();
    return file.trashed.map(cloneTrashed);
  }

  commitTrash(entry: TrashedSurface, change: CatalogChangeRecord): Promise<void> {
    return serialize(this.path, () => this.#commitTrashImpl(entry, change));
  }

  async #commitTrashImpl(entry: TrashedSurface, change: CatalogChangeRecord): Promise<void> {
    const file = await this.#load();
    if (file.changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    file.records = file.records.filter((item) => item.id !== entry.record.id);
    file.trashed = file.trashed.filter((item) => item.record.id !== entry.record.id);
    file.trashed.push(cloneTrashed(entry));
    file.changes.push(cloneChange(change));
    file.seal = await sealRecord(file.seal, "catalog", "change", change.id, change);
    await this.#save(file);
  }

  commitRestore(record: AgentSurface, change: CatalogChangeRecord): Promise<void> {
    return serialize(this.path, () => this.#commitRestoreImpl(record, change));
  }

  async #commitRestoreImpl(record: AgentSurface, change: CatalogChangeRecord): Promise<void> {
    const file = await this.#load();
    if (file.changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    const index = file.trashed.findIndex((item) => item.record.id === record.id);
    if (index < 0) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `trashed surface '${record.id}' was not found`);
    }
    file.trashed.splice(index, 1);
    const live = file.records.findIndex((item) => item.id === record.id);
    if (live >= 0) file.records[live] = cloneRecord(record);
    else file.records.push(cloneRecord(record));
    file.changes.push(cloneChange(change));
    file.seal = await sealRecord(file.seal, "catalog", "change", change.id, change);
    await this.#save(file);
  }

  commitPurge(id: string, change: CatalogChangeRecord): Promise<void> {
    return serialize(this.path, () => this.#commitPurgeImpl(id, change));
  }

  async #commitPurgeImpl(id: string, change: CatalogChangeRecord): Promise<void> {
    const file = await this.#load();
    if (file.changes.some((item) => item.id === change.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `catalog change '${change.id}' already exists`,
      );
    }
    if (!file.trashed.some((item) => item.record.id === id)) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `trashed surface '${id}' was not found`);
    }
    file.trashed = file.trashed.filter((item) => item.record.id !== id);
    file.changes.push(cloneChange(change));
    file.seal = await sealRecord(file.seal, "catalog", "change", change.id, change);
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
      const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
      const trashed = Array.isArray(parsed.trashed) ? parsed.trashed : [];
      return {
        records: parsed.records.map(cloneRecord),
        approvals: approvals.map(cloneApproval),
        changes: changes.map(cloneChange),
        seal: Array.isArray(parsed.seal) ? cloneSeal(parsed.seal) : [],
        trashed: trashed.map(cloneTrashed),
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { records: [], approvals: [], changes: [], seal: [], trashed: [] };
      }
      throw error;
    }
  }

  async #save(file: CatalogFile): Promise<void> {
    await writeJsonFile(this.path, {
      records: file.records,
      approvals: file.approvals,
      changes: file.changes,
      seal: file.seal,
      trashed: file.trashed,
    });
  }
}
