import { AccessService, MemoryIdentityStore, MemorySessionStore } from "../src/access/mod.ts";
import type { Actor, ActorKind } from "../src/catalog/mod.ts";

/**
 * An in-process roster where every identity has actually signed in.
 *
 * Unit tests used to call the services with a literal `Actor` — a claim. The
 * HTTP entrances no longer accept claims, so a fixture has to do the real
 * thing: bootstrap the first human auditor, bootstrap-issue its credential,
 * sign in, and use that session to grant and sign in everyone else. Tests then
 * authenticate with `headersFor(id)`, which is a Bearer session token.
 *
 * The `Actor` literals stay useful for calling services directly (services take
 * a resolved actor by design — resolution happens at the entrances).
 */

export type FixtureRole = "reader" | "maintainer" | "auditor";

export interface RosterFixture {
  access: AccessService;
  auditor: Actor;
  tokenFor(id: string): string;
  headersFor(id: string): HeadersInit;
}

const STANDARD: Array<[string, ActorKind, FixtureRole]> = [
  ["human:security-auditor", "human", "auditor"],
  ["agent:docs-bot", "agent", "maintainer"],
  ["human:reader", "human", "reader"],
];

export async function signedInRoster(
  specs: Array<[string, ActorKind, FixtureRole]> = STANDARD,
): Promise<RosterFixture> {
  const access = new AccessService(new MemoryIdentityStore(), new MemorySessionStore());
  const [firstId, firstKind, firstRole] = specs[0];
  await access.grant(null, { id: firstId, kind: firstKind, role: firstRole });

  const tokens = new Map<string, string>();
  const auditor: Actor = { id: firstId, kind: firstKind, role: firstRole };

  // The one-time bootstrap: no actor, because no session can exist yet.
  const bootstrapCredential = await access.issueCredential(null, { id: firstId });
  const bootstrapSession = await access.login({
    id: firstId,
    token: bootstrapCredential.token,
  });
  tokens.set(firstId, bootstrapSession.token);

  for (const [id, kind, role] of specs.slice(1)) {
    await access.grant(auditor, { id, kind, role });
  }
  for (const [id] of specs.slice(1)) {
    const issued = await access.issueCredential(auditor, { id });
    const session = await access.login({ id, token: issued.token });
    tokens.set(id, session.token);
  }

  return {
    access,
    auditor,
    tokenFor: (id) => {
      const token = tokens.get(id);
      if (!token) throw new Error(`no session for '${id}' in the fixture roster`);
      return token;
    },
    headersFor: (id) => {
      const token = tokens.get(id);
      if (!token) throw new Error(`no session for '${id}' in the fixture roster`);
      return { authorization: `Bearer ${token}` };
    },
  };
}
