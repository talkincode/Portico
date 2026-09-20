import { CatalogError, ErrorCode } from "../catalog/errors.ts";
import type { Actor, ActorKind, ActorRole } from "../catalog/types.ts";
import type { IdentityStore, SessionStore } from "./store.ts";
import type {
  CredentialAuditView,
  CredentialRecord,
  CredentialRevokeRecord,
  CredentialRevokeResult,
  GrantInput,
  GrantRecord,
  GrantRole,
  Identity,
  IssueCredentialInput,
  IssuedCredential,
  LoginInput,
  LogoutResult,
  RequestActorInput,
  RevokeInput,
  RevokeRecord,
  RevokeResult,
  SessionAuditView,
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
const ALLOWED_GRANT_KEYS = new Set(["id", "kind", "role", "email"]);
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const MAX_EMAIL_LENGTH = 254;
const ALLOWED_REVOKE_KEYS = new Set(["id"]);
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
      await this.#assertUniqueEmail(parsed);
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

    await this.#assertUniqueEmail(parsed);
    return await this.#commit(parsed, { id: reviewer.id, kind: reviewer.kind });
  }

  async revoke(actor: Actor, input: RevokeInput): Promise<RevokeResult> {
    const parsed = parseRevokeInput(input);
    const reviewer = await this.#requireHumanAuditor(actor);
    const subject = await this.store.get(parsed.id);
    if (!subject) {
      throw new CatalogError(
        ErrorCode.NOT_FOUND,
        `identity '${parsed.id}' is not in the roster`,
      );
    }

    const roster = await this.store.list();
    if (subject.role === "auditor") {
      const remaining = roster.filter((item) => item.role === "auditor" && item.id !== subject.id);
      if (remaining.length === 0) {
        throw new CatalogError(
          ErrorCode.INVALID_STATE,
          "cannot revoke the last human auditor",
        );
      }
    }
    if (reviewer.id === parsed.id) {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "an identity cannot revoke itself",
      );
    }

    const revokedAt = this.clock().toISOString();
    const record: RevokeRecord = {
      id: revokeId(parsed.id, revokedAt),
      subjectId: subject.id,
      kind: subject.kind,
      role: subject.role,
      revokedBy: { id: reviewer.id, kind: reviewer.kind },
      revokedAt,
    };
    await this.store.commitRevoke(record);
    await this.#invalidateSubjectAccess(subject.id, revokedAt);
    return {
      id: record.id,
      subjectId: record.subjectId,
      kind: record.kind,
      role: record.role,
      revoked: true,
      revokedAt: record.revokedAt,
    };
  }

  /**
   * Invalidates login credentials and sessions for a roster identity without
   * removing the identity. This is the incident-response direction of the
   * login surface: a leaked token must die, but the subject remains a
   * granted reader/maintainer/auditor. Only a human auditor may do it.
   */
  async revokeCredentials(
    actor: Actor,
    input: RevokeInput,
  ): Promise<CredentialRevokeResult> {
    const parsed = parseRevokeInput(input);
    const reviewer = await this.#requireHumanAuditor(actor);
    const sessions = this.#requireSessions();
    const subject = await this.store.get(parsed.id);
    if (!subject) {
      throw new CatalogError(
        ErrorCode.NOT_FOUND,
        `identity '${parsed.id}' is not in the roster`,
      );
    }

    const credentials = await sessions.listCredentials();
    const sessionRecords = await sessions.listSessions();
    const activeCredentials = credentials.filter((item) =>
      item.subjectId === subject.id && !item.revokedAt
    );
    const activeSessions = sessionRecords.filter((item) =>
      item.subjectId === subject.id && !item.revokedAt
    );
    if (activeCredentials.length === 0 && activeSessions.length === 0) {
      throw new CatalogError(
        ErrorCode.INVALID_STATE,
        "no active credentials or sessions to revoke",
      );
    }

    const revokedAt = this.clock().toISOString();

    // The audit record is committed *before* the sessions and credentials are
    // invalidated, matching `revoke()` and making a partial failure
    // recoverable: if invalidation stops halfway, the caller sees an error and
    // a retry completes it, because the subject still has live credentials for
    // the retry to find. The opposite order could fail with nothing live left
    // to revoke, which would leave a real revocation permanently unrecorded
    // and the retry returning INVALID_STATE.
    const record: CredentialRevokeRecord = {
      id: credentialRevokeId(subject.id, revokedAt),
      subjectId: subject.id,
      kind: subject.kind,
      role: subject.role,
      revokedBy: { id: reviewer.id, kind: reviewer.kind },
      revokedAt,
      credentials: activeCredentials.length,
      sessions: activeSessions.length,
    };
    await this.store.commitCredentialRevoke(record);
    await this.#invalidateSubjectAccess(subject.id, revokedAt);

    return {
      id: record.id,
      subjectId: record.subjectId,
      kind: record.kind,
      role: record.role,
      revokedCredentials: record.credentials,
      revokedSessions: record.sessions,
      identityRemains: true,
      revokedAt: record.revokedAt,
    };
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
    return records.map(publicIdentity);
  }

  /**
   * Maps a *already verified* email onto a human roster identity.
   *
   * This is not a login and not a second proof: the caller must have checked
   * a signature first. Misses, invalid input, and non-human records are
   * `null`. The roster is not written.
   */
  async lookupHumanByEmail(email: string): Promise<Actor | null> {
    const normalized = normalizeLookupEmail(email);
    if (!normalized) return null;
    const roster = await this.store.list();
    const match = roster.find((item) => item.kind === "human" && item.email === normalized);
    if (!match) return null;
    return { id: match.id, kind: match.kind, role: match.role };
  }

  async listGrants(actor: Actor): Promise<GrantRecord[]> {
    await this.#requireHumanAuditor(actor);
    const records = await this.store.listGrants();
    return records.map(publicGrant);
  }

  /**
   * Login-session trail for a human auditor. Hashes and tokens stay in the
   * store; this projection is id / subject / timestamps only. Reading does
   * not rewrite the session file.
   */
  async listSessions(actor: Actor): Promise<SessionAuditView[]> {
    await this.#requireHumanAuditor(actor);
    const sessions = this.#requireSessions();
    const records = await sessions.listSessions();
    return records.map(publicSession);
  }

  /**
   * Issued-credential trail for a human auditor. The one-time token and its
   * hash stay in the store; this projection is id / subject / issuer /
   * timestamps only. Reading does not rewrite the session file.
   */
  async listCredentials(actor: Actor): Promise<CredentialAuditView[]> {
    await this.#requireHumanAuditor(actor);
    const sessions = this.#requireSessions();
    const records = await sessions.listCredentials();
    return records.map(publicCredential);
  }

  /**
   * Current proven identity. Anonymous is not an identity. Extra roster
   * fields (email, unknown keys) stay off this projection so CLI / Portal /
   * MCP cannot disagree about who is calling.
   */
  async whoami(actor: Actor): Promise<Actor> {
    if (actor.role === "anonymous") {
      throw new CatalogError(ErrorCode.FORBIDDEN, "anonymous has no proven identity");
    }
    assertClaimedActor(actor);
    const record = await this.store.get(actor.id);
    if (!record) {
      throw new CatalogError(ErrorCode.FORBIDDEN, "session is not valid");
    }
    return { id: record.id, kind: record.kind, role: record.role };
  }

  /**
   * Identity-revoke trail for a human auditor. Extra keys that may sit on
   * disk stay off this projection so CLI / Portal / MCP cannot disagree
   * about what an audit view may show. Reading does not rewrite the roster.
   */
  async listRevokes(actor: Actor): Promise<RevokeRecord[]> {
    await this.#requireHumanAuditor(actor);
    const records = await this.store.listRevokes();
    return records.map(publicRevoke);
  }

  async listCredentialRevokes(actor: Actor): Promise<CredentialRevokeRecord[]> {
    await this.#requireHumanAuditor(actor);
    const records = await this.store.listCredentialRevokes();
    return records.map(publicCredentialRevoke);
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

  /**
   * Issues a login credential.
   *
   * With an actor: the caller must be a human auditor, as before. With no
   * actor at all: this is the one-time bootstrap that turns the roster into a
   * trust root. Bootstrap is only possible before any credential has ever been
   * issued, and only for a human auditor — once one credential exists, every
   * later issuance requires an existing auditor session. Without that rule the
   * roster would have no root at all: anyone able to run the CLI could mint
   * themselves an auditor session, and every "agent cannot approve its own
   * publish" guarantee downstream would be decoration.
   *
   * The token is returned exactly once and only its SHA-256 is stored, so it is
   * the one secret in the system that a reader of the data directory cannot
   * recover. Handing it to the human auditor out of band is the operator's job.
   */
  async issueCredential(
    actor: Actor | null,
    input: IssueCredentialInput,
  ): Promise<IssuedCredential> {
    const sessions = this.#requireSessions();
    const parsed = parseCredentialInput(input);
    const subject = await this.store.get(parsed.id);
    if (!subject) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `identity '${parsed.id}' is not in the roster`);
    }

    const reviewer = actor
      ? await this.#requireHumanAuditor(actor)
      : await this.#bootstrapAuditor(subject, sessions);

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

  async #bootstrapAuditor(subject: Identity, sessions: SessionStore): Promise<Actor> {
    if (subject.kind !== "human" || subject.role !== "auditor") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may be issued the bootstrap credential",
      );
    }
    const credentials = await sessions.listCredentials();
    if (credentials.length > 0) {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "this roster already has credentials; sign in with an existing session to issue more",
      );
    }
    return { id: subject.id, kind: subject.kind, role: subject.role };
  }

  async login(input: LoginInput): Promise<SessionView> {
    const sessions = this.#requireSessions();
    const parsed = parseLoginInput(input);
    const subject = await this.store.get(parsed.id);
    const credentials = await sessions.listCredentials();
    const presented = await sha256Hex(parsed.token);
    const match = credentials.find((item) =>
      item.subjectId === parsed.id &&
      !item.revokedAt &&
      timingSafeEqual(item.secretHash, presented)
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

  /**
   * Resolves who is calling.
   *
   * A session token is the only thing that proves an identity. Claimed actor
   * fields are still accepted *alongside* a session as a cross-check, but on
   * their own they prove nothing: the claimant could type any roster id, and
   * the roster ids are published in the README. Accepting them as proof made
   * the whole approval design decorative — a delegated agent could assert
   * `human:security-auditor` and approve its own public submission.
   */
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
    if (claimed) {
      assertClaimedActor(claimed);
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "an identity must be proven with a session; claimed actor fields are not proof",
      );
    }
    return { id: "anonymous", kind: "human", role: "anonymous" };
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

  async #invalidateSubjectAccess(subjectId: string, revokedAt: string): Promise<void> {
    if (!this.sessions) return;
    const sessions = await this.sessions.listSessions();
    for (const session of sessions) {
      if (session.subjectId === subjectId && !session.revokedAt) {
        await this.sessions.revokeSession(session.id, revokedAt);
      }
    }
    const credentials = await this.sessions.listCredentials();
    for (const credential of credentials) {
      if (credential.subjectId === subjectId && !credential.revokedAt) {
        await this.sessions.revokeCredential(credential.id, revokedAt);
      }
    }
  }

  async #assertUniqueEmail(parsed: GrantInput): Promise<void> {
    if (!parsed.email) return;
    const roster = await this.store.list();
    const clash = roster.find((item) =>
      item.id !== parsed.id && item.email?.toLowerCase() === parsed.email
    );
    if (clash) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "email is already bound to another identity",
      );
    }
  }

  async #commit(
    parsed: GrantInput,
    grantedBy: { id: string; kind: ActorKind },
  ): Promise<Identity> {
    const existing = await this.store.get(parsed.id);
    const email = parsed.email ?? existing?.email?.toLowerCase();
    if (email && parsed.kind !== "human") {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "email is only allowed on human identities",
      );
    }
    const now = new Date().toISOString();
    const identity: Identity = {
      id: parsed.id,
      kind: parsed.kind,
      role: parsed.role,
    };
    if (email) identity.email = email;
    const grant: GrantRecord = {
      id: grantId(parsed.id, now),
      subjectId: parsed.id,
      kind: parsed.kind,
      role: parsed.role,
      grantedBy,
      grantedAt: now,
    };
    await this.store.commitGrant(identity, grant);
    return publicIdentity(identity);
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

