import { assertEquals, assertRejectsCode } from "./assert.ts";
import {
  AccessService,
  type Actor,
  FileIdentityStore,
  MemoryIdentityStore,
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

async function bootstrapped(): Promise<AccessService> {
  const service = new AccessService(new MemoryIdentityStore());
  await service.grant(null, {
    id: auditor.id,
    kind: "human",
    role: "auditor",
  });
  return service;
}

Deno.test("empty roster bootstraps a human auditor who can list the identity", async () => {
  const service = new AccessService(new MemoryIdentityStore());
  const created = await service.grant(null, {
    id: "human:security-auditor",
    kind: "human",
    role: "auditor",
  });

  assertEquals(created.id, "human:security-auditor");
  assertEquals(created.kind, "human");
  assertEquals(created.role, "auditor");

  const listed = await service.list(auditor);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "human:security-auditor");
  assertEquals(listed[0].role, "auditor");
});

Deno.test("auditor grants agent maintainer; resolve accepts the granted role", async () => {
  const service = await bootstrapped();
  const granted = await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  assertEquals(granted.role, "maintainer");
  assertEquals(granted.kind, "agent");

  const resolved = await service.resolve(maintainer);
  assertEquals(resolved.id, "agent:docs-bot");
  assertEquals(resolved.role, "maintainer");

  const listed = await service.list(maintainer);
  assertEquals(listed.map((item) => item.id).sort(), [
    "agent:docs-bot",
    "human:security-auditor",
  ]);
});

Deno.test("maintainer cannot self-grant auditor; roster stays maintainer", async () => {
  const store = new MemoryIdentityStore();
  const service = new AccessService(store);
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: "human:docs-owner",
    kind: "human",
    role: "maintainer",
  });

  await assertRejectsCode(
    () =>
      service.grant({
        id: "human:docs-owner",
        kind: "human",
        role: "maintainer",
      }, {
        id: "human:docs-owner",
        kind: "human",
        role: "auditor",
      }),
    "FORBIDDEN",
  );

  const identities = await store.list();
  const owner = identities.find((item) => item.id === "human:docs-owner");
  assertEquals(owner?.role, "maintainer");
});

Deno.test("agent cannot be granted auditor; roster is unchanged", async () => {
  const store = new MemoryIdentityStore();
  const service = new AccessService(store);
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });

  await assertRejectsCode(
    () =>
      service.grant(auditor, {
        id: maintainer.id,
        kind: "agent",
        role: "auditor",
      }),
    "FORBIDDEN",
  );

  const identities = await store.list();
  assertEquals(identities.length, 2);
  assertEquals(
    identities.find((item) => item.id === maintainer.id)?.role,
    "maintainer",
  );
});

Deno.test("claimed auditor role is rejected when roster says maintainer", async () => {
  const service = await bootstrapped();
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });

  await assertRejectsCode(
    () =>
      service.resolve({
        id: maintainer.id,
        kind: "agent",
        role: "auditor",
      }),
    "FORBIDDEN",
  );
});

Deno.test("bootstrap cannot start as maintainer; store stays empty", async () => {
  const store = new MemoryIdentityStore();
  const service = new AccessService(store);

  await assertRejectsCode(
    () =>
      service.grant(null, {
        id: maintainer.id,
        kind: "agent",
        role: "maintainer",
      }),
    "FORBIDDEN",
  );
  assertEquals(await store.list(), []);
  assertEquals(await store.listGrants(), []);
});

Deno.test("reader cannot list identities", async () => {
  const service = await bootstrapped();
  await service.grant(auditor, {
    id: reader.id,
    kind: "human",
    role: "reader",
  });

  await assertRejectsCode(() => service.list(reader), "FORBIDDEN");
});

Deno.test("secret fields in grant are rejected and do not write", async () => {
  const store = new MemoryIdentityStore();
  const service = new AccessService(store);
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });

  await assertRejectsCode(
    () =>
      service.grant(auditor, {
        id: maintainer.id,
        kind: "agent",
        role: "maintainer",
        token: "literal-secret",
      } as unknown as { id: string; kind: "agent"; role: "maintainer" }),
    "INVALID_INPUT",
  );
  assertEquals((await store.list()).map((item) => item.id), [auditor.id]);
});

Deno.test("file store failed self-grant leaves bootstrap auditor only", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-access-" });
  const path = `${dir}/identities.json`;
  const service = new AccessService(new FileIdentityStore(path));
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await service.grant(auditor, {
    id: "human:docs-owner",
    kind: "human",
    role: "maintainer",
  });

  await assertRejectsCode(
    () =>
      service.grant({
        id: "human:docs-owner",
        kind: "human",
        role: "maintainer",
      }, {
        id: "human:docs-owner",
        kind: "human",
        role: "auditor",
      }),
    "FORBIDDEN",
  );

  const file = JSON.parse(await Deno.readTextFile(path)) as {
    identities: Array<{ id: string; role: string }>;
    grants: Array<{ subjectId: string; role: string }>;
  };
  assertEquals(
    file.identities.map((item) => `${item.id}:${item.role}`).sort(),
    ["human:docs-owner:maintainer", "human:security-auditor:auditor"],
  );
  assertEquals(file.grants.length, 2);
  assertEquals(
    file.grants.some((item) => item.role === "auditor" && item.subjectId === "human:docs-owner"),
    false,
  );
});

