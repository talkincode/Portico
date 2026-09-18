import { CatalogError, ErrorCode } from "./errors.ts";
import type { CatalogStore } from "./store.ts";
import type {
  Actor,
  ActorKind,
  ActorRole,
  AgentSurface,
  ApprovalDecision,
  ApprovalDecisionInput,
  ApprovalRecord,
  CatalogChangeAction,
  CatalogChangeRecord,
  Channel,
  CliPackageInfo,
  EntryKind,
  EntryRef,
  MaintainerRef,
  McpConnectionInfo,
  PublicDecision,
  PublishInput,
  RegisterInput,
  UpdateInput,
  Visibility,
  WebConnectionInfo,
} from "./types.ts";

const ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const ALLOWED_REGISTER_KEYS = new Set([
  "id",
  "name",
  "description",
  "channels",
  "version",
  "visibility",
  "entry",
  "maintainers",
]);
const ALLOWED_PUBLISH_KEYS = new Set(["id", "visibility"]);
const ALLOWED_UPDATE_KEYS = new Set([
  "id",
  "name",
  "description",
  "channels",
  "version",
  "entry",
]);
const UPDATE_MUTABLE_KEYS = new Set([
  "name",
  "description",
  "channels",
  "version",
  "entry",
]);
const ALLOWED_APPROVAL_KEYS = new Set(["id", "note"]);
const APPROVAL_NOTE_MAX = 500;
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
// URL query keys accept arbitrary caller spelling (unlike object field names, which are
// already constrained by an allow-list). Real credential-parameter spellings across OAuth,
// AWS SigV4, webhooks, GitLab, and friends are compound words that end in one of a small
// number of secret-shaped suffixes (`client_assertion`, `xamzsecuritytoken`, ...). Matching
// by suffix after stripping case and separators catches spellings nobody has enumerated yet
// instead of only the literal strings a deny list happens to already contain.
const SECRET_QUERY_KEY_SUFFIXES = [
  "token",
  "password",
  "secret",
  "apikey",
  "privatekey",
  "credential",
  "credentials",
  "bearer",
  "authorization",
  "signature",
  "sig",
  "assertion",
];

function normalizeSecretQueryKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSecretShapedQueryKey(key: string): boolean {
  const normalized = normalizeSecretQueryKey(key);
  return SECRET_QUERY_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}
const CHANNELS = new Set<Channel>(["cli", "mcp", "web"]);
const ENTRY_KINDS = new Set<EntryKind>(["url", "package", "mcp_endpoint"]);
const VISIBILITIES = new Set<Visibility>(["internal", "public"]);
const ACTOR_KINDS = new Set<ActorKind>(["human", "agent"]);
const ACTOR_ROLES = new Set<ActorRole>(["reader", "maintainer", "auditor", "anonymous"]);

export class CatalogService {
  constructor(private readonly store: CatalogStore) {}

