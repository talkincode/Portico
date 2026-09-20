import { assertEquals, assertRejectsCode } from "./assert.ts";
import {
  AccessService,
  type Actor,
  FileIdentityStore,
  MemoryIdentityStore,
  MemorySessionStore,
} from "../src/access/mod.ts";

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

const secondAuditor: Actor = {
  id: "human:second-auditor",
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
  store = new MemoryIdentityStore(),
): Promise<{ service: AccessService; store: MemoryIdentityStore }> {
  const service = new AccessService(store);
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  await service.grant(auditor, { id: reader.id, kind: "human", role: "reader" });
  return { service, store };
}

Deno.test("auditor revokes a maintainer; roster drops them and grants stay append-only", async () => {
  const { service, store } = await bootstrapped();

  const revoked = await service.revoke(auditor, { id: maintainer.id });
  assertEquals(revoked.subjectId, maintainer.id);
  assertEquals(revoked.kind, "agent");
  assertEquals(revoked.role, "maintainer");
  assertEquals(revoked.revoked, true);

  const listed = await service.list(auditor);
  assertEquals(listed.map((item) => item.id).sort(), [auditor.id, reader.id].sort());

  await assertRejectsCode(() => service.resolve(maintainer), "FORBIDDEN");

  const grants = await service.listGrants(auditor);
  assertEquals(grants.some((item) => item.subjectId === maintainer.id), true);

  const revokes = await service.listRevokes(auditor);
  assertEquals(revokes.length, 1);
  assertEquals(revokes[0].subjectId, maintainer.id);
  assertEquals(revokes[0].revokedBy.id, auditor.id);
  assertEquals((await store.list()).map((item) => item.id).includes(maintainer.id), false);
});

Deno.test("revoked maintainer can be granted again; previous revoke record remains", async () => {
  const { service } = await bootstrapped();
  await service.revoke(auditor, { id: maintainer.id });

  const granted = await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  assertEquals(granted.role, "maintainer");
  assertEquals((await service.resolve(maintainer)).id, maintainer.id);
  assertEquals((await service.listRevokes(auditor)).length, 1);
});

Deno.test("maintainer cannot revoke; roster is unchanged", async () => {
  const { service, store } = await bootstrapped();
  const before = await store.list();
  const grantsBefore = await store.listGrants();

  await assertRejectsCode(() => service.revoke(maintainer, { id: reader.id }), "FORBIDDEN");

  assertEquals(await store.list(), before);
  assertEquals(await store.listGrants(), grantsBefore);
  assertEquals(await store.listRevokes(), []);
});

Deno.test("an identity cannot revoke itself when another auditor exists", async () => {
  const { service, store } = await bootstrapped();
  await service.grant(auditor, {
    id: secondAuditor.id,
    kind: "human",
    role: "auditor",
  });
  await assertRejectsCode(() => service.revoke(auditor, { id: auditor.id }), "FORBIDDEN");
  assertEquals((await store.list()).map((item) => item.id).includes(auditor.id), true);
  assertEquals(await store.listRevokes(), []);
});

Deno.test("the last human auditor cannot be revoked", async () => {
  const { service, store } = await bootstrapped();
  await assertRejectsCode(() => service.revoke(auditor, { id: auditor.id }), "INVALID_STATE");
  assertEquals((await store.list()).some((item) => item.id === auditor.id), true);
  assertEquals(await store.listRevokes(), []);
});

Deno.test("another human auditor may revoke an auditor who is not last", async () => {
  const { service } = await bootstrapped();
  await service.grant(auditor, {
    id: secondAuditor.id,
    kind: "human",
    role: "auditor",
  });

  const revoked = await service.revoke(auditor, { id: secondAuditor.id });
  assertEquals(revoked.subjectId, secondAuditor.id);
  assertEquals(revoked.role, "auditor");
  await assertRejectsCode(() => service.resolve(secondAuditor), "FORBIDDEN");
});

Deno.test("unknown identity revoke is NOT_FOUND and writes nothing", async () => {
  const { service, store } = await bootstrapped();
  await assertRejectsCode(
    () => service.revoke(auditor, { id: "agent:stranger" }),
    "NOT_FOUND",
  );
  assertEquals(await store.listRevokes(), []);
});

Deno.test("repeat revoke of an already removed identity is NOT_FOUND", async () => {
  const { service, store } = await bootstrapped();
  await service.revoke(auditor, { id: maintainer.id });
  await assertRejectsCode(() => service.revoke(auditor, { id: maintainer.id }), "NOT_FOUND");
  assertEquals((await store.listRevokes()).length, 1);
});

Deno.test("secret fields in revoke are rejected and do not write", async () => {
  const { service, store } = await bootstrapped();
  await assertRejectsCode(
    () =>
      service.revoke(auditor, {
        id: maintainer.id,
        token: "literal-secret",
      } as unknown as { id: string }),
    "INVALID_INPUT",
  );
  assertEquals((await store.list()).map((item) => item.id).includes(maintainer.id), true);
  assertEquals(await store.listRevokes(), []);
});

