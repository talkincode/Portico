import { serialize, writeJsonFile } from "../fs.ts";
import { CatalogError, ErrorCode } from "../catalog/errors.ts";
import type {
  CredentialRecord,
  CredentialRevokeRecord,
  GrantRecord,
  Identity,
  RevokeRecord,
  SessionRecord,
} from "./types.ts";

export interface IdentityStore {
  list(): Promise<Identity[]>;
  get(id: string): Promise<Identity | undefined>;
  listGrants(): Promise<GrantRecord[]>;
  listRevokes(): Promise<RevokeRecord[]>;
  listCredentialRevokes(): Promise<CredentialRevokeRecord[]>;
  commitGrant(identity: Identity, grant: GrantRecord): Promise<void>;
  commitRevoke(revoke: RevokeRecord): Promise<void>;
  commitCredentialRevoke(record: CredentialRevokeRecord): Promise<void>;
}

function cloneIdentity(record: Identity): Identity {
  return structuredClone(record);
}

function cloneGrant(record: GrantRecord): GrantRecord {
  return structuredClone(record);
}

function cloneRevoke(record: RevokeRecord): RevokeRecord {
  return structuredClone(record);
}

function cloneCredentialRevoke(record: CredentialRevokeRecord): CredentialRevokeRecord {
  return structuredClone(record);
}

export class MemoryIdentityStore implements IdentityStore {
  #identities = new Map<string, Identity>();
  #grants: GrantRecord[] = [];
  #revokes: RevokeRecord[] = [];
  #credentialRevokes: CredentialRevokeRecord[] = [];

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