  async register(actor: Actor, input: RegisterInput): Promise<AgentSurface> {
    assertActor(actor);
    if (actor.role !== "maintainer") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a maintainer may register a catalog surface",
      );
    }

    const parsed = parseRegisterInput(input);
    if (parsed.visibility === "public") {
      throw new CatalogError(
        ErrorCode.PUBLIC_REQUIRES_APPROVAL,
        "public visibility requires a separate approval; register stays internal-only",
      );
    }

    const existing = await this.store.get(parsed.id);
    if (existing) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `surface '${parsed.id}' is already registered`,
      );
    }

    const now = new Date().toISOString();
    const record: AgentSurface = {
      ...parsed,
      visibility: "internal",
      governanceState: "internal",
      createdAt: now,
      updatedAt: now,
    };
    return await this.#commitChange(record, "register", actor);
  }

  async draft(actor: Actor, input: RegisterInput): Promise<AgentSurface> {
    assertActor(actor);
    if (actor.role !== "maintainer") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a maintainer may save a catalog draft",
      );
    }

    const parsed = parseRegisterInput(input);
    if (parsed.visibility === "public") {
      throw new CatalogError(
        ErrorCode.PUBLIC_REQUIRES_APPROVAL,
        "public visibility requires a separate approval; drafts stay internal-only",
      );
    }

    const existing = await this.store.get(parsed.id);
    if (existing) {
      throw new CatalogError(
        ErrorCode.ALREADY_EXISTS,
        `surface '${parsed.id}' is already registered`,
      );
    }

    const now = new Date().toISOString();
    const record: AgentSurface = {
      ...parsed,
      visibility: "internal",
      governanceState: "draft",
      createdAt: now,
      updatedAt: now,
    };
    return await this.#commitChange(record, "draft", actor);
  }

  async publish(actor: Actor, input: PublishInput): Promise<AgentSurface> {
    assertActor(actor);
    if (actor.role !== "maintainer") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a maintainer may publish a catalog surface",
      );
    }

    const parsed = parsePublishInput(input);
    const existing = await this.store.get(parsed.id);
    if (!existing) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `surface '${parsed.id}' was not found`);
    }

    if (parsed.visibility === "internal") {
      if (existing.governanceState === "internal" && existing.visibility === "internal") {
        return structuredClone(existing);
      }
      if (existing.governanceState !== "draft") {
        throw new CatalogError(
          ErrorCode.INVALID_STATE,
          "only a draft can be published as internal",
        );
      }
      const now = new Date().toISOString();
      const record: AgentSurface = {
        ...existing,
        visibility: "internal",
        governanceState: "internal",
        updatedAt: now,
      };
      return await this.#commitChange(record, "publish_internal", actor);
    }

    if (
      existing.governanceState === "pending_public" &&
      existing.visibility === "public"
    ) {
      return structuredClone(existing);
    }
    if (
      existing.governanceState !== "draft" &&
      existing.governanceState !== "internal" &&
      existing.governanceState !== "rejected"
    ) {
      throw new CatalogError(
        ErrorCode.INVALID_STATE,
        "only a draft, internal or rejected surface can be submitted for public approval",
      );
    }

    const now = new Date().toISOString();
    const record: AgentSurface = {
      ...existing,
      visibility: "public",
      governanceState: "pending_public",
      publicSubmission: {
        submittedBy: { id: actor.id, kind: actor.kind },
        submittedAt: now,
      },
      updatedAt: now,
    };
    return await this.#commitChange(record, "publish_public_candidate", actor);
  }

  /**
   * Governed internal update of a surface's own fields (name, description,
   * version, channels, entry). This is deliberately narrower than register:
   * it only ever changes fields on an existing record, never visibility or
   * governanceState directly, and it is only allowed while the record is not
   * public and not mid public-review — `draft`, `internal`, or `rejected`. A
   * `pending_public` candidate or an `approved_public` surface must first be
   * rejected/withdrawn (an independent human-auditor action) before its
   * surface can change; this keeps "update the public-facing surface" from
   * ever being a maintainer-only side door around approval.
   *
   * `rejected` is editable on purpose. A rejected surface never crossed the
   * boundary, so its only outcome is "this submission failed"; leaving it
   * uneditable made the documented reject → fix → resubmit path impossible and
   * permanently poisoned the id. Re-publishing it still needs a fresh,
   * independent approval, so nothing about the boundary is weakened.
   */
  async update(actor: Actor, input: UpdateInput): Promise<AgentSurface> {
    assertActor(actor);
    if (actor.role !== "maintainer") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a maintainer may update a catalog surface",
      );
    }

    const parsed = parseUpdateInput(input);
    const existing = await this.store.get(parsed.id);
    if (!existing) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `surface '${parsed.id}' was not found`);
    }
    if (
      existing.governanceState !== "draft" &&
      existing.governanceState !== "internal" &&
      existing.governanceState !== "rejected"
    ) {
      throw new CatalogError(
        ErrorCode.INVALID_STATE,
        "a pending public candidate or an approved public surface cannot be updated directly; " +
          "reject or withdraw it first, then update, then resubmit for approval",
      );
    }

    const now = new Date().toISOString();
    const channels = parsed.fields.channels ?? existing.channels;
    const entry = parsed.fields.entry ?? existing.entry;
    assertChannelEntry(channels, entry);
    assertWebEntryNotSelfPage(parsed.id, entry);

    const record: AgentSurface = {
      ...existing,
      ...parsed.fields,
      channels,
      entry,
      updatedAt: now,
    };
    return await this.#commitChange(record, "update", actor);
  }

  async approve(actor: Actor, input: ApprovalDecisionInput): Promise<AgentSurface> {
    return await this.#decidePublic(actor, input, "approved");
  }

  async reject(actor: Actor, input: ApprovalDecisionInput): Promise<AgentSurface> {
    return await this.#decidePublic(actor, input, "rejected");
  }

  /**
   * Ends public reachability of an already approved surface.
   *
   * Withdrawal is the safe direction of the public trust boundary — it can only
   * remove exposure, never add it — so it is reserved for a human auditor, the
   * same independent authority that granted exposure. The surface falls back to
   * `internal`; a second public round needs a fresh `publish` + `approve`.
   */
  async withdraw(actor: Actor, input: ApprovalDecisionInput): Promise<AgentSurface> {
    assertActor(actor);
    if (actor.kind !== "human" || actor.role !== "auditor") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may withdraw a public surface",
      );
    }

    const parsed = parseApprovalInput(input);
    const existing = await this.store.get(parsed.id);
    if (!existing) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `surface '${parsed.id}' was not found`);
    }
    if (existing.governanceState !== "approved_public") {
      throw new CatalogError(
        ErrorCode.INVALID_STATE,
        "only an approved public surface can be withdrawn",
      );
    }
    const submittedBy = existing.publicSubmission?.submittedBy;
    if (!submittedBy) {
      throw new CatalogError(
        ErrorCode.INVALID_STATE,
        "approved public surface is missing its public submission",
      );
    }

    const now = new Date().toISOString();
    const { publicSubmission: _clearedSubmission, ...base } = existing;
    const record: AgentSurface = {
      ...base,
      visibility: "internal",
      governanceState: "internal",
      updatedAt: now,
    };
    const approval: ApprovalRecord = {
      id: approvalId(record.id, "withdrawn", now),
      surfaceId: record.id,
      decision: "withdrawn",
      submittedBy: { ...submittedBy },
      reviewedBy: { id: actor.id, kind: actor.kind },
      reviewedAt: now,
      entry: { ...record.entry },
      version: record.version,
      name: record.name,
      ...optionalNote(parsed.note),
    };
    await this.store.commitApproval(record, approval);
    return structuredClone(record);
  }

  async #decidePublic(
    actor: Actor,
    input: ApprovalDecisionInput,
    decision: ApprovalDecision,
  ): Promise<AgentSurface> {
    assertActor(actor);
    if (actor.role !== "auditor") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may decide public visibility",
      );
    }
    if (actor.kind !== "human") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may decide public visibility",
      );
    }

    const parsed = parseApprovalInput(input);
    const existing = await this.store.get(parsed.id);
    if (!existing) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `surface '${parsed.id}' was not found`);
    }
    if (existing.governanceState !== "pending_public") {
      throw new CatalogError(
        ErrorCode.INVALID_STATE,
        "only a pending public candidate can be approved or rejected",
      );
    }
    const submittedBy = existing.publicSubmission?.submittedBy;
    if (!submittedBy) {
      throw new CatalogError(
        ErrorCode.INVALID_STATE,
        "pending public candidate is missing a submitter",
      );
    }
    if (actor.id === submittedBy.id) {
      throw new CatalogError(
        ErrorCode.SELF_APPROVAL,
        "the identity that submitted public cannot decide the same request",
      );
    }

    const now = new Date().toISOString();
    const record: AgentSurface = {
      ...existing,
      visibility: "public",
      governanceState: decision === "approved" ? "approved_public" : "rejected",
      updatedAt: now,
    };
    const approval: ApprovalRecord = {
      id: approvalId(record.id, decision, now),
      surfaceId: record.id,
      decision,
      submittedBy: { ...submittedBy },
      reviewedBy: { id: actor.id, kind: actor.kind },
      reviewedAt: now,
      entry: { ...record.entry },
      version: record.version,
      name: record.name,
      ...optionalNote(parsed.note),
    };
    await this.store.commitApproval(record, approval);
    return structuredClone(record);
  }

  async listApprovals(actor: Actor): Promise<ApprovalRecord[]> {
    assertActor(actor);
    if (actor.role === "anonymous") return [];
    const records = await this.store.listApprovals();
    return records.map((record) => structuredClone(record));
  }

  async listChanges(actor: Actor): Promise<CatalogChangeRecord[]> {
    assertActor(actor);
    if (actor.kind !== "human" || actor.role !== "auditor") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may read catalog change audit",
      );
    }
    const records = await this.store.listChanges();
    return records.map((record) => structuredClone(record));
  }

  async #commitChange(
    record: AgentSurface,
    action: CatalogChangeAction,
    actor: Actor,
  ): Promise<AgentSurface> {
    const change: CatalogChangeRecord = {
      id: changeId(record.id, action, record.updatedAt),
      surfaceId: record.id,
      action,
      actor: { id: actor.id, kind: actor.kind, role: actor.role },
      at: record.updatedAt,
      governanceState: record.governanceState,
      visibility: record.visibility,
      entry: { ...record.entry },
      version: record.version,
      name: record.name,
    };
    await this.store.commitChange(record, change);
    return structuredClone(record);
  }

  async get(actor: Actor, id: string): Promise<AgentSurface> {
    assertActor(actor);
    if (!id || typeof id !== "string") {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "id is required");
    }
    const record = await this.store.get(id);
    if (!record || !canSee(actor, record)) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `surface '${id}' was not found`);
    }
    return structuredClone(record);
  }

  async list(actor: Actor): Promise<AgentSurface[]> {
    assertActor(actor);
    const records = await this.store.list();
    return records.filter((record) => canSee(actor, record)).map((record) =>
      structuredClone(record)
    );
  }

  async listMcp(actor: Actor): Promise<McpConnectionInfo[]> {
    const records = await this.list(actor);
    return records.filter(isMcpSurface).map(toMcpConnection);
  }

  async describeMcp(actor: Actor, id: string): Promise<McpConnectionInfo> {
    const record = await this.get(actor, id);
    if (!isMcpSurface(record)) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `surface '${id}' was not found`);
    }
    return toMcpConnection(record);
  }

  async listWeb(actor: Actor): Promise<WebConnectionInfo[]> {
    const records = await this.list(actor);
    return records.filter(isWebSurface).map(toWebConnection);
  }

  async describeWeb(actor: Actor, id: string): Promise<WebConnectionInfo> {
    const record = await this.get(actor, id);
    if (!isWebSurface(record)) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `surface '${id}' was not found`);
    }
    return toWebConnection(record);
  }

  async listCli(actor: Actor): Promise<CliPackageInfo[]> {
    const records = await this.list(actor);
    return records.filter(isCliSurface).map(toCliPackage);
  }

  async describeCli(actor: Actor, id: string): Promise<CliPackageInfo> {
    const record = await this.get(actor, id);
    if (!isCliSurface(record)) {
      throw new CatalogError(ErrorCode.NOT_FOUND, `surface '${id}' was not found`);
    }
    return toCliPackage(record);
  }
}

