import { CatalogError, ErrorCode } from "./errors.ts";
import type { CatalogStore } from "./store.ts";
import type {
  Actor,
  ActorKind,
  ActorRole,
  AgentSurface,
  Channel,
  EntryKind,
  EntryRef,
  MaintainerRef,
  PublishInput,
  RegisterInput,
  Visibility,
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
const CHANNELS = new Set<Channel>(["cli", "mcp", "web"]);
const ENTRY_KINDS = new Set<EntryKind>(["url", "package", "mcp_endpoint"]);
const VISIBILITIES = new Set<Visibility>(["internal", "public"]);
const ACTOR_KINDS = new Set<ActorKind>(["human", "agent"]);
const ACTOR_ROLES = new Set<ActorRole>(["reader", "maintainer", "anonymous"]);

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
    await this.store.put(record);
    return structuredClone(record);
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
    await this.store.put(record);
    return structuredClone(record);
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
      await this.store.put(record);
      return structuredClone(record);
    }

    if (
      existing.governanceState === "pending_public" &&
      existing.visibility === "public"
    ) {
      return structuredClone(existing);
    }
    if (
      existing.governanceState !== "draft" &&
      existing.governanceState !== "internal"
    ) {
      throw new CatalogError(
        ErrorCode.INVALID_STATE,
        "only a draft or internal surface can be submitted for public approval",
      );
    }

    const now = new Date().toISOString();
    const record: AgentSurface = {
      ...existing,
      visibility: "public",
      governanceState: "pending_public",
      updatedAt: now,
    };
    await this.store.put(record);
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
  return actor.role === "reader" || actor.role === "maintainer";
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
