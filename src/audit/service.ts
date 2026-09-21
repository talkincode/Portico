import {
  AccessService,
  type CredentialRevokeRecord,
  type GrantRecord,
  type RevokeRecord,
} from "../access/mod.ts";
import {
  type Actor,
  type ActorKind,
  type ActorRole,
  type ApprovalRecord,
  type CatalogChangeRecord,
  CatalogError,
  CatalogService,
  type EntryRef,
  ErrorCode,
} from "../catalog/mod.ts";
import { type GatewayAuditRecord, GatewayService } from "../gateway/mod.ts";
import type { AuditActor, AuditEvent } from "./types.ts";

export class AuditService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly access: AccessService,
    private readonly gateway?: GatewayService,
  ) {}

  async list(actor: Actor): Promise<AuditEvent[]> {
    if (!actor || typeof actor !== "object") {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "actor is required");
    }
    if (actor.kind !== "human" || actor.role !== "auditor") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may read the security audit",
      );
    }

    const grants = await this.access.listGrants(actor);
    const revokes = await this.access.listRevokes(actor);
    const credentialRevokes = await this.access.listCredentialRevokes(actor);
    const changes = await this.catalog.listChanges(actor);
    const approvals = await this.catalog.listApprovals(actor);
    const gateway = this.gateway ? await this.gateway.listAudit(actor) : [];

    const events = [
      ...grants.map(fromGrant),
      ...revokes.map(fromRevoke),
      ...credentialRevokes.map(fromCredentialRevoke),
      ...changes.map(fromChange),
      ...approvals.map(fromApproval),
      ...gateway.map(fromGateway),
    ];
    events.sort((left, right) => {
      const byTime = left.at.localeCompare(right.at);
      if (byTime !== 0) return byTime;
      return left.id.localeCompare(right.id);
    });
    return events.map((event) => structuredClone(event));
  }
}

function fromGrant(record: GrantRecord): AuditEvent {
  return {
    id: text(record.id),
    kind: "grant",
    at: text(record.grantedAt),
    actor: creditedActor(record.grantedBy),
    action: "grant",
    subjectId: text(record.subjectId),
    summary: `grant ${text(record.subjectId)} ${text(record.role)}`,
  };
}

function fromRevoke(record: RevokeRecord): AuditEvent {
  return {
    id: text(record.id),
    kind: "revoke",
    at: text(record.revokedAt),
    actor: creditedActor(record.revokedBy, "auditor"),
    action: "revoke",
    subjectId: text(record.subjectId),
    summary: `revoke ${text(record.subjectId)} ${text(record.role)}`,
  };
}

function fromCredentialRevoke(record: CredentialRevokeRecord): AuditEvent {
  return {
    id: text(record.id),
    kind: "credential",
    at: text(record.revokedAt),
    actor: creditedActor(record.revokedBy, "auditor"),
    action: "revoke_credential",
    subjectId: text(record.subjectId),
    summary: `revoke_credential ${text(record.subjectId)} credentials=${
      text(record.credentials)
    } sessions=${text(record.sessions)}`,
  };
}

function fromChange(record: CatalogChangeRecord): AuditEvent {
  return {
    id: text(record.id),
    kind: "catalog",
    at: text(record.at),
    actor: creditedActor(record.actor, claimedRole(record.actor)),
    action: text(record.action),
    subjectId: text(record.surfaceId),
    summary: `${text(record.action)} ${text(record.surfaceId)} ${text(record.governanceState)}`,
    entry: entryRef(record.entry),
  };
}

function fromApproval(record: ApprovalRecord): AuditEvent {
  return {
    id: text(record.id),
    kind: "approval",
    at: text(record.reviewedAt),
    actor: creditedActor(record.reviewedBy, "auditor"),
    action: text(record.decision),
    subjectId: text(record.surfaceId),
    summary: `${text(record.decision)} ${text(record.surfaceId)}`,
    entry: entryRef(record.entry),
  };
}

function fromGateway(record: GatewayAuditRecord): AuditEvent {
  const event: AuditEvent = {
    id: text(record.id),
    kind: "gateway",
    at: text(record.at),
    actor: creditedActor(record.actor, claimedRole(record.actor)),
    action: text(record.decision),
    subjectId: text(record.surfaceId),
    summary: `gateway ${text(record.decision)} ${text(record.surfaceId)}`,
  };
  const entry = entryRef(record.endpoint);
  if (entry) event.entry = entry;
  return event;
}

/**
 * Fail-closed actor for a record whose identity ref cannot be read.
 *
 * The same shape the review and CLI entrances use when nobody proved who they
 * are: the event is not dropped and no identity is invented — the caller is
 * simply not credited.
 */
const UNPROVEN_ACTOR: AuditActor = { id: "anonymous", kind: "human", role: "anonymous" };

/**
 * A string field read off disk.
 *
 * These mappers read files, and a file can be edited behind the store's back.
 * Every one of them feeds a field the timeline sorts, filters and prints, so a
 * missing one used to throw — which let an edit to a data file decide whether
 * the audit page renders at all. A damaged field is reported as damaged
 * instead; naming the damaged record is the seal's job, not this one's.
 */
function text(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

/** The id/kind a record credits, or the unproven actor when that ref is gone. */
function creditedActor(value: unknown, role?: ActorRole): AuditActor {
  const ref = (value ?? {}) as { id?: unknown; kind?: unknown };
  if (typeof ref.id !== "string" || ref.id.length === 0) return UNPROVEN_ACTOR;
  const kind: ActorKind = ref.kind === "human" || ref.kind === "agent"
    ? ref.kind
    : ref.id.startsWith("agent:")
    ? "agent"
    : "human";
  return role === undefined ? { id: ref.id, kind } : { id: ref.id, kind, role };
}

/** The role a ref claims, when it claims one the schema knows. */
function claimedRole(value: unknown): ActorRole | undefined {
  const role = (value as { role?: unknown } | undefined)?.role;
  return role === "reader" || role === "maintainer" || role === "auditor" || role === "anonymous"
    ? role
    : undefined;
}

/** The entry coordinate a record points at, only when it is one. */
function entryRef(value: unknown): EntryRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return { ...value as EntryRef };
}
