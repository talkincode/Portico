import type { Actor, BoundarySweepView } from "./types.ts";
import type { CatalogService } from "./service.ts";
import type { AccessService } from "../access/service.ts";

/**
 * The whole public boundary, gated the way the per-record report is.
 *
 * Reading the roster is the gate, not decoration: reconciling the catalog
 * against its approval trail is governance work, so a reader or an anonymous
 * caller is refused before any record is read — and a draft therefore stays out
 * of an auditor's sweep exactly as it stays out of the auditor's catalog read.
 * The sweep reports; it never decides or repairs.
 */
export async function boundarySweep(
  catalog: CatalogService,
  access: AccessService,
  actor: Actor,
): Promise<BoundarySweepView> {
  await access.list(actor);
  return await catalog.boundarySweep(actor);
}
