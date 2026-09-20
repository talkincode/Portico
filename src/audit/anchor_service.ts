/**
 * Taking and listing checkpoints, as the auditor's own act.
 *
 * Anchoring is the one step of seal verification that cannot be automated away
 * and must not be: a checkpoint taken by the writer of the trail would prove
 * nothing about the writer. It is therefore the same gate as every other audit
 * reading — human auditor only, never an agent, never a maintainer of what is
 * being checked — and the tips it records are read through `SealService`, so a
 * checkpoint can only ever pin values that survived the seal's own role checks.
 *
 * This service holds no state of its own. It reads, appends, and returns what
 * it appended, so a caller can quote the checkpoint immediately.
 */

import { type Actor, assertActor, CatalogError, ErrorCode } from "../catalog/mod.ts";
import { type AnchorStore, buildAnchor, type SealAnchor } from "./anchors.ts";
import type { SealService } from "./seal_service.ts";

/**
 * Same gate as `AuditService.list` and `SealService.report`. Stated here as
 * well as inside the report because listing checkpoints reads a store of its
 * own, and a gate that only exists on the way in is not a gate.
 */
function assertAuditor(actor: Actor, verb: string): void {
  if (actor.kind !== "human" || actor.role !== "auditor") {
    throw new CatalogError(
      ErrorCode.FORBIDDEN,
      `only a human auditor may ${verb} the seal anchors`,
    );
  }
}

export class AnchorService {
  constructor(
    private readonly store: AnchorStore,
    private readonly seal: SealService,
  ) {}

  /**
   * Records the current tips as a checkpoint.
   *
   * The report is read first and its verdicts are what get pinned, so a chain
   * that is already broken is still anchored: the checkpoint is evidence of
   * what the chain looked like at this moment, not a certificate that it was
   * sound.
   */
  async anchor(actor: Actor): Promise<SealAnchor> {
    assertActor(actor);
    assertAuditor(actor, "take");
    const report = await this.seal.report(actor);
    const anchor = buildAnchor(
      actor,
      report.pillars.map((verdict) => ({
        pillar: verdict.pillar,
        seq: verdict.links,
        tip: verdict.tip,
      })),
    );
    await this.store.append(anchor);
    return anchor;
  }

  async list(actor: Actor): Promise<SealAnchor[]> {
    assertActor(actor);
    assertAuditor(actor, "read");
    return await this.store.list();
  }
}
