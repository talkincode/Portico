import { CatalogError, ErrorCode } from "../catalog/errors.ts";
import type { Actor, ActorKind, ActorRole } from "../catalog/types.ts";
import type { IdentityStore, SessionStore } from "./store.ts";
import type {
  CredentialRecord,
  GrantInput,
  GrantRecord,
  GrantRole,
  Identity,
  IssueCredentialInput,
  IssuedCredential,
  LoginInput,
  LogoutResult,
  RequestActorInput,
  SessionRecord,
  SessionView,
} from "./types.ts";

const SECRET_KEYS = new Set([
  "token",
  "password",
  "secret",
  "apiKey",
  "api_key",
  "privateKey",
  "private_key",
  "credential",
  "credentials",
]);
const ALLOWED_GRANT_KEYS = new Set(["id", "kind", "role"]);
const ALLOWED_CREDENTIAL_KEYS = new Set(["id"]);
const ALLOWED_LOGIN_KEYS = new Set(["id", "token", "ttlSeconds"]);
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;
const ACTOR_KINDS = new Set<ActorKind>(["human", "agent"]);
const GRANT_ROLES = new Set<GrantRole>(["reader", "maintainer", "auditor"]);
const ACTOR_ROLES = new Set<ActorRole>(["reader", "maintainer", "auditor", "anonymous"]);