function parseRevokeInput(input: RevokeInput): RevokeInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "revoke payload must be an object");
  }
  rejectSecretAndUnknownKeys(input, ALLOWED_REVOKE_KEYS);
  if (!nonEmpty(input.id) || input.id.length > 120 || /\s/.test(input.id)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "id is invalid");
  }
  return { id: input.id };
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

  const email = parseOptionalEmail(input.email, input.kind);
  return email
    ? { id: input.id, kind: input.kind, role: input.role, email }
    : { id: input.id, kind: input.kind, role: input.role };
}

function normalizeLookupEmail(value: string): string | null {
  if (!nonEmpty(value) || value.length > MAX_EMAIL_LENGTH) return null;
  const email = value.toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return null;
  return email;
}

function parseOptionalEmail(value: unknown, kind: ActorKind): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !nonEmpty(value) || value.length > MAX_EMAIL_LENGTH) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "email is invalid");
  }
  if (kind !== "human") {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "email is only allowed on human identities",
    );
  }
  const email = value.toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "email is invalid");
  }
  return email;
}

function publicIdentity(record: Identity): Identity {
  const identity: Identity = {
    id: record.id,
    kind: record.kind,
    role: record.role,
  };
  if (record.email) identity.email = record.email;
  return identity;
}

function publicGrant(record: GrantRecord): GrantRecord {
  return {
    id: record.id,
    subjectId: record.subjectId,
    kind: record.kind,
    role: record.role,
    grantedBy: { id: record.grantedBy.id, kind: record.grantedBy.kind },
    grantedAt: record.grantedAt,
  };
}

