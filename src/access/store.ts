import { CatalogError, ErrorCode } from "../catalog/errors.ts";
import type { GrantRecord, Identity } from "./types.ts";

export interface IdentityStore {
  list(): Promise<Identity[]>;
  get(id: string): Promise<Identity | undefined>;
  listGrants(): Promise<GrantRecord[]>;
  commitGrant(identity: Identity, grant: GrantRecord): Promise<void>;
}

function cloneIdentity(record: Identity): Identity {
  return structuredClone(record);
}

function cloneGrant(record: GrantRecord): GrantRecord {
  return structuredClone(record);
}

export class MemoryIdentityStore implements IdentityStore {
  #identities = new Map<string, Identity>();
  #grants: GrantRecord[] = [];

  list(): Promise<Identity[]> {
    return Promise.resolve([...this.#identities.values()].map(cloneIdentity));
  }

  get(id: string): Promise<Identity | undefined> {
    const record = this.#identities.get(id);
    return Promise.resolve(record ? cloneIdentity(record) : undefined);
  }

  listGrants(): Promise<GrantRecord[]> {
    return Promise.resolve(this.#grants.map(cloneGrant));
  }

  commitGrant(identity: Identity, grant: GrantRecord): Promise<void> {
    if (this.#grants.some((item) => item.id === grant.id)) {
      return Promise.reject(
        new CatalogError(ErrorCode.ALREADY_EXISTS, `grant '${grant.id}' already exists`),
      );
    }
    this.#identities.set(identity.id, cloneIdentity(identity));
    this.#grants.push(cloneGrant(grant));
    return Promise.resolve();
  }
}

interface IdentityFile {
  identities: Identity[];
  grants: GrantRecord[];
}

export class FileIdentityStore implements IdentityStore {
  constructor(private readonly path: string) {}

  async list(): Promise<Identity[]> {
    const file = await this.#load();
    return file.identities.map(cloneIdentity);
  }

  async get(id: string): Promise<Identity | undefined> {
    const file = await this.#load();
    const record = file.identities.find((item) => item.id === id);
    return record ? cloneIdentity(record) : undefined;
  }

  async listGrants(): Promise<GrantRecord[]> {
    const file = await this.#load();
    return file.grants.map(cloneGrant);
  }

  async commitGrant(identity: Identity, grant: GrantRecord): Promise<void> {
    const file = await this.#load();
    if (file.grants.some((item) => item.id === grant.id)) {
      throw new CatalogError(ErrorCode.ALREADY_EXISTS, `grant '${grant.id}' already exists`);
    }
    const index = file.identities.findIndex((item) => item.id === identity.id);
    if (index >= 0) file.identities[index] = cloneIdentity(identity);
    else file.identities.push(cloneIdentity(identity));
    file.grants.push(cloneGrant(grant));
    await this.#save(file);
  }

  async #load(): Promise<IdentityFile> {
    try {
      const text = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(text) as Partial<IdentityFile>;
      if (!parsed || !Array.isArray(parsed.identities)) {
        throw new Error(`identity file is corrupt: ${this.path}`);
      }
      const grants = Array.isArray(parsed.grants) ? parsed.grants : [];
      return {
        identities: parsed.identities.map(cloneIdentity),
        grants: grants.map(cloneGrant),
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { identities: [], grants: [] };
      }
      throw error;
    }
  }

  async #save(file: IdentityFile): Promise<void> {
    const tmp = `${this.path}.tmp`;
    const json = `${
      JSON.stringify({ identities: file.identities, grants: file.grants }, null, 2)
    }\n`;
    await Deno.writeTextFile(tmp, json);
    await Deno.rename(tmp, this.path);
  }
}
