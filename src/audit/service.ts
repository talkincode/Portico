import { AccessService, type GrantRecord, type RevokeRecord } from "../access/mod.ts";
import {
  type Actor,
  type ApprovalRecord,
  type CatalogChangeRecord,
  CatalogError,
  CatalogService,
  ErrorCode,
} from "../catalog/mod.ts";
import { type GatewayAuditRecord, GatewayService } from "../gateway/mod.ts";
import type { AuditEvent } from "./types.ts";

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
    const changes = await this.catalog.listChanges(actor);
    const approvals = await this.catalog.listApprovals(actor);
    const gateway = this.gateway ? await this.gateway.listAudit(actor) : [];

    const events = [
      ...grants.map(fromGrant),
      ...revokes.map(fromRevoke),
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
    id: record.id,
    kind: "grant",
    at: record.grantedAt,
    actor: { id: record.grantedBy.id, kind: record.grantedBy.kind },
    action: "grant",
    subjectId: record.subjectId,
    summary: `grant ${record.subjectId} ${record.role}`,
  };
}

function fromRevoke(record: RevokeRecord): AuditEvent {
  return {
    id: record.id,
    kind: "revoke",
    at: record.revokedAt,
    actor: { id: record.revokedBy.id, kind: record.revokedBy.kind, role: "auditor" },
    action: "revoke",
    subjectId: record.subjectId,
    summary: `revoke ${record.subjectId} ${record.role}`,
  };
}

function fromChange(record: CatalogChangeRecord): AuditEvent {
  return {
    id: record.id,
    kind: "catalog",
    at: record.at,
    actor: { id: record.actor.id, kind: record.actor.kind, role: record.actor.role },
    action: record.action,
    subjectId: record.surfaceId,
    summary: `${record.action} ${record.surfaceId} ${record.governanceState}`,
    entry: { ...record.entry },
  };
}

function fromApproval(record: ApprovalRecord): AuditEvent {
  return {
    id: record.id,
    kind: "approval",
    at: record.reviewedAt,
    actor: { id: record.reviewedBy.id, kind: record.reviewedBy.kind, role: "auditor" },
    action: record.decision,
    subjectId: record.surfaceId,
    summary: `${record.decision} ${record.surfaceId}`,
    entry: { ...record.entry },
  };
}

function fromGateway(record: GatewayAuditRecord): AuditEvent {
  const event: AuditEvent = {
    id: record.id,
    kind: "gateway",
    at: record.at,
    actor: { id: record.actor.id, kind: record.actor.kind, role: record.actor.role },
    action: record.decision,
    subjectId: record.surfaceId,
    summary: `gateway ${record.decision} ${record.surfaceId}`,
  };
  if (record.endpoint) event.entry = { ...record.endpoint };
  return event;
}