Deno.test("auditor can read append-only grant records; maintainer cannot rewrite by granting self", async () => {
  const service = await bootstrapped();
  await service.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });

  const grants = await service.listGrants(auditor);
  assertEquals(grants.length, 2);
  assertEquals(grants[0].grantedBy.id, "bootstrap");
  assertEquals(grants[1].subjectId, maintainer.id);
  assertEquals(grants[1].grantedBy.id, auditor.id);

  await assertRejectsCode(() => service.listGrants(maintainer), "FORBIDDEN");
});

Deno.test("auditor grants a human with unique email; list returns it without secrets", async () => {
  const service = await bootstrapped();
  const granted = await service.grant(auditor, {
    id: "human:mapped",
    kind: "human",
    role: "reader",
    email: "Mapped@example.invalid",
  });
  assertEquals(granted.id, "human:mapped");
  assertEquals(granted.email, "mapped@example.invalid");
  assertEquals("token" in granted, false);

  const listed = await service.list(auditor);
  const mapped = listed.find((item) => item.id === "human:mapped");
  assertEquals(mapped?.email, "mapped@example.invalid");
  assertEquals(mapped?.kind, "human");
  assertEquals(mapped?.role, "reader");
});

Deno.test("agent cannot be granted an email; roster is unchanged", async () => {
  const store = new MemoryIdentityStore();
  const service = new AccessService(store);
  await service.grant(null, { id: auditor.id, kind: "human", role: "auditor" });

  await assertRejectsCode(
    () =>
      service.grant(auditor, {
        id: maintainer.id,
        kind: "agent",
        role: "maintainer",
        email: "bot@example.invalid",
      }),
    "INVALID_INPUT",
  );
  assertEquals((await store.list()).map((item) => item.id), [auditor.id]);
});

Deno.test("duplicate email is rejected and does not write", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-access-email-" });
  const path = `${dir}/identities.json`;
  const store = new FileIdentityStore(path);
  const service = new AccessService(store);
  await service.grant(null, {
    id: auditor.id,
    kind: "human",
    role: "auditor",
    email: "auditor@example.invalid",
  });
  await service.grant(auditor, {
    id: "human:reader",
    kind: "human",
    role: "reader",
  });
  const before = await Deno.readFile(path);

  await assertRejectsCode(
    () =>
      service.grant(auditor, {
        id: "human:reader",
        kind: "human",
        role: "reader",
        email: "AUDITOR@example.invalid",
      }),
    "INVALID_INPUT",
  );
  assertEquals(await Deno.readFile(path), before);
});

Deno.test("invalid email is rejected; re-grant without email keeps the bound address", async () => {
  const service = await bootstrapped();
  await service.grant(auditor, {
    id: "human:mapped",
    kind: "human",
    role: "reader",
    email: "mapped@example.invalid",
  });

  await assertRejectsCode(
    () =>
      service.grant(auditor, {
        id: "human:other",
        kind: "human",
        role: "reader",
        email: "not-an-email",
      }),
    "INVALID_INPUT",
  );

  const kept = await service.grant(auditor, {
    id: "human:mapped",
    kind: "human",
    role: "maintainer",
  });
  assertEquals(kept.role, "maintainer");
  assertEquals(kept.email, "mapped@example.invalid");
});

Deno.test("identity list projects only id, kind, role and optional email", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-access-project-" });
  const path = `${dir}/identities.json`;
  await Deno.writeTextFile(
    path,
    `${
      JSON.stringify({
        identities: [{
          id: auditor.id,
          kind: "human",
          role: "auditor",
          email: "auditor@example.invalid",
          token: "literal-secret",
        }],
        grants: [],
        revokes: [],
        credentialRevokes: [],
      })
    }\n`,
  );
  const service = new AccessService(new FileIdentityStore(path));
  const listed = await service.list(auditor);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, auditor.id);
  assertEquals(listed[0].email, "auditor@example.invalid");
  assertEquals(Object.keys(listed[0]).sort(), ["email", "id", "kind", "role"]);
  assertEquals(JSON.stringify(listed).includes("literal-secret"), false);
});

Deno.test("lookupHumanByEmail maps a roster address and does not write", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-access-lookup-email-" });
  const path = `${dir}/identities.json`;
  const service = new AccessService(new FileIdentityStore(path));
  await service.grant(null, {
    id: auditor.id,
    kind: "human",
    role: "auditor",
    email: "auditor@example.invalid",
  });
  await service.grant(auditor, {
    id: reader.id,
    kind: "human",
    role: "reader",
    email: "Reader@example.invalid",
  });
  const before = await Deno.readFile(path);

  const mapped = await service.lookupHumanByEmail("READER@example.invalid");
  assertEquals(mapped, { id: reader.id, kind: "human", role: "reader" });
  assertEquals(await service.lookupHumanByEmail("nobody@example.invalid"), null);
  assertEquals(await service.lookupHumanByEmail("not-an-email"), null);
  assertEquals(await Deno.readFile(path), before);
});
