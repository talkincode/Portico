import type { Actor, AudienceReport } from "./types.ts";
import type { CatalogService } from "./service.ts";
import type { AccessService } from "../access/service.ts";

/**
 * One surface at the public trust boundary, plus where it stands with every
 * identity in the roster.
 *
 * The two halves come from their own authority — roles from the roster, reach
 * from the catalog's read path — so no entrance can report a set of readers the
 * visibility rule would disagree with. The roster gate runs first: an actor who
 * may not ask is refused before any surface is looked up, and the report names
 * identities without carrying their contact details.
 */
export async function audienceReport(
  catalog: CatalogService,
  access: AccessService,
  actor: Actor,
  id: string,
): Promise<AudienceReport> {
  const identities = await access.list(actor);
  const audience: Actor[] = identities.map((identity) => ({
    id: identity.id,
    kind: identity.kind,
    role: identity.role,
  }));
  return await catalog.boundary(actor, id, audience);
}
