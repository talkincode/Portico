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
import type { AnchorComparison, AnchorStore } from "./anchors.ts";
import { compareAnchors } from "./anchors.ts";
import type { ConclusionService } from "./conclusions.ts";
import {
  SEAL_PILLARS,
  type SealedRecord,
  type SealEntry,
  type SealPillar,
  type SealVerdict,
  verifySeal,
} from "./seal.ts";

export interface SealedPillar extends SealVerdict {
  /**
   * How this chain reads against the checkpoints that cover it. Absent when no
   * checkpoint covers the pillar, which is reported as an unanchored pillar
   * rather than as a pass.
   */
  anchor?: AnchorComparison;
}

export interface SealReport {
  /**
   * The window this verdict answers. Always `"current"`: the check re-reads the
   * files as they stand and has no historical mode, so — unlike the trail it
   * sits beside, which a caller may read as of any instant — it cannot be
   * sliced. The declaration travels in the payload every entrance renders, so
   * the difference cannot be lost between the machine that asked and the human
   * who reads the answer.
   */
  window: "current";
  /**
   * Every chain is intact *and* nothing a checkpoint pinned has disappeared.
   * A chain rewritten wholesale verifies as a chain, so the anchor reading is
   * part of the verdict rather than a footnote next to it.
   */
  ok: boolean;
  /** How many records across all pillars no link covers. */
  unsealed: number;
  /**
   * Pillars whose tip is backed by a checkpoint. A pillar at zero is not
   * "verified" — nothing outside the file agrees with it — which is the same
   * distinction `unsealed` draws for records.
   */
  anchored: number;
  /** One verdict per pillar that is configured, in `SEAL_PILLARS` order. */
  pillars: SealedPillar[];
}

/** What the caller asked this verdict to answer, beyond the role it proved. */
export interface SealRequest {
  /**
   * A cutoff the caller asked the seal to be read *as of*. There is no such
   * reading — see `SealService.report` — so any non-empty value is refused
   * rather than dropped.
   */
  asOf?: unknown;
}

/**
 * Refuses a cutoff this verdict cannot answer.
 *
 * Dropping one would be the quiet version of the same failure the trail's
 * cutoff grammar refuses: a verdict served for the present while the caller
 * believes it was read at another instant looks exactly like a verdict read at
 * another instant. There is no state of a file to answer a past question from,
 * so the honest answer is that there is no such reading, not a `window` field
 * the caller has to notice.
 */
function assertNoWindow(asOf: unknown): void {
  if (asOf === undefined || asOf === null) return;
  if (typeof asOf === "string" && asOf.trim() === "") return;
  throw new CatalogError(
    ErrorCode.INVALID_INPUT,
    "the seal verdict has no historical mode — it always covers the current files " +
      "(window: current), so it cannot be read as of a cutoff",
  );
}

/** A checkpoint that pins nothing, or pins something still there, holds. */
function anchorHolds(verdict: SealedPillar): boolean {
  return verdict.anchor === undefined || verdict.anchor.state === "intact";
}

export class SealService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly access: AccessService,
    private readonly gateway?: GatewayService,
    private readonly conclusions?: ConclusionService,
    private readonly anchors?: AnchorStore,
  ) {}

  async report(actor: Actor, request: SealRequest = {}): Promise<SealReport> {
    if (!actor || typeof actor !== "object") {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "actor is required");
    }
    if (actor.kind !== "human" || actor.role !== "auditor") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may verify the audit seal",
      );
    }
    // After the gate, never before: a caller who may not read the seal is not
    // told what it would have had to refuse about its request.
    assertNoWindow(request.asOf);

    // Read after the role check, never before: the checkpoint list is audit
    // material and an unauthenticated caller must not be able to time it.
    const anchors = this.anchors ? await this.anchors.list() : [];

    const pillars: SealedPillar[] = [];
    for (const pillar of SEAL_PILLARS) {
      const verified = await this.#verify(pillar, actor);
      if (!verified) continue;
      const anchor = compareAnchors(pillar, verified.chain, anchors);
      pillars.push(anchor ? { ...verified.verdict, anchor } : verified.verdict);
    }
    return {
      window: "current",
      ok: pillars.every((verdict) => verdict.ok && anchorHolds(verdict)),
      unsealed: pillars.reduce((total, verdict) => total + verdict.unsealed.length, 0),
      anchored: pillars.filter((verdict) => verdict.anchor).length,
      pillars,
    };
  }

  async #verify(
    pillar: SealPillar,
    actor: Actor,
  ): Promise<{ verdict: SealVerdict; chain: SealEntry[] } | undefined> {
    switch (pillar) {
      case "catalog": {
        const changes = await this.catalog.listChanges(actor);
        const approvals = await this.catalog.listApprovals(actor);
        const chain = await this.catalog.listSeal();
        return {
          chain,
          verdict: await verifySeal(pillar, chain, [
            ...changes.map((record) => ({ kind: "change", id: record.id, record })),
            ...approvals.map((record) => ({ kind: "approval", id: record.id, record })),
          ]),
        };
      }
      case "identity": {
        const grants = await this.access.listGrants(actor);
        const revokes = await this.access.listRevokes(actor);
        const credentialRevokes = await this.access.listCredentialRevokes(actor);
        const chain = await this.access.listSeal();
        return {
          chain,
          verdict: await verifySeal(pillar, chain, [
            ...grants.map((record) => ({ kind: "grant", id: record.id, record })),
            ...revokes.map((record) => ({ kind: "revoke", id: record.id, record })),
            ...credentialRevokes.map((record) => ({
              kind: "credentialRevoke",
              id: record.id,
              record,
            })),
          ]),
        };
      }
      case "gateway": {
        if (!this.gateway) return undefined;
        const records = await this.gateway.listAudit(actor);
        const chain = await this.gateway.listSeal();
        return {
          chain,
          verdict: await verifySeal(
            pillar,
            chain,
            records.map((record): SealedRecord => ({
              kind: "record",
              id: record.id,
              record,
            })),
          ),
        };
      }
      case "conclusions": {
        if (!this.conclusions) return undefined;
        const records = await this.conclusions.list(actor);
        const chain = await this.conclusions.listSeal();
        return {
          chain,
          verdict: await verifySeal(
            pillar,
            chain,
            records.map((record): SealedRecord => ({
              kind: "conclusion",
              id: record.id,
              record,
            })),
          ),
        };
      }
    }
  }
}