  listRevokes(): Promise<RevokeRecord[]> {
    return Promise.resolve(this.#revokes.map(cloneRevoke));
  }

  listCredentialRevokes(): Promise<CredentialRevokeRecord[]> {
    return Promise.resolve(this.#credentialRevokes.map(cloneCredentialRevoke));
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

  commitRevoke(revoke: RevokeRecord): Promise<void> {
    if (this.#revokes.some((item) => item.id === revoke.id)) {
      return Promise.reject(
        new CatalogError(ErrorCode.ALREADY_EXISTS, `revoke '${revoke.id}' already exists`),
      );
    }
    if (!this.#identities.has(revoke.subjectId)) {
      return Promise.reject(
        new CatalogError(
          ErrorCode.NOT_FOUND,
          `identity '${revoke.subjectId}' is not in the roster`,
        ),
      );
    }
    this.#identities.delete(revoke.subjectId);
    this.#revokes.push(cloneRevoke(revoke));
    return Promise.resolve();
  }

  commitCredentialRevoke(record: CredentialRevokeRecord): Promise<void> {
    if (this.#credentialRevokes.some((item) => item.id === record.id)) {
      return Promise.reject(
        new CatalogError(
          ErrorCode.ALREADY_EXISTS,
          `credential revoke '${record.id}' already exists`,
        ),
      );
    }
    if (!this.#identities.has(record.subjectId)) {
      return Promise.reject(
        new CatalogError(
          ErrorCode.NOT_FOUND,
          `identity '${record.subjectId}' is not in the roster`,
        ),
      );
    }
    this.#credentialRevokes.push(cloneCredentialRevoke(record));
    return Promise.resolve();
  }
}

interface IdentityFile {
  identities: Identity[];
  grants: GrantRecord[];
  revokes: RevokeRecord[];
  credentialRevokes: CredentialRevokeRecord[];
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

  async listRevokes(): Promise<RevokeRecord[]> {
    const file = await this.#load();
    return file.revokes.map(cloneRevoke);
  }

  async listCredentialRevokes(): Promise<CredentialRevokeRecord[]> {
    const file = await this.#load();
    return file.credentialRevokes.map(cloneCredentialRevoke);
  }

  commitGrant(identity: Identity, grant: GrantRecord): Promise<void> {
    return serialize(this.path, () => this.#commitGrantImpl(identity, grant));
  }

  async #commitGrantImpl(identity: Identity, grant: GrantRecord): Promise<void> {
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

  commitRevoke(revoke: RevokeRecord): Promise<void> {
    return serialize(this.path, () => this.#commitRevokeImpl(revoke));
  }

  async #commitRevokeImpl(revoke: RevokeRecord): Promise<void> {
    const file = await this.#load();
    if (file.revokes.some((item) => item.id === revoke.id)) {
      throw new CatalogError(ErrorCode.ALREADY_EXISTS, `revoke '${revoke.id}' already exists`);
    }
    const index = file.identities.findIndex((item) => item.id === revoke.subjectId);
    if (index < 0) {
      throw new CatalogError(
        ErrorCode.NOT_FOUND,
        `identity '${revoke.subjectId}' is not in the roster`,
      );
    }
    file.identities.splice(index, 1);
    file.revokes.push(cloneRevoke(revoke));
    await this.#save(file);
  }

  commitCredentialRevoke(record: CredentialRevokeRecord): Promise<void> {
    return serialize(this.path, () => this.#commitCredentialRevokeImpl(record));
  }

  async #commitCredentialRevokeImpl(record: CredentialRevokeRecord): Promise<void> {
    const file = await this.#load();
    if (file.credentialRevokes.some((item) => item.id === record.id)) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `credential revoke '${record.id}' already exists`,
      );
    }
    if (!file.identities.some((item) => item.id === record.subjectId)) {
      throw new CatalogError(
        ErrorCode.NOT_FOUND,
        `identity '${record.subjectId}' is not in the roster`,
      );
    }
    file.credentialRevokes.push(cloneCredentialRevoke(record));
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
      const revokes = Array.isArray(parsed.revokes) ? parsed.revokes : [];
      const credentialRevokes = Array.isArray(parsed.credentialRevokes)
        ? parsed.credentialRevokes
        : [];
      return {
        identities: parsed.identities.map(cloneIdentity),
        grants: grants.map(cloneGrant),
        revokes: revokes.map(cloneRevoke),
        credentialRevokes: credentialRevokes.map(cloneCredentialRevoke),
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { identities: [], grants: [], revokes: [], credentialRevokes: [] };
      }
      throw error;
    }
  }

  async #save(file: IdentityFile): Promise<void> {
    await writeJsonFile(this.path, {
      identities: file.identities,
      grants: file.grants,
      revokes: file.revokes,
      credentialRevokes: file.credentialRevokes,
    });
  }
}

export interface SessionStore {
  listCredentials(): Promise<CredentialRecord[]>;
  commitCredential(record: CredentialRecord): Promise<void>;
  revokeCredential(id: string, revokedAt: string): Promise<void>;
  listSessions(): Promise<SessionRecord[]>;
  commitSession(record: SessionRecord): Promise<void>;
  revokeSession(id: string, revokedAt: string): Promise<void>;
}

function cloneCredential(record: CredentialRecord): CredentialRecord {
  return structuredClone(record);
}

function cloneSession(record: SessionRecord): SessionRecord {
  return structuredClone(record);
}

export class MemorySessionStore implements SessionStore {
  #credentials: CredentialRecord[] = [];
  #sessions: SessionRecord[] = [];