function publicRevoke(record: RevokeRecord): RevokeRecord {
  return {
    id: record.id,
    subjectId: record.subjectId,
    kind: record.kind,
    role: record.role,
    revokedBy: { id: record.revokedBy.id, kind: record.revokedBy.kind },
    revokedAt: record.revokedAt,
  };
}

function publicCredentialRevoke(record: CredentialRevokeRecord): CredentialRevokeRecord {
  return {
    id: record.id,
    subjectId: record.subjectId,
    kind: record.kind,
    role: record.role,
    revokedBy: { id: record.revokedBy.id, kind: record.revokedBy.kind },
    revokedAt: record.revokedAt,
    credentials: record.credentials,
    sessions: record.sessions,
  };
}

function publicSession(record: SessionRecord): SessionAuditView {
  const view: SessionAuditView = {
    id: record.id,
    subjectId: record.subjectId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
  if (record.revokedAt) view.revokedAt = record.revokedAt;
  return view;
}

function publicCredential(record: CredentialRecord): CredentialAuditView {
  const view: CredentialAuditView = {
    id: record.id,
    subjectId: record.subjectId,
    credentialRef: record.credentialRef,
    issuedBy: { id: record.issuedBy.id, kind: record.issuedBy.kind },
    issuedAt: record.issuedAt,
  };
  if (record.revokedAt) view.revokedAt = record.revokedAt;
  return view;
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
  return `grn-${safe}-${grantedAt.replaceAll(/[^0-9]/g, "")}-${randomHex(4)}`;
}

function revokeId(subjectId: string, revokedAt: string): string {
  const safe = subjectId.replaceAll(/[^a-z0-9-]/gi, "-");
  return `rvk-${safe}-${revokedAt.replaceAll(/[^0-9]/g, "")}-${randomHex(4)}`;
}

function credentialRevokeId(subjectId: string, revokedAt: string): string {
  const safe = subjectId.replaceAll(/[^a-z0-9-]/gi, "-");
  return `crv-${safe}-${revokedAt.replaceAll(/[^0-9]/g, "")}-${randomHex(4)}`;
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
