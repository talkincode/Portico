import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  type AgentSurface,
  audienceReport,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { AccessService, MemoryIdentityStore } from "../src/access/mod.ts";

const maintainer: Actor = {
  id: "agent:docs-bot",
  kind: "agent",
  role: "maintainer",
};

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
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

const READER_EMAIL = "reader@example.test";

function surface(): RegisterInput {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

/**
 * The roster the report is derived from: an independent human auditor, a plain
 * reader, and the maintainer who owns the surface. The reader carries a contact
 * address so the report can be checked for leaking it.
 */
async function roster(): Promise<AccessService> {
  const access = new AccessService(new MemoryIdentityStore());
  await access.grant(null, {
    id: "human:security-auditor",
    kind: "human",
    role: "auditor",
  });
  await access.grant(auditor, {
    id: "human:reader",
    kind: "human",
    role: "reader",
    email: READER_EMAIL,
  });
  await access.grant(auditor, {
    id: "agent:docs-bot",
    kind: "agent",
    role: "maintainer",
  });
  return access;
}

interface Fixture {
  store: MemoryCatalogStore;
  catalog: CatalogService;
  access: AccessService;
}

async function fixture(): Promise<Fixture> {
  const store = new MemoryCatalogStore();
  return { store, catalog: new CatalogService(store), access: await roster() };
}

function report(f: Fixture, actor: Actor, id = "docs-writer") {
  return audienceReport(f.catalog, f.access, actor, id);
}

Deno.test("an internal surface is reachable by every signed-in role and by nobody anonymous", async () => {
  const f = await fixture();
  await f.catalog.register(maintainer, surface());

  const answer = await report(f, auditor);

  assertEquals(answer.id, "docs-writer");
  assertEquals(answer.name, "Docs Writer");
  assertEquals(answer.claimed, { visibility: "internal", governanceState: "internal" });
  assertEquals(answer.served, { visibility: "internal", governanceState: "internal" });
  assertEquals(answer.decision, null);
  assertEquals(answer.mismatch, null);
  assertEquals(answer.reachable, false);
  assertEquals(answer.subjects, [
    { id: "agent:docs-bot", kind: "agent", role: "maintainer", reachable: true },
    { id: "human:reader", kind: "human", role: "reader", reachable: true },
    { id: "human:security-auditor", kind: "human", role: "auditor", reachable: true },
  ]);
});

Deno.test("a draft is visible to its maintainer alone and is hidden from an auditor's audience report", async () => {
  const f = await fixture();
  await f.catalog.draft(maintainer, surface());

  const answer = await report(f, maintainer);

  assertEquals(answer.claimed, { visibility: "internal", governanceState: "draft" });
  assertEquals(answer.served, { visibility: "internal", governanceState: "draft" });
  assertEquals(answer.mismatch, null);
  assertEquals(answer.reachable, false);
  assertEquals(answer.subjects, [
    { id: "agent:docs-bot", kind: "agent", role: "maintainer", reachable: true },
    { id: "human:reader", kind: "human", role: "reader", reachable: false },
    { id: "human:security-auditor", kind: "human", role: "auditor", reachable: false },
  ]);

  // A draft is not readable by the audit role, so the report must not turn into
  // a side channel that confirms the draft exists.
  await assertRejectsCode(() => report(f, auditor), "NOT_FOUND");
  await assertRejectsCode(() => report(f, reader), "FORBIDDEN");
});

Deno.test("an approved public surface is reachable by everyone, on the approval trail's authority", async () => {
  const f = await fixture();
  await f.catalog.register(maintainer, surface());
  await f.catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await f.catalog.approve(auditor, { id: "docs-writer" });

  const answer = await report(f, auditor);

  assertEquals(answer.claimed, { visibility: "public", governanceState: "approved_public" });
  assertEquals(answer.served, { visibility: "public", governanceState: "approved_public" });
  assertEquals(answer.decision, "approved");
  assertEquals(answer.mismatch, null);
  assertEquals(answer.reachable, true);
  assertEquals(answer.subjects, [
    { id: "agent:docs-bot", kind: "agent", role: "maintainer", reachable: true },
    { id: "human:reader", kind: "human", role: "reader", reachable: true },
    { id: "human:security-auditor", kind: "human", role: "auditor", reachable: true },
  ]);
});

Deno.test("a rejected candidate reads as rejected rather than pending, and stays off the public face", async () => {
  const f = await fixture();
  await f.catalog.register(maintainer, surface());
  await f.catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await f.catalog.reject(auditor, { id: "docs-writer", note: "entry is not published" });

  const answer = await report(f, auditor);

  assertEquals(answer.claimed, { visibility: "public", governanceState: "rejected" });
  assertEquals(answer.served, { visibility: "public", governanceState: "rejected" });
  assertEquals(answer.decision, "rejected");
  assertEquals(answer.mismatch, null);
  assertEquals(answer.reachable, false);
});

Deno.test("a withdrawn surface falls back to internal on the read path and reports the withdrawal", async () => {
  const f = await fixture();
  await f.catalog.register(maintainer, surface());
  await f.catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await f.catalog.approve(auditor, { id: "docs-writer" });
  await f.catalog.withdraw(auditor, { id: "docs-writer" });

  const answer = await report(f, auditor);

  assertEquals(answer.claimed, { visibility: "internal", governanceState: "internal" });
  assertEquals(answer.served, { visibility: "internal", governanceState: "internal" });
  assertEquals(answer.decision, "withdrawn");
  assertEquals(answer.mismatch, null);
  assertEquals(answer.reachable, false);
});

Deno.test("a record hand-set to public with no approval is reported as a mismatch, not as reachable", async () => {
  const f = await fixture();
  const forged: AgentSurface = {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "public",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    governanceState: "approved_public",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await f.store.put(forged);

  const answer = await report(f, auditor);

  assertEquals(answer.claimed, { visibility: "public", governanceState: "approved_public" });
  assertEquals(answer.served, { visibility: "internal", governanceState: "internal" });
  assertEquals(answer.decision, null);
  assertEquals(answer.mismatch, "claimed_public_without_approval");
  assertEquals(answer.reachable, false);
  assertEquals(answer.subjects, [
    { id: "agent:docs-bot", kind: "agent", role: "maintainer", reachable: true },
    { id: "human:reader", kind: "human", role: "reader", reachable: true },
    { id: "human:security-auditor", kind: "human", role: "auditor", reachable: true },
  ]);
});

Deno.test("a record put back to internal while the trail still approves is flagged in the other direction", async () => {
  const f = await fixture();
  await f.catalog.register(maintainer, surface());
  await f.catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  const approved = await f.catalog.approve(auditor, { id: "docs-writer" });
  await f.store.put({
    ...approved,
    visibility: "internal",
    governanceState: "internal",
  });

  const answer = await report(f, auditor);

  assertEquals(answer.claimed, { visibility: "internal", governanceState: "internal" });
  assertEquals(answer.served, { visibility: "internal", governanceState: "internal" });
  assertEquals(answer.decision, "approved");
  assertEquals(answer.mismatch, "approved_without_public_record");
  assertEquals(answer.reachable, false);
});

Deno.test("the audience report is restricted to the auditor and maintainer, decided before the surface is looked up", async () => {
  const f = await fixture();
  await f.catalog.register(maintainer, surface());

  await assertRejectsCode(() => report(f, reader), "FORBIDDEN");
  await assertRejectsCode(() => report(f, anonymous), "FORBIDDEN");

  // A role that may not ask learns nothing about an id it names, so the answer
  // cannot differ between an existing and a missing surface.
  await assertRejectsCode(() => report(f, reader, "not-registered"), "FORBIDDEN");
  await assertRejectsCode(() => report(f, auditor, "not-registered"), "NOT_FOUND");
});

Deno.test("reading the audience report writes nothing to the catalog or the trail", async () => {
  const f = await fixture();
  await f.catalog.register(maintainer, surface());
  await f.catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await f.catalog.approve(auditor, { id: "docs-writer" });

  const before = JSON.stringify({
    records: await f.store.list(),
    approvals: await f.store.listApprovals(),
    seal: await f.store.listSeal(),
  });

  await report(f, auditor);
  await report(f, maintainer);

  const after = JSON.stringify({
    records: await f.store.list(),
    approvals: await f.store.listApprovals(),
    seal: await f.store.listSeal(),
  });

  assertEquals(after, before);
});

Deno.test("the report names roster subjects without exposing contact details", async () => {
  const f = await fixture();
  await f.catalog.register(maintainer, surface());

  const answer = await report(f, auditor);

  assert(
    !JSON.stringify(answer).includes(READER_EMAIL),
    "the audience report must not carry roster contact details",
  );
  for (const subject of answer.subjects) {
    assertEquals(Object.keys(subject).sort(), ["id", "kind", "reachable", "role"]);
  }
  assertEquals(
    answer.subjects.map((subject) => subject.id),
    ["agent:docs-bot", "human:reader", "human:security-auditor"],
  );
});
