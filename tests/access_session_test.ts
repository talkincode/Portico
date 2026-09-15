import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import {
  AccessService,
  type Actor,
  FileIdentityStore,
  FileSessionStore,
  MemoryIdentityStore,
  MemorySessionStore,
} from "../src/access/mod.ts";

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

const maintainer: Actor = {
  id: "agent:docs-bot",
  kind: "agent",
  role: "maintainer",
};

const reader: Actor = {
  id: "human:reader",
  kind: "human",
  role: "reader",
};

async function bootstrapped(
  sessions = new MemorySessionStore(),
  clock: () => Date = () => new Date(),
): Promise<{ service: AccessService; sessions: MemorySessionStore }> {
  const service = new AccessService(new MemoryIdentityStore(), sessions, clock);
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  await service.grant(auditor, { id: reader.id, kind: "human", role: "reader" });
  return { service, sessions };
}

Deno.test("auditor issues a one-time credential; store keeps a hash and reference, not the token", async () => {
  const { service, sessions } = await bootstrapped();
  const issued = await service.issueCredential(auditor, { id: reader.id });

  assertEquals(issued.subjectId, reader.id);
  assertEquals(issued.credentialRef, `issued:${issued.id}`);
  assert(issued.token.startsWith("pct1_"), "issued token must be a one-time credential");

  const stored = await sessions.listCredentials();
  assertEquals(stored.length, 1);
  assertEquals(stored[0].subjectId, reader.id);
  assertEquals(stored[0].credentialRef, issued.credentialRef);
  assertEquals("token" in stored[0], false);
  assert(stored[0].secretHash.length === 64);
  assertEquals(stored[0].secretHash.includes(issued.token), false);
  assertEquals(JSON.stringify(stored).includes(issued.token), false);
});

Deno.test("login with issued token creates a session; role is read from the roster", async () => {
  const { service, sessions } = await bootstrapped();
  const issued = await service.issueCredential(auditor, { id: reader.id });
  const session = await service.login({ id: reader.id, token: issued.token });

  assertEquals(session.actor, reader);
  assert(session.token.startsWith("pst1_"));
  assertEquals(session.sessionId.length > 0, true);

  const resolved = await service.resolveSession(session.token);
  assertEquals(resolved, reader);

  const stored = await sessions.listSessions();
  assertEquals(stored.length, 1);
  assertEquals(stored[0].subjectId, reader.id);
  assertEquals(JSON.stringify(stored).includes(session.token), false);
  assertEquals(JSON.stringify(stored).includes(issued.token), false);
});

Deno.test("wrong login token is forbidden and writes no session", async () => {
  const { service, sessions } = await bootstrapped();
  await service.issueCredential(auditor, { id: reader.id });

  await assertRejectsCode(
    () => service.login({ id: reader.id, token: "pct1_deadbeef" }),
    "FORBIDDEN",
  );
  assertEquals((await sessions.listSessions()).length, 0);
});

Deno.test("expired session cannot resolve an actor", async () => {
  let now = new Date("2026-09-14T00:00:00.000Z");
  const { service } = await bootstrapped(new MemorySessionStore(), () => now);
  const issued = await service.issueCredential(auditor, { id: reader.id });
  const session = await service.login({
    id: reader.id,
    token: issued.token,
    ttlSeconds: 60,
  });

  now = new Date("2026-09-14T00:02:00.000Z");
  await assertRejectsCode(() => service.resolveSession(session.token), "FORBIDDEN");
});

Deno.test("maintainer cannot issue credentials; store stays empty", async () => {
  const { service, sessions } = await bootstrapped();
  await assertRejectsCode(
    () => service.issueCredential(maintainer, { id: reader.id }),
    "FORBIDDEN",
  );
  assertEquals((await sessions.listCredentials()).length, 0);
});

Deno.test("plaintext secret fields are rejected on credential issue", async () => {
  const { service, sessions } = await bootstrapped();
  await assertRejectsCode(
    () =>
      service.issueCredential(auditor, {
        id: reader.id,
        password: "hunter2",
      } as { id: string }),
    "INVALID_INPUT",
  );
  assertEquals((await sessions.listCredentials()).length, 0);
});

Deno.test("logout revokes the session; a failed logout does not revoke others", async () => {
  const { service, sessions } = await bootstrapped();
  const issued = await service.issueCredential(auditor, { id: reader.id });
  const session = await service.login({ id: reader.id, token: issued.token });

  await assertRejectsCode(() => service.logout("pst1_nope"), "FORBIDDEN");
  assertEquals((await sessions.listSessions())[0].revokedAt, undefined);

  const revoked = await service.logout(session.token);
  assertEquals(revoked.revoked, true);
  assertEquals(revoked.sessionId, session.sessionId);
  await assertRejectsCode(() => service.resolveSession(session.token), "FORBIDDEN");
});