export class AccessService {
  constructor(
    private readonly store: IdentityStore,
    private readonly sessions?: SessionStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async grant(actor: Actor | null, input: GrantInput): Promise<Identity> {
    const parsed = parseGrantInput(input);
    const existing = await this.store.list();

    if (existing.length === 0) {
      if (parsed.kind !== "human" || parsed.role !== "auditor") {
        throw new CatalogError(
          ErrorCode.FORBIDDEN,
          "the first identity must be a human auditor",
        );
      }
      if (actor && (actor.id !== parsed.id || actor.kind !== "human")) {
        throw new CatalogError(
          ErrorCode.FORBIDDEN,
          "bootstrap actor must match the first human auditor",
        );
      }
      return await this.#commit(parsed, { id: "bootstrap", kind: "human" });
    }

    const reviewer = await this.#requireHumanAuditor(actor);
    if (reviewer.id === parsed.id) {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "an identity cannot grant or change its own role",
      );
    }
    if (parsed.role === "auditor" && parsed.kind !== "human") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "agents cannot be granted auditor",
      );
    }

    return await this.#commit(parsed, { id: reviewer.id, kind: reviewer.kind });
  }

  async list(actor: Actor): Promise<Identity[]> {
    await this.#requireRosterActor(actor);
    if (actor.role === "anonymous") {
      throw new CatalogError(ErrorCode.FORBIDDEN, "anonymous cannot list identities");
    }
    if (actor.role !== "auditor" && actor.role !== "maintainer") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only auditor or maintainer may list identities",
      );
    }
    const records = await this.store.list();
    return records.map((record) => structuredClone(record));
  }

  async listGrants(actor: Actor): Promise<GrantRecord[]> {
    await this.#requireHumanAuditor(actor);
    const records = await this.store.listGrants();
    return records.map((record) => structuredClone(record));
  }

  async resolve(claimed: Actor): Promise<Actor> {
    assertClaimedActor(claimed);
    if (claimed.role === "anonymous") {
      return { id: claimed.id, kind: claimed.kind, role: "anonymous" };
    }
    const record = await this.store.get(claimed.id);
    if (!record) {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        `identity '${claimed.id}' is not in the roster`,
      );
    }
    if (claimed.kind !== record.kind || claimed.role !== record.role) {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "claimed kind or role does not match the granted identity",
      );
    }
    return { id: record.id, kind: record.kind, role: record.role };
  }

  async issueCredential(actor: Actor, input: IssueCredentialInput): Promise<IssuedCredential> {
    const sessions = this.#requireSessions();
    const reviewer = await this.#requireHumanAuditor(actor);
    const parsed = parseCredentialInput(input);
    const subject = await this.store.get(parsed.id);
    if (!subject) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `identity '${parsed.id}' is not in the roster`);
    }

    const issuedAt = this.clock().toISOString();
    const token = randomToken("pct1_");
    const record: CredentialRecord = {
      id: issuedId("crd", parsed.id, issuedAt),
      subjectId: subject.id,
      credentialRef: "",
      secretHash: await sha256Hex(token),
      issuedBy: { id: reviewer.id, kind: reviewer.kind },
      issuedAt,
    };
    record.credentialRef = `issued:${record.id}`;
    await sessions.commitCredential(record);
    return {
      id: record.id,
      subjectId: record.subjectId,
      credentialRef: record.credentialRef,
      token,
      issuedAt,
    };
  }

  async login(input: LoginInput): Promise<SessionView> {
    const sessions = this.#requireSessions();
    const parsed = parseLoginInput(input);
    const subject = await this.store.get(parsed.id);
    const credentials = await sessions.listCredentials();
    const presented = await sha256Hex(parsed.token);
    const match = credentials.find((item) =>
      item.subjectId === parsed.id && timingSafeEqual(item.secretHash, presented)
    );
    if (!subject || !match) {
      throw new CatalogError(ErrorCode.FORBIDDEN, "login failed");
    }

    const createdAt = this.clock();
    const expiresAt = new Date(createdAt.getTime() + parsed.ttlSeconds * 1000);
    const token = randomToken("pst1_");
    const record: SessionRecord = {
      id: issuedId("ses", subject.id, createdAt.toISOString()),
      subjectId: subject.id,
      tokenHash: await sha256Hex(token),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await sessions.commitSession(record);
    return {
      sessionId: record.id,
      token,
      actor: { id: subject.id, kind: subject.kind, role: subject.role },
      expiresAt: record.expiresAt,
    };
  }

  async resolveSession(token: string): Promise<Actor> {
    const record = await this.#findActiveSession(token);
    const subject = await this.store.get(record.subjectId);
    if (!subject) {
      throw new CatalogError(ErrorCode.FORBIDDEN, "session is not valid");
    }
    return { id: subject.id, kind: subject.kind, role: subject.role };
  }

  async logout(token: string): Promise<LogoutResult> {
    const sessions = this.#requireSessions();
    const record = await this.#findSessionByToken(token);
    if (!record || record.revokedAt) {
      throw new CatalogError(ErrorCode.FORBIDDEN, "session is not valid");
    }
    const revokedAt = this.clock().toISOString();
    await sessions.revokeSession(record.id, revokedAt);
    return { sessionId: record.id, revoked: true };
  }

  async resolveRequestActor(input: RequestActorInput): Promise<Actor> {
    const sessionToken = input.sessionToken?.trim() || null;
    const claimed = input.claimed ?? null;
    if (sessionToken) {
      const actor = await this.resolveSession(sessionToken);
      if (claimed) {
        assertClaimedActor(claimed);
        if (
          claimed.id !== actor.id ||
          claimed.kind !== actor.kind ||
          claimed.role !== actor.role
        ) {
          throw new CatalogError(
            ErrorCode.FORBIDDEN,
            "claimed actor does not match the session identity",
          );
        }
      }
      return actor;
    }
    if (!claimed) {
      return { id: "anonymous", kind: "human", role: "anonymous" };
    }
    return await this.resolve(claimed);
  }

  async #requireHumanAuditor(actor: Actor | null): Promise<Actor> {
    if (!actor) {
      throw new CatalogError(ErrorCode.FORBIDDEN, "an auditor actor is required");
    }
    assertClaimedActor(actor);
    const record = await this.store.get(actor.id);
    if (!record || record.role !== "auditor" || record.kind !== "human") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may change identities",
      );
    }
    if (actor.kind !== "human" || actor.role !== "auditor") {
      throw new CatalogError(ErrorCode.FORBIDDEN, "claimed actor is not a human auditor");
    }
    return { id: record.id, kind: record.kind, role: record.role };
  }

  async #requireRosterActor(actor: Actor): Promise<Actor> {
    assertClaimedActor(actor);
    if (actor.role === "anonymous") return actor;
    const record = await this.store.get(actor.id);
    if (!record) {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        `identity '${actor.id}' is not in the roster`,
      );
    }
    if (actor.kind !== record.kind || actor.role !== record.role) {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "claimed kind or role does not match the granted identity",
      );
    }
    return { id: record.id, kind: record.kind, role: record.role };
  }

  #requireSessions(): SessionStore {
    if (!this.sessions) {
      throw new CatalogError(ErrorCode.INVALID_STATE, "session store is not configured");
    }
    return this.sessions;
  }

  async #findActiveSession(token: string): Promise<SessionRecord> {
    const record = await this.#findSessionByToken(token);
    const now = this.clock().toISOString();
    if (!record || record.revokedAt || record.expiresAt <= now) {
      throw new CatalogError(ErrorCode.FORBIDDEN, "session is not valid");
    }
    return record;
  }

  async #findSessionByToken(token: string): Promise<SessionRecord | undefined> {
    if (!nonEmpty(token)) {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "session token is required");
    }
    const sessions = this.#requireSessions();
    const presented = await sha256Hex(token);
    const records = await sessions.listSessions();
    return records.find((item) => timingSafeEqual(item.tokenHash, presented));
  }

  async #commit(
    parsed: GrantInput,
    grantedBy: { id: string; kind: ActorKind },
  ): Promise<Identity> {
    const now = new Date().toISOString();
    const identity: Identity = {
      id: parsed.id,
      kind: parsed.kind,
      role: parsed.role,
    };
    const grant: GrantRecord = {
      id: grantId(parsed.id, now),
      subjectId: parsed.id,
      kind: parsed.kind,
      role: parsed.role,
      grantedBy,
      grantedAt: now,
    };
    await this.store.commitGrant(identity, grant);
    return structuredClone(identity);
  }
}