function canSee(actor: Actor, record: AgentSurface): boolean {
  if (record.governanceState === "draft") {
    return actor.role === "maintainer";
  }
  if (
    record.visibility === "public" &&
    record.governanceState === "approved_public"
  ) {
    return true;
  }
  if (actor.role === "anonymous") return false;
  return actor.role === "reader" || actor.role === "maintainer" ||
    actor.role === "auditor";
}

function assertActor(actor: Actor): void {
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

function parseApprovalInput(input: ApprovalDecisionInput): ApprovalDecisionInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "approval payload must be an object");
  }

  const keys = Object.keys(input);
  for (const key of keys) {
    if (SECRET_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "plaintext secret fields are not allowed; store a reference instead",
      );
    }
    if (!ALLOWED_APPROVAL_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `unknown or forbidden field '${key}'`,
      );
    }
  }

  if (!ID_PATTERN.test(input.id ?? "")) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "id must be 2-63 chars of lowercase kebab-case",
    );
  }

  const note = parseApprovalNote(input.note);
  return note ? { id: input.id, note } : { id: input.id };
}

function parseApprovalNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "note must be a string");
  }
  const text = value.trim();
  if (!text) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "note is required");
  }
  if (text.length > APPROVAL_NOTE_MAX) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "note is too long");
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "note must not contain control characters",
      );
    }
  }
  return text;
}