  listCredentials(): Promise<CredentialRecord[]> {
    return Promise.resolve(this.#credentials.map(cloneCredential));
  }

  commitCredential(record: CredentialRecord): Promise<void> {
    if (this.#credentials.some((item) => item.id === record.id)) {
      return Promise.reject(
        new CatalogError(ErrorCode.ALREADY_EXISTS, `credential '${record.id}' already exists`),
      );
    }
    this.#credentials.push(cloneCredential(record));
    return Promise.resolve();
  }

  revokeCredential(id: string, revokedAt: string): Promise<void> {
    const record = this.#credentials.find((item) => item.id === id);
    if (!record) {
      return Promise.reject(new CatalogError(ErrorCode.NOT_FOUND, `credential '${id}' not found`));
    }
    record.revokedAt = revokedAt;
    return Promise.resolve();
  }

  listSessions(): Promise<SessionRecord[]> {
    return Promise.resolve(this.#sessions.map(cloneSession));
  }

  commitSession(record: SessionRecord): Promise<void> {
    if (this.#sessions.some((item) => item.id === record.id)) {
      return Promise.reject(
        new CatalogError(ErrorCode.ALREADY_EXISTS, `session '${record.id}' already exists`),
      );
    }
    this.#sessions.push(cloneSession(record));
    return Promise.resolve();
  }

  revokeSession(id: string, revokedAt: string): Promise<void> {
    const record = this.#sessions.find((item) => item.id === id);
    if (!record) {
      return Promise.reject(new CatalogError(ErrorCode.NOT_FOUND, `session '${id}' not found`));
    }
    record.revokedAt = revokedAt;
    return Promise.resolve();
  }
}

interface SessionFile {
  credentials: CredentialRecord[];
  sessions: SessionRecord[];
}

export class FileSessionStore implements SessionStore {
  constructor(private readonly path: string) {}

  async listCredentials(): Promise<CredentialRecord[]> {
    const file = await this.#load();
    return file.credentials.map(cloneCredential);
  }

  commitCredential(record: CredentialRecord): Promise<void> {
    return serialize(this.path, () => this.#commitCredentialImpl(record));
  }

  async #commitCredentialImpl(record: CredentialRecord): Promise<void> {
    const file = await this.#load();
    if (file.credentials.some((item) => item.id === record.id)) {
      throw new CatalogError(ErrorCode.ALREADY_EXISTS, `credential '${record.id}' already exists`);
    }
    file.credentials.push(cloneCredential(record));
    await this.#save(file);
  }

  revokeCredential(id: string, revokedAt: string): Promise<void> {
    return serialize(this.path, () => this.#revokeCredentialImpl(id, revokedAt));
  }

  async #revokeCredentialImpl(id: string, revokedAt: string): Promise<void> {
    const file = await this.#load();
    const record = file.credentials.find((item) => item.id === id);
    if (!record) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `credential '${id}' not found`);
    }
    record.revokedAt = revokedAt;
    await this.#save(file);
  }

  async listSessions(): Promise<SessionRecord[]> {
    const file = await this.#load();
    return file.sessions.map(cloneSession);
  }

  commitSession(record: SessionRecord): Promise<void> {
    return serialize(this.path, () => this.#commitSessionImpl(record));
  }

  async #commitSessionImpl(record: SessionRecord): Promise<void> {
    const file = await this.#load();
    if (file.sessions.some((item) => item.id === record.id)) {
      throw new CatalogError(ErrorCode.ALREADY_EXISTS, `session '${record.id}' already exists`);
    }
    file.sessions.push(cloneSession(record));
    await this.#save(file);
  }

  revokeSession(id: string, revokedAt: string): Promise<void> {
    return serialize(this.path, () => this.#revokeSessionImpl(id, revokedAt));
  }

  async #revokeSessionImpl(id: string, revokedAt: string): Promise<void> {
    const file = await this.#load();
    const record = file.sessions.find((item) => item.id === id);
    if (!record) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `session '${id}' not found`);
    }
    record.revokedAt = revokedAt;
    await this.#save(file);
  }

  async #load(): Promise<SessionFile> {
    try {
      const text = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(text) as Partial<SessionFile>;
      if (!parsed || !Array.isArray(parsed.credentials) || !Array.isArray(parsed.sessions)) {
        throw new Error(`session file is corrupt: ${this.path}`);
      }
      return {
        credentials: parsed.credentials.map(cloneCredential),
        sessions: parsed.sessions.map(cloneSession),
      };
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return { credentials: [], sessions: [] };
      }
      throw error;
    }
  }

  async #save(file: SessionFile): Promise<void> {
    await writeJsonFile(this.path, {
      credentials: file.credentials,
      sessions: file.sessions,
    });
  }
}
