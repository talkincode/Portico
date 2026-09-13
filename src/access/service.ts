import { CatalogError, ErrorCode } from "../catalog/errors.ts";
import type { Actor, ActorKind, ActorRole } from "../catalog/types.ts";
import type { IdentityStore } from "./store.ts";
import type { GrantInput, GrantRecord, GrantRole, Identity } from "./types.ts";

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
const ACTOR_KINDS = new Set<ActorKind>(["human", "agent"]);
const GRANT_ROLES = new Set<GrantRole>(["reader", "maintainer", "auditor"]);
const ACTOR_ROLES = new Set<ActorRole>(["reader", "maintainer", "auditor", "anonymous"]);

export class AccessService {
  constructor(private readonly store: IdentityStore) {}

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

function parseGrantInput(input: GrantInput): GrantInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "grant payload must be an object");
  }

  const keys = Object.keys(input);
  for (const key of keys) {
    if (SECRET_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "plaintext secret fields are not allowed; store a reference instead",
      );
    }
    if (!ALLOWED_GRANT_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `unknown or forbidden field '${key}'`,
      );
    }
  }

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

function grantId(subjectId: string, grantedAt: string): string {
  const safe = subjectId.replaceAll(/[^a-z0-9-]/gi, "-");
  return `grn-${safe}-${grantedAt.replaceAll(/[^0-9]/g, "")}`;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}