function optionalNote(note: string | undefined): { note: string } | Record<never, never> {
  return note ? { note } : {};
}

function approvalId(
  surfaceId: string,
  decision: PublicDecision,
  reviewedAt: string,
): string {
  return `apr-${surfaceId}-${decision}-${stamp(reviewedAt)}-${nextSequence()}`;
}

function changeId(surfaceId: string, action: CatalogChangeAction, at: string): string {
  return `chg-${surfaceId}-${action}-${stamp(at)}-${nextSequence()}`;
}

function stamp(at: string): string {
  return at.replaceAll(/[^0-9]/g, "");
}

/**
 * Millisecond timestamps are not fine enough to keep ids unique: a surface can
 * legitimately be withdrawn and republished inside the same millisecond. The
 * sequence keeps ids unique within the process; the store still rejects any
 * duplicate id outright, so a cross-process clash fails loudly instead of
 * overwriting an audit record.
 */
let idSequence = 0;

function nextSequence(): string {
  idSequence += 1;
  return idSequence.toString(36).padStart(3, "0");
}

function parsePublishInput(input: PublishInput): PublishInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "publish payload must be an object");
  }

  const keys = Object.keys(input);
  for (const key of keys) {
    if (SECRET_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "plaintext secret fields are not allowed; store a reference instead",
      );
    }
    if (!ALLOWED_PUBLISH_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `unknown or forbidden field '${key}'`,
      );
    }
  }

  if (!ID_PATTERN.test(input.id ?? "")) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "id must be 2-63 chars of lowercase kebab-case",
    );
  }
  if (!VISIBILITIES.has(input.visibility)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "visibility must be internal or public");
  }

  return { id: input.id, visibility: input.visibility };
}

