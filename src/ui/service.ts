import type { AuditService } from "../audit/mod.ts";
import {
  type Actor,
  type ActorKind,
  type ActorRole,
  CatalogError,
  CatalogService,
  ErrorCode,
} from "../catalog/mod.ts";
import type { PageStore } from "./store.ts";
import {
  COMPONENT_KINDS,
  type ComponentKind,
  type PageComponentSpec,
  type PageDocument,
  type PageInput,
  type ResolvedComponent,
  type ResolvedPage,
} from "./types.ts";

const ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const ALLOWED_PAGE_KEYS = new Set(["components"]);
const ALLOWED_COMPONENT_KEYS: Record<ComponentKind, Set<string>> = {
  catalog_card: new Set(["kind", "id"]),
  catalog_detail: new Set(["kind", "id"]),
  permission_hint: new Set(["kind"]),
  approval_status: new Set(["kind", "id"]),
  audit_snippet: new Set(["kind", "limit"]),
};
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
const ACTOR_KINDS = new Set<ActorKind>(["human", "agent"]);
const ACTOR_ROLES = new Set<ActorRole>(["reader", "maintainer", "auditor", "anonymous"]);
const MAX_COMPONENTS = 32;
const DEFAULT_AUDIT_LIMIT = 5;
const MAX_AUDIT_LIMIT = 20;

export class PageService {
  constructor(
    private readonly store: PageStore,
    private readonly catalog: CatalogService,
    private readonly audit?: AuditService,
  ) {}

  async set(actor: Actor, input: PageInput | Record<string, unknown>): Promise<PageDocument> {
    assertActor(actor);
    if (actor.role !== "maintainer") {
      throw new CatalogError(ErrorCode.FORBIDDEN, "only a maintainer may compose the portal page");
    }

    const components = parsePageInput(input);
    for (const component of components) {
      if (component.id) {
        await this.catalog.get(actor, component.id);
      }
    }

    const document: PageDocument = {
      updatedAt: new Date().toISOString(),
      updatedBy: { id: actor.id, kind: actor.kind, role: actor.role },
      components,
    };
    await this.store.save(document);
    return structuredClone(document);
  }

  async get(actor: Actor): Promise<ResolvedPage> {
    assertActor(actor);
    const document = await this.store.load();
    if (!document) return { components: [] };

    const components: ResolvedComponent[] = [];
    for (const spec of document.components) {
      const resolved = await this.#resolve(actor, spec);
      if (resolved) components.push(resolved);
    }

    const page: ResolvedPage = { updatedAt: document.updatedAt, components };
    if (actor.role !== "anonymous") {
      page.updatedBy = { ...document.updatedBy };
    }
    return page;
  }

  async #resolve(actor: Actor, spec: PageComponentSpec): Promise<ResolvedComponent | undefined> {
    if (spec.kind === "permission_hint") {
      return {
        kind: "permission_hint",
        role: actor.role,
        canMaintain: actor.role === "maintainer",
        canAudit: actor.kind === "human" && actor.role === "auditor",
        canApprovePublic: actor.kind === "human" && actor.role === "auditor",
      };
    }

    if (spec.kind === "audit_snippet") {
      if (actor.kind !== "human" || actor.role !== "auditor" || !this.audit) {
        return undefined;
      }
      const events = await this.audit.list(actor);
      const limit = spec.limit ?? DEFAULT_AUDIT_LIMIT;
      return {
        kind: "audit_snippet",
        events: events.slice(0, limit).map((event) => structuredClone(event)),
      };
    }

    if (!spec.id) return undefined;
    try {
      const surface = await this.catalog.get(actor, spec.id);
      if (spec.kind === "catalog_card") {
        return {
          kind: "catalog_card",
          id: surface.id,
          name: surface.name,
          description: surface.description,
          governanceState: surface.governanceState,
          visibility: surface.visibility,
          channels: [...surface.channels],
          version: surface.version,
        };
      }
      if (spec.kind === "catalog_detail") {
        return {
          kind: "catalog_detail",
          id: surface.id,
          name: surface.name,
          description: surface.description,
          governanceState: surface.governanceState,
          visibility: surface.visibility,
          channels: [...surface.channels],
          version: surface.version,
          entry: { ...surface.entry },
          maintainers: surface.maintainers.map((item) => ({ ...item })),
        };
      }
      return {
        kind: "approval_status",
        id: surface.id,
        governanceState: surface.governanceState,
        visibility: surface.visibility,
        public: surface.governanceState === "approved_public",
      };
    } catch (error) {
      if (error instanceof CatalogError && error.code === ErrorCode.NOT_FOUND) {
        return undefined;
      }
      throw error;
    }
  }
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

function parsePageInput(input: PageInput | Record<string, unknown>): PageComponentSpec[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "page payload must be an object");
  }

  const keys = Object.keys(input);
  for (const key of keys) {
    rejectSecretOrUnknown(key, ALLOWED_PAGE_KEYS);
  }

  const raw = (input as PageInput).components;
  if (!Array.isArray(raw)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "components must be an array");
  }
  if (raw.length > MAX_COMPONENTS) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "page may have at most 32 components");
  }

  return raw.map(parseComponent);
}

function parseComponent(value: unknown): PageComponentSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "each component must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (SECRET_KEYS.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        "plaintext secret fields are not allowed; store a reference instead",
      );
    }
  }

  const kind = record.kind;
  if (typeof kind !== "string" || !COMPONENT_KINDS.includes(kind as ComponentKind)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `unsupported component kind '${String(kind)}'`,
    );
  }
  const allowed = ALLOWED_COMPONENT_KEYS[kind as ComponentKind];
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new CatalogError(
        ErrorCode.INVALID_INPUT,
        `unknown or forbidden field '${key}'`,
      );
    }
  }

  if (kind === "permission_hint") {
    return { kind };
  }
  if (kind === "audit_snippet") {
    const limit = parseLimit(record.limit);
    return { kind, limit };
  }
  if (typeof record.id !== "string" || !ID_PATTERN.test(record.id)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "id must be 2-63 chars of lowercase kebab-case",
    );
  }
  return { kind: kind as ComponentKind, id: record.id };
}

function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_AUDIT_LIMIT;
  if (
    typeof value !== "number" || !Number.isInteger(value) || value < 1 ||
    value > MAX_AUDIT_LIMIT
  ) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "audit_snippet limit must be an integer 1-20");
  }
  return value;
}

function rejectSecretOrUnknown(key: string, allowed: Set<string>): void {
  if (SECRET_KEYS.has(key)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "plaintext secret fields are not allowed; store a reference instead",
    );
  }
  if (!allowed.has(key)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `unknown or forbidden field '${key}'`);
  }
}

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}
