/**
 * The integrity view of the trail: re-derives each pillar's seal and reports
 * what broke, if anything.
 *
 * Reading the trail and checking the trail are different jobs. `AuditService`
 * answers "what happened"; this answers "is what you are reading still what
 * was written". It never writes, and it holds no state: every call re-reads the
 * store, so a verdict cannot go stale.
 *
 * The auditor gate is the same one `AuditService.list` applies, and the records
 * it checks are fetched through the same role-checked service accessors, so
 * this entrance cannot see a record the timeline would hide from an auditor.
 */
import type { AccessService } from "../access/mod.ts";
import type { Actor } from "../catalog/types.ts";
import { CatalogError, type CatalogService, ErrorCode } from "../catalog/mod.ts";
import type { GatewayService } from "../gateway/mod.ts";
import type { ConclusionService } from "./conclusions.ts";
import {
  SEAL_PILLARS,
  type SealedRecord,
  type SealPillar,
  type SealVerdict,
  verifySeal,
} from "./seal.ts";

export interface SealReport {
  /** Every pillar's chain is intact. Unsealed records are reported separately. */
  ok: boolean;
  /** How many records across all pillars no link covers. */
  unsealed: number;
  /** One verdict per pillar that is configured, in `SEAL_PILLARS` order. */
  pillars: SealVerdict[];
}

export class SealService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly access: AccessService,
    private readonly gateway?: GatewayService,
    private readonly conclusions?: ConclusionService,
  ) {}

  async report(actor: Actor): Promise<SealReport> {
    if (!actor || typeof actor !== "object") {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "actor is required");
    }
    if (actor.kind !== "human" || actor.role !== "auditor") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may verify the audit seal",
      );
    }

    const pillars: SealVerdict[] = [];
    for (const pillar of SEAL_PILLARS) {
      const verdict = await this.#verify(pillar, actor);
      if (verdict) pillars.push(verdict);
    }
    return {
      ok: pillars.every((verdict) => verdict.ok),
      unsealed: pillars.reduce((total, verdict) => total + verdict.unsealed.length, 0),
      pillars,
    };
  }

  async #verify(pillar: SealPillar, actor: Actor): Promise<SealVerdict | undefined> {
    switch (pillar) {
      case "catalog": {
        const changes = await this.catalog.listChanges(actor);
        const approvals = await this.catalog.listApprovals(actor);
        return await verifySeal(pillar, await this.catalog.listSeal(), [
          ...changes.map((record) => ({ kind: "change", id: record.id, record })),
          ...approvals.map((record) => ({ kind: "approval", id: record.id, record })),
        ]);
      }
      case "identity": {
        const grants = await this.access.listGrants(actor);
        const revokes = await this.access.listRevokes(actor);
        const credentialRevokes = await this.access.listCredentialRevokes(actor);
        return await verifySeal(pillar, await this.access.listSeal(), [
          ...grants.map((record) => ({ kind: "grant", id: record.id, record })),
          ...revokes.map((record) => ({ kind: "revoke", id: record.id, record })),
          ...credentialRevokes.map((record) => ({
            kind: "credentialRevoke",
            id: record.id,
            record,
          })),
        ]);
      }
      case "gateway": {
        if (!this.gateway) return undefined;
        const records = await this.gateway.listAudit(actor);
        return await verifySeal(
          pillar,
          await this.gateway.listSeal(),
          records.map((record): SealedRecord => ({
            kind: "record",
            id: record.id,
            record,
          })),
        );
      }
      case "conclusions": {
        if (!this.conclusions) return undefined;
        const records = await this.conclusions.list(actor);
        return await verifySeal(
          pillar,
          await this.conclusions.listSeal(),
          records.map((record): SealedRecord => ({
            kind: "conclusion",
            id: record.id,
            record,
          })),
        );
      }
    }
  }
}