function parseUpdateInput(input: UpdateInput): { id: string; fields: Partial<UpdateInput> } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "update payload must be an object");
  }

  const keys = Object.keys(input);
  for (const key of keys) {
    if (SECRET_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "plaintext secret fields are not allowed; store a reference instead",
      );
    }
    if (!ALLOWED_UPDATE_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `unknown or forbidden field '${key}'`,
      );
    }
  }

  if (!ID_PATTERN.test(input.id ?? "")) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "id must be 2-63 chars of lowercase kebab-case",
    );
  }

  const mutableKeys = keys.filter((key) => UPDATE_MUTABLE_KEYS.has(key));
  if (mutableKeys.length === 0) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "update requires at least one of: name, description, channels, version, entry",
    );
  }

  const fields: Partial<UpdateInput> = {};
  if ("name" in input) fields.name = requireText(input.name, "name", 120);
  if ("description" in input) {
    fields.description = requireText(input.description, "description", 2000);
  }
  if ("version" in input) {
    const version = requireText(input.version, "version", 64);
    if (/\s/.test(version)) {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "version must not contain whitespace");
    }
    fields.version = version;
  }
  if ("channels" in input) fields.channels = parseChannels(input.channels);
  if ("entry" in input) fields.entry = parseEntry(input.entry);

  return { id: input.id, fields };
}

function parseRegisterInput(input: RegisterInput): RegisterInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "register payload must be an object");
  }

  const keys = Object.keys(input);
  for (const key of keys) {
    if (SECRET_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "plaintext secret fields are not allowed; store a reference instead",
      );
    }
    if (!ALLOWED_REGISTER_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `unknown or forbidden field '${key}'`,
      );
    }
  }

  if (!ID_PATTERN.test(input.id ?? "")) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "id must be 2-63 chars of lowercase kebab-case",
    );
  }

  const name = requireText(input.name, "name", 120);
  const description = requireText(input.description, "description", 2000);
  const version = requireText(input.version, "version", 64);
  if (/\s/.test(version)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "version must not contain whitespace");
  }

  if (!VISIBILITIES.has(input.visibility)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "visibility must be internal or public");
  }

  const channels = parseChannels(input.channels);
  const entry = parseEntry(input.entry);
  assertChannelEntry(channels, entry);
  assertWebEntryNotSelfPage(input.id, entry);
  const maintainers = parseMaintainers(input.maintainers);

  return {
    id: input.id,
    name,
    description,
    channels,
    version,
    visibility: input.visibility,
    entry,
    maintainers,
  };
}

function parseChannels(value: unknown): Channel[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "channels must be a non-empty array");
  }
  const channels: Channel[] = [];
  for (const item of value) {
    if (!CHANNELS.has(item as Channel)) {
      throw new CatalogError(ErrorCode.INVALID_INPUT, `unsupported channel '${String(item)}'`);
    }
    if (!channels.includes(item as Channel)) channels.push(item as Channel);
  }
  return channels;
}

function isMcpSurface(record: AgentSurface): boolean {
  return record.channels.length === 1 && record.channels[0] === "mcp" &&
    record.entry.kind === "mcp_endpoint";
}

function isWebSurface(record: AgentSurface): boolean {
  return record.channels.length === 1 && record.channels[0] === "web" &&
    record.entry.kind === "url";
}

function isCliSurface(record: AgentSurface): boolean {
  return record.channels.length === 1 && record.channels[0] === "cli" &&
    record.entry.kind === "package";
}

function toMcpConnection(record: AgentSurface): McpConnectionInfo {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    visibility: record.visibility,
    governanceState: record.governanceState,
    endpoint: { ...record.entry },
    connect: { mode: "direct" },
  };
}

function toWebConnection(record: AgentSurface): WebConnectionInfo {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    visibility: record.visibility,
    governanceState: record.governanceState,
    href: { ...record.entry },
    connect: { mode: "direct" },
  };
}