Deno.test("request actor from a session ignores forged role headers that do not match", async () => {
  const { service } = await bootstrapped();
  const issued = await service.issueCredential(auditor, { id: reader.id });
  const session = await service.login({ id: reader.id, token: issued.token });

  const resolved = await service.resolveRequestActor({ sessionToken: session.token });
  assertEquals(resolved, reader);

  await assertRejectsCode(
    () =>
      service.resolveRequestActor({
        sessionToken: session.token,
        claimed: { id: reader.id, kind: "human", role: "auditor" },
      }),
    "FORBIDDEN",
  );
});

Deno.test("file session store never persists issued or session tokens as plaintext", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-session-file-" });
  const identities = `${dir}/identities.json`;
  const sessionsPath = `${dir}/sessions.json`;
  const service = new AccessService(
    new FileIdentityStore(identities),
    new FileSessionStore(sessionsPath),
  );
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, { id: reader.id, kind: "human", role: "reader" });

  const issued = await service.issueCredential(auditor, { id: reader.id });
  const session = await service.login({ id: reader.id, token: issued.token });
  const raw = await Deno.readTextFile(sessionsPath);

  assertEquals(raw.includes(issued.token), false);
  assertEquals(raw.includes(session.token), false);
  assertEquals(raw.includes("password"), false);
  const parsed = JSON.parse(raw) as {
    credentials: Array<{ secretHash: string; credentialRef: string }>;
    sessions: Array<{ tokenHash: string }>;
  };
  assertEquals(parsed.credentials.length, 1);
  assertEquals(parsed.sessions.length, 1);
  assertEquals(parsed.credentials[0].credentialRef.startsWith("issued:"), true);
});

Deno.test("auditor lists sessions without hashes or tokens; others are forbidden", async () => {
  const { service, sessions } = await bootstrapped();
  const readerIssued = await service.issueCredential(auditor, { id: reader.id });
  const readerSession = await service.login({ id: reader.id, token: readerIssued.token });
  await service.logout(readerSession.token);

  const auditorIssued = await service.issueCredential(auditor, { id: auditor.id });
  const auditorSession = await service.login({ id: auditor.id, token: auditorIssued.token });

  const listed = await service.listSessions(auditor);
  assertEquals(listed.length, 2);
  assertEquals(listed[0].id.length > 0, true);
  assertEquals(listed[0].subjectId, reader.id);
  assertEquals(typeof listed[0].createdAt, "string");
  assertEquals(typeof listed[0].expiresAt, "string");
  assertEquals(typeof listed[0].revokedAt, "string");
  assertEquals(listed[1].subjectId, auditor.id);
  assertEquals("revokedAt" in listed[1], false);
  for (const row of listed) {
    assertEquals(
      Object.keys(row).sort(),
      row.revokedAt
        ? ["createdAt", "expiresAt", "id", "revokedAt", "subjectId"]
        : ["createdAt", "expiresAt", "id", "subjectId"],
    );
    assertEquals("tokenHash" in row, false);
    assertEquals("token" in row, false);
  }
  const payload = JSON.stringify(listed);
  assertEquals(payload.includes(readerSession.token), false);
  assertEquals(payload.includes(auditorSession.token), false);
  assertEquals(payload.includes(readerIssued.token), false);
  assertEquals(payload.includes("tokenHash"), false);
  assertEquals(payload.includes("secretHash"), false);

  const stored = await sessions.listSessions();
  assertEquals(stored.length, 2);
  assertEquals(stored[0].tokenHash.length, 64);

  await assertRejectsCode(() => service.listSessions(maintainer), "FORBIDDEN");
  await assertRejectsCode(() => service.listSessions(reader), "FORBIDDEN");
  await assertRejectsCode(
    () => service.listSessions({ id: "anonymous", kind: "human", role: "anonymous" }),
    "FORBIDDEN",
  );
});

Deno.test("listing sessions does not rewrite the session file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-session-list-" });
  const identities = `${dir}/identities.json`;
  const sessionsPath = `${dir}/sessions.json`;
  const service = new AccessService(
    new FileIdentityStore(identities),
    new FileSessionStore(sessionsPath),
  );
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  const issued = await service.issueCredential(auditor, { id: auditor.id });
  await service.login({ id: auditor.id, token: issued.token });
  const beforeSessions = await Deno.readFile(sessionsPath);
  const beforeIdentities = await Deno.readFile(identities);

  const listed = await service.listSessions(auditor);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].subjectId, auditor.id);
  assertEquals(await Deno.readFile(sessionsPath), beforeSessions);
  assertEquals(await Deno.readFile(identities), beforeIdentities);
});

Deno.test("listSessions without a session store is INVALID_STATE for an auditor", async () => {
  const service = new AccessService(new MemoryIdentityStore());
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await assertRejectsCode(() => service.listSessions(auditor), "INVALID_STATE");
});
