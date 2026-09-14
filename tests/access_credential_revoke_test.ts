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

const anonymous: Actor = {
  id: "anonymous",
  kind: "human",
  role: "anonymous",
};

async function bootstrapped(
  sessions = new MemorySessionStore(),
): Promise<{
  service: AccessService;
  store: MemoryIdentityStore;
  sessions: MemorySessionStore;
}> {
  const store = new MemoryIdentityStore();
  const service = new AccessService(store, sessions);
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  await service.grant(auditor, { id: reader.id, kind: "human", role: "reader" });
  return { service, store, sessions };
}

Deno.test("auditor revokes credentials; identity stays, old token and session die", async () => {
  const { service, store, sessions } = await bootstrapped();
  const issued = await service.issueCredential(auditor, { id: reader.id });
  const session = await service.login({ id: reader.id, token: issued.token });

  const revoked = await service.revokeCredentials(auditor, { id: reader.id });
  assertEquals(revoked.subjectId, reader.id);
  assertEquals(revoked.kind, "human");
  assertEquals(revoked.role, "reader");
  assertEquals(revoked.revokedCredentials, 1);
  assertEquals(revoked.revokedSessions, 1);
  assertEquals(revoked.identityRemains, true);
  assert(revoked.revokedAt.length > 0);

  assertEquals((await store.list()).map((item) => item.id).includes(reader.id), true);
  assertEquals(await service.resolve(reader), reader);
  await assertRejectsCode(() => service.resolveSession(session.token), "FORBIDDEN");
  await assertRejectsCode(
    () => service.login({ id: reader.id, token: issued.token }),
    "FORBIDDEN",
  );

  assertEquals((await sessions.listSessions())[0].revokedAt, revoked.revokedAt);
  assertEquals((await sessions.listCredentials())[0].revokedAt, revoked.revokedAt);
  assertEquals(JSON.stringify(await sessions.listCredentials()).includes(issued.token), false);
  assertEquals(JSON.stringify(await sessions.listSessions()).includes(session.token), false);

  const records = await service.listCredentialRevokes(auditor);
  assertEquals(records.length, 1);
  assertEquals(records[0].subjectId, reader.id);
  assertEquals(records[0].revokedBy.id, auditor.id);
  assertEquals(records[0].credentials, 1);
  assertEquals(records[0].sessions, 1);
});

Deno.test("after credential revoke the auditor can issue a new credential and the subject logs in again", async () => {
  const { service } = await bootstrapped();
  const first = await service.issueCredential(auditor, { id: reader.id });
  await service.login({ id: reader.id, token: first.token });
  await service.revokeCredentials(auditor, { id: reader.id });

  const second = await service.issueCredential(auditor, { id: reader.id });
  assertEquals(second.token === first.token, false);
  const session = await service.login({ id: reader.id, token: second.token });
  assertEquals(await service.resolveSession(session.token), reader);
  await assertRejectsCode(
    () => service.login({ id: reader.id, token: first.token }),
    "FORBIDDEN",
  );
});

Deno.test("maintainer, reader, and anonymous cannot revoke credentials", async () => {
  const { service, store, sessions } = await bootstrapped();
  const issued = await service.issueCredential(auditor, { id: reader.id });
  await service.login({ id: reader.id, token: issued.token });
  const identitiesBefore = await store.list();
  const credsBefore = await sessions.listCredentials();
  const sessionsBefore = await sessions.listSessions();

  await assertRejectsCode(
    () => service.revokeCredentials(maintainer, { id: reader.id }),
    "FORBIDDEN",
  );
  await assertRejectsCode(
    () => service.revokeCredentials(reader, { id: reader.id }),
    "FORBIDDEN",
  );
  await assertRejectsCode(
    () => service.revokeCredentials(anonymous, { id: reader.id }),
    "FORBIDDEN",
  );

  assertEquals(await store.list(), identitiesBefore);
  assertEquals(await sessions.listCredentials(), credsBefore);
  assertEquals(await sessions.listSessions(), sessionsBefore);
  assertEquals(await store.listCredentialRevokes(), []);
});