Deno.test("file store failed maintainer revoke leaves the identity file bytes unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-revoke-" });
  const path = `${dir}/identities.json`;
  const service = new AccessService(new FileIdentityStore(path));
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  const before = await Deno.readTextFile(path);

  await assertRejectsCode(() => service.revoke(maintainer, { id: reader.id }), "FORBIDDEN");
  assertEquals(await Deno.readTextFile(path), before);
});

Deno.test("file store last-auditor revoke does not rewrite identities", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-revoke-last-" });
  const path = `${dir}/identities.json`;
  const service = new AccessService(new FileIdentityStore(path));
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  const before = await Deno.readTextFile(path);

  await assertRejectsCode(() => service.revoke(auditor, { id: auditor.id }), "INVALID_STATE");
  assertEquals(await Deno.readTextFile(path), before);
});

Deno.test("revoke invalidates active sessions and hashed credentials", async () => {
  const sessions = new MemorySessionStore();
  const service = new AccessService(new MemoryIdentityStore(), sessions);
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  const issued = await service.issueCredential(auditor, { id: maintainer.id });
  const session = await service.login({ id: maintainer.id, token: issued.token });

  await service.revoke(auditor, { id: maintainer.id });

  await assertRejectsCode(() => service.resolveSession(session.token), "FORBIDDEN");
  await assertRejectsCode(
    () => service.login({ id: maintainer.id, token: issued.token }),
    "FORBIDDEN",
  );

  const storedSessions = await sessions.listSessions();
  assertEquals(storedSessions[0].revokedAt !== undefined, true);
  const storedCredentials = await sessions.listCredentials();
  assertEquals(storedCredentials[0].revokedAt !== undefined, true);
});

Deno.test("failed revoke does not revoke sessions or credentials", async () => {
  const sessions = new MemorySessionStore();
  const service = new AccessService(new MemoryIdentityStore(), sessions);
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  await service.grant(auditor, { id: reader.id, kind: "human", role: "reader" });
  const issued = await service.issueCredential(auditor, { id: reader.id });
  const session = await service.login({ id: reader.id, token: issued.token });

  await assertRejectsCode(() => service.revoke(maintainer, { id: reader.id }), "FORBIDDEN");

  assertEquals(await service.resolveSession(session.token), reader);
  assertEquals((await sessions.listSessions())[0].revokedAt, undefined);
  assertEquals((await sessions.listCredentials())[0].revokedAt, undefined);
});

Deno.test("auditor lists revoke trail; maintainer, reader and anonymous are forbidden", async () => {
  const { service } = await bootstrapped();
  const revoked = await service.revoke(auditor, { id: maintainer.id });

  const listed = await service.listRevokes(auditor);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, revoked.id);
  assertEquals(listed[0].subjectId, maintainer.id);
  assertEquals(listed[0].kind, "agent");
  assertEquals(listed[0].role, "maintainer");
  assertEquals(listed[0].revokedBy, { id: auditor.id, kind: "human" });
  assertEquals(listed[0].revokedAt, revoked.revokedAt);
  assertEquals(
    Object.keys(listed[0]).sort(),
    ["id", "kind", "revokedAt", "revokedBy", "role", "subjectId"],
  );
  assertEquals(Object.keys(listed[0].revokedBy).sort(), ["id", "kind"]);

  await assertRejectsCode(() => service.listRevokes(maintainer), "FORBIDDEN");
  await assertRejectsCode(() => service.listRevokes(reader), "FORBIDDEN");
  await assertRejectsCode(
    () => service.listRevokes({ id: "anonymous", kind: "human", role: "anonymous" }),
    "FORBIDDEN",
  );
});

Deno.test("listing revokes does not rewrite the identity file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-revoke-list-" });
  const path = `${dir}/identities.json`;
  const service = new AccessService(new FileIdentityStore(path));
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  await service.revoke(auditor, { id: maintainer.id });
  const before = await Deno.readFile(path);

  const listed = await service.listRevokes(auditor);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].subjectId, maintainer.id);
  assertEquals(await Deno.readFile(path), before);
});

Deno.test("revoke trail projection drops unknown fields from disk", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-revoke-projection-" });
  const path = `${dir}/identities.json`;
  const service = new AccessService(new FileIdentityStore(path));
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  await service.revoke(auditor, { id: maintainer.id });

  const file = JSON.parse(await Deno.readTextFile(path)) as {
    revokes: Array<Record<string, unknown>>;
  };
  file.revokes[0].note = "do-not-leak";
  file.revokes[0].token = "literal-secret";
  await Deno.writeTextFile(path, JSON.stringify(file));

  const listed = await service.listRevokes(auditor);
  assertEquals(listed.length, 1);
  assertEquals(
    Object.keys(listed[0]).sort(),
    ["id", "kind", "revokedAt", "revokedBy", "role", "subjectId"],
  );
  const payload = JSON.stringify(listed);
  assertEquals(payload.includes("do-not-leak"), false);
  assertEquals(payload.includes("literal-secret"), false);
  assertEquals(payload.includes("note"), false);
});