function rejectSecretAndUnknownKeys(
  input: object,
  allowed: Set<string>,
): void {
  const keys = Object.keys(input);
  for (const key of keys) {
    if (allowed.has(key)) continue;
    if (SECRET_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "plaintext secret fields are not allowed; store a reference instead",
      );
    }
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `unknown or forbidden field '${key}'`,
    );
  }
}

function parseGrantInput(input: GrantInput): GrantInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "grant payload must be an object");
  }
  rejectSecretAndUnknownKeys(input, ALLOWED_GRANT_KEYS);

  if (!nonEmpty(input.id) || input.id.length > 120 || /\s/.test(input.id)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "id is invalid");
  }
  if (!ACTOR_KINDS.has(input.kind)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "kind must be human or agent");
  }
  if (!GRANT_ROLES.has(input.role)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "role must be reader, maintainer, or auditor",
    );
  }

  return { id: input.id, kind: input.kind, role: input.role };
}

function assertClaimedActor(actor: Actor): void {
  if (!actor || typeof actor !== "object") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "actor is required");
  }
  if (!nonEmpty(actor.id) || actor.id.length > 120) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "actor.id is invalid");
  }
  if (!ACTOR_KINDS.has(actor.kind)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "actor.kind is invalid");
  }
  if (!ACTOR_ROLES.has(actor.role)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "actor.role is invalid");
  }
}

function parseCredentialInput(input: IssueCredentialInput): IssueCredentialInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "credential payload must be an object");
  }
  rejectSecretAndUnknownKeys(input, ALLOWED_CREDENTIAL_KEYS);
  if (!nonEmpty(input.id) || input.id.length > 120 || /\s/.test(input.id)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "id is invalid");
  }
  return { id: input.id };
}

function parseLoginInput(input: LoginInput): { id: string; token: string; ttlSeconds: number } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "login payload must be an object");
  }
  rejectSecretAndUnknownKeys(input, ALLOWED_LOGIN_KEYS);
  if (!nonEmpty(input.id) || input.id.length > 120 || /\s/.test(input.id)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "id is invalid");
  }
  if (!nonEmpty(input.token) || input.token.length > 200) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "token is invalid");
  }
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > MAX_SESSION_TTL_SECONDS
  ) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "ttlSeconds is invalid");
  }
  return { id: input.id, token: input.token, ttlSeconds };
}

function grantId(subjectId: string, grantedAt: string): string {
  const safe = subjectId.replaceAll(/[^a-z0-9-]/gi, "-");
  return `grn-${safe}-${grantedAt.replaceAll(/[^0-9]/g, "")}`;
}

function issuedId(prefix: string, subjectId: string, at: string): string {
  const safe = subjectId.replaceAll(/[^a-z0-9-]/gi, "-");
  return `${prefix}-${safe}-${at.replaceAll(/[^0-9]/g, "")}-${randomHex(4)}`;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

function randomToken(prefix: string): string {
  return `${prefix}${randomHex(32)}`;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