Deno.test("unknown subject is NOT_FOUND and writes nothing", async () => {
  const { service, store, sessions } = await bootstrapped();
  await assertRejectsCode(
    () => service.revokeCredentials(auditor, { id: "human:stranger" }),
    "NOT_FOUND",
  );
  assertEquals(await store.listCredentialRevokes(), []);
  assertEquals((await sessions.listCredentials()).length, 0);
});

Deno.test("no active credentials or sessions is INVALID_STATE and writes nothing", async () => {
  const { service, store, sessions } = await bootstrapped();
  await assertRejectsCode(
    () => service.revokeCredentials(auditor, { id: reader.id }),
    "INVALID_STATE",
  );
  assertEquals(await store.listCredentialRevokes(), []);
  assertEquals((await sessions.listCredentials()).length, 0);
  assertEquals((await store.list()).map((item) => item.id).includes(reader.id), true);
});

Deno.test("repeat credential revoke after a successful revoke is INVALID_STATE", async () => {
  const { service, store } = await bootstrapped();
  const issued = await service.issueCredential(auditor, { id: reader.id });
  await service.login({ id: reader.id, token: issued.token });
  await service.revokeCredentials(auditor, { id: reader.id });
  await assertRejectsCode(
    () => service.revokeCredentials(auditor, { id: reader.id }),
    "INVALID_STATE",
  );
  assertEquals((await store.listCredentialRevokes()).length, 1);
});

Deno.test("plaintext secret fields are rejected and do not write", async () => {
  const { service, store, sessions } = await bootstrapped();
  const issued = await service.issueCredential(auditor, { id: reader.id });
  await service.login({ id: reader.id, token: issued.token });

  await assertRejectsCode(
    () =>
      service.revokeCredentials(auditor, {
        id: reader.id,
        token: "literal-secret",
      } as unknown as { id: string }),
    "INVALID_INPUT",
  );
  assertEquals((await sessions.listSessions())[0].revokedAt, undefined);
  assertEquals((await sessions.listCredentials())[0].revokedAt, undefined);
  assertEquals(await store.listCredentialRevokes(), []);
});

Deno.test("file store failed maintainer revoke leaves identity and session bytes unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cred-revoke-" });
  const identities = `${dir}/identities.json`;
  const sessionsPath = `${dir}/sessions.json`;
  const service = new AccessService(
    new FileIdentityStore(identities),
    new FileSessionStore(sessionsPath),
  );
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, { id: reader.id, kind: "human", role: "reader" });
  const issued = await service.issueCredential(auditor, { id: reader.id });
  await service.login({ id: reader.id, token: issued.token });
  const identityBefore = await Deno.readTextFile(identities);
  const sessionBefore = await Deno.readTextFile(sessionsPath);

  await assertRejectsCode(
    () => service.revokeCredentials(maintainer, { id: reader.id }),
    "FORBIDDEN",
  );
  assertEquals(await Deno.readTextFile(identities), identityBefore);
  assertEquals(await Deno.readTextFile(sessionsPath), sessionBefore);
});

Deno.test("file store empty revoke does not rewrite identity or session files", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cred-revoke-empty-" });
  const identities = `${dir}/identities.json`;
  const sessionsPath = `${dir}/sessions.json`;
  const service = new AccessService(
    new FileIdentityStore(identities),
    new FileSessionStore(sessionsPath),
  );
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, { id: reader.id, kind: "human", role: "reader" });
  await Deno.writeTextFile(
    sessionsPath,
    `${JSON.stringify({ credentials: [], sessions: [] }, null, 2)}\n`,
  );
  const identityBefore = await Deno.readTextFile(identities);
  const sessionBefore = await Deno.readTextFile(sessionsPath);

  await assertRejectsCode(
    () => service.revokeCredentials(auditor, { id: reader.id }),
    "INVALID_STATE",
  );
  assertEquals(await Deno.readTextFile(identities), identityBefore);
  assertEquals(await Deno.readTextFile(sessionsPath), sessionBefore);
});