function toCliPackage(record: AgentSurface): CliPackageInfo {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    version: record.version,
    visibility: record.visibility,
    governanceState: record.governanceState,
    package: { ...record.entry },
    connect: { mode: "coordinate" },
  };
}

function assertChannelEntry(channels: Channel[], entry: EntryRef): void {
  const hasMcp = channels.includes("mcp");
  const hasWeb = channels.includes("web");
  const hasCli = channels.includes("cli");
  if (hasMcp && (channels.length !== 1 || entry.kind !== "mcp_endpoint")) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "mcp channel requires a single mcp_endpoint entry",
    );
  }
  if (entry.kind === "mcp_endpoint" && !hasMcp) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "mcp_endpoint requires the mcp channel",
    );
  }
  if (hasWeb && (channels.length !== 1 || entry.kind !== "url")) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "web channel requires a single url entry",
    );
  }
  if (entry.kind === "url" && !hasWeb) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "url entry requires the web channel",
    );
  }
  if (hasCli && (channels.length !== 1 || entry.kind !== "package")) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "cli channel requires a single package entry",
    );
  }
  if (entry.kind === "package" && !hasCli) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "package entry requires the cli channel",
    );
  }
  if (entry.kind === "mcp_endpoint") {
    parseHttpHref(entry.value, "mcp_endpoint");
  }
  if (entry.kind === "url") {
    parseHttpHref(entry.value, "url");
  }
  if (entry.kind === "package") {
    parsePackageCoordinate(entry.value);
  }
}

const JSR_PACKAGE =
  /^jsr:@[a-z0-9][a-z0-9._-]{0,62}\/[a-z0-9][a-z0-9._-]{0,62}(@[a-z0-9][a-z0-9._+-]{0,62})?$/i;
const NPM_PACKAGE =
  /^npm:(@[a-z0-9][a-z0-9._-]{0,62}\/)?[a-z0-9][a-z0-9._-]{0,62}(@[a-z0-9][a-z0-9._+-]{0,62})?$/i;

function parsePackageCoordinate(value: string): void {
  if (/\s/.test(value) || /[;$`|&<>(){}]/.test(value)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "package must be a jsr: or npm: coordinate, not a command",
    );
  }
  if (!JSR_PACKAGE.test(value) && !NPM_PACKAGE.test(value)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "package must be a jsr: or npm: coordinate; Portico does not install or fetch URLs",
    );
  }
}

/**
 * A web entry is the surface's own URL, not Portico's reading page for that
 * surface. `/s/:id` and `/public/s/:id` are Portal chrome; pointing a catalog
 * card at them is a self-loop and is never a real documentation/site entry.
 * Host is ignored: the path is reserved regardless of where Portal is bound.
 */
function assertWebEntryNotSelfPage(id: string, entry: EntryRef): void {
  if (entry.kind !== "url") return;
  let url: URL;
  try {
    url = new URL(entry.value);
  } catch {
    return;
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === `/s/${id}` || path === `/public/s/${id}`) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "web entry must not point at Portico's own reading page for this surface",
    );
  }
}

function parseHttpHref(value: string, field: "mcp_endpoint" | "url"): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `${field} must be an absolute http(s) URL`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `${field} must be an http(s) URL, not a command or other scheme`,
    );
  }
  if (url.username || url.password) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `${field} must not include userinfo; store a secret reference instead`,
    );
  }
  for (const key of url.searchParams.keys()) {
    if (isSecretShapedQueryKey(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "plaintext secret fields are not allowed; store a reference instead",
      );
    }
  }
}

function parseEntry(value: unknown): EntryRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "entry must be an object");
  }
  const entry = value as EntryRef;
  if (!ENTRY_KINDS.has(entry.kind)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "entry.kind is invalid");
  }
  const ref = requireText(entry.value, "entry.value", 500);
  return { kind: entry.kind, value: ref };
}

function parseMaintainers(value: unknown): MaintainerRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "maintainers must be a non-empty array",
    );
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `maintainers[${index}] is invalid`,
      );
    }
    const ref = item as MaintainerRef;
    if (!nonEmpty(ref.id) || ref.id.length > 120) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `maintainers[${index}].id is invalid`,
      );
    }
    if (!ACTOR_KINDS.has(ref.kind)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `maintainers[${index}].kind is invalid`,
      );
    }
    return { id: ref.id, kind: ref.kind };
  });
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `${field} is required`);
  }
  const text = value.trim();
  if (!text) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `${field} is required`);
  }
  if (text.length > max) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `${field} is too long`);
  }
  return text;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
