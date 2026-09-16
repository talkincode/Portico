import { assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";

const maintainer: Actor = {
  id: "agent:docs-bot",
  kind: "agent",
  role: "maintainer",
};

const humanMaintainer: Actor = {
  id: "human:docs-owner",
  kind: "human",
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

async function pendingPublic(
  service: CatalogService,
  actor: Actor = maintainer,
): Promise<void> {
  await service.register(actor, surface());
  await service.publish(actor, { id: "docs-writer", visibility: "public" });
}

Deno.test("independent human auditor approves pending public; anonymous then sees it", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await pendingPublic(service);

  assertEquals(await service.list(anonymous), []);

  const approved = await service.approve(auditor, { id: "docs-writer" });
  assertEquals(approved.governanceState, "approved_public");
  assertEquals(approved.visibility, "public");

  const listed = await service.list(anonymous);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-writer");
  assertEquals(listed[0].governanceState, "approved_public");

  const got = await service.get(anonymous, "docs-writer");
  assertEquals(got.entry.value, "jsr:@example/docs-writer");

  const approvals = await service.listApprovals(auditor);
  assertEquals(approvals.length, 1);
  assertEquals(approvals[0].surfaceId, "docs-writer");
  assertEquals(approvals[0].decision, "approved");
  assertEquals(approvals[0].submittedBy.id, "agent:docs-bot");
  assertEquals(approvals[0].reviewedBy.id, "human:security-auditor");
  assertEquals(approvals[0].reviewedBy.kind, "human");
  assertEquals(approvals[0].entry.value, "jsr:@example/docs-writer");
});

Deno.test("submitter cannot self-approve even with auditor role; public stays unreachable", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await pendingPublic(service, humanMaintainer);

  const selfAuditor: Actor = {
    id: "human:docs-owner",
    kind: "human",
    role: "auditor",
  };
  await assertRejectsCode(
    () => service.approve(selfAuditor, { id: "docs-writer" }),
    "SELF_APPROVAL",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.governanceState, "pending_public");
  assertEquals(await service.list(anonymous), []);
  assertEquals(await service.listApprovals(auditor), []);
  assertEquals(await store.listApprovals(), []);
});

Deno.test("maintainer cannot approve; pending public is unchanged", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await pendingPublic(service);

  await assertRejectsCode(
    () => service.approve(maintainer, { id: "docs-writer" }),
    "FORBIDDEN",
  );
  const got = await service.get(reader, "docs-writer");
  assertEquals(got.governanceState, "pending_public");
  assertEquals(await store.listApprovals(), []);
  assertEquals(await service.list(anonymous), []);
});

Deno.test("agent cannot approve even with auditor role", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await pendingPublic(service);

  const agentAuditor: Actor = {
    id: "agent:security-bot",
    kind: "agent",
    role: "auditor",
  };
  await assertRejectsCode(
    () => service.approve(agentAuditor, { id: "docs-writer" }),
    "FORBIDDEN",
  );
  assertEquals(await service.list(anonymous), []);
  const got = await service.get(reader, "docs-writer");
  assertEquals(got.governanceState, "pending_public");
});

Deno.test("reader cannot approve; catalog and approvals stay pending", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await pendingPublic(service);

  await assertRejectsCode(
    () => service.approve(reader, { id: "docs-writer" }),
    "FORBIDDEN",
  );
  assertEquals(await store.listApprovals(), []);
});

Deno.test("auditor reject leaves public unreachable and writes an immutable rejection", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await pendingPublic(service);

  const rejected = await service.reject(auditor, { id: "docs-writer" });
  assertEquals(rejected.governanceState, "rejected");
  assertEquals(await service.list(anonymous), []);
  await assertRejectsCode(() => service.get(anonymous, "docs-writer"), "NOT_FOUND");

  const forReader = await service.get(reader, "docs-writer");
  assertEquals(forReader.governanceState, "rejected");

  const approvals = await service.listApprovals(auditor);
  assertEquals(approvals.length, 1);
  assertEquals(approvals[0].decision, "rejected");
  assertEquals(approvals[0].reviewedBy.id, "human:security-auditor");

  await assertRejectsCode(
    () => service.reject(auditor, { id: "docs-writer" }),
    "INVALID_STATE",
  );
  assertEquals((await service.listApprovals(auditor)).length, 1);
  assertEquals(await service.list(anonymous), []);
});

Deno.test("sneaking secret fields into approve is rejected and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await pendingPublic(service);

  await assertRejectsCode(
    () =>
      service.approve(auditor, {
        id: "docs-writer",
        token: "sk-live-not-a-real-secret",
      } as { id: string }),
    "INVALID_INPUT",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.governanceState, "pending_public");
  assertEquals(await store.listApprovals(), []);
  assertEquals(await service.list(anonymous), []);
});

Deno.test("file store failed self-approval leaves pending public and no approval log", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approval-" });
  const path = `${dir}/catalog.json`;
  const { FileCatalogStore } = await import("../src/catalog/mod.ts");
  const store = new FileCatalogStore(path);
  const service = new CatalogService(store);
  await pendingPublic(service, humanMaintainer);

  const selfAuditor: Actor = {
    id: "human:docs-owner",
    kind: "human",
    role: "auditor",
  };
  await assertRejectsCode(
    () => service.approve(selfAuditor, { id: "docs-writer" }),
    "SELF_APPROVAL",
  );

  const file = JSON.parse(await Deno.readTextFile(path)) as {
    records: Array<{ governanceState: string; visibility: string }>;
    approvals?: unknown[];
  };
  assertEquals(file.records.length, 1);
  assertEquals(file.records[0].governanceState, "pending_public");
  assertEquals(file.records[0].visibility, "public");
  assertEquals(file.approvals ?? [], []);
  assertEquals(await service.list(anonymous), []);
});

Deno.test("anonymous cannot read approval records", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await pendingPublic(service);
  await service.approve(auditor, { id: "docs-writer" });
  assertEquals(await service.listApprovals(anonymous), []);
});

Deno.test("auditor approve with a note stores it; omitting note leaves the field off", async () => {
  const withNote = new CatalogService(new MemoryCatalogStore());
  await pendingPublic(withNote);
  await withNote.approve(auditor, {
    id: "docs-writer",
    note: "  Endpoint reviewed; no secret in the entry.  ",
  });
  const recorded = await withNote.listApprovals(reader);
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0].note, "Endpoint reviewed; no secret in the entry.");
  assertEquals(await withNote.listApprovals(anonymous), []);

  const withoutNote = new CatalogService(new MemoryCatalogStore());
  await pendingPublic(withoutNote);
  await withoutNote.approve(auditor, { id: "docs-writer" });
  const bare = await withoutNote.listApprovals(auditor);
  assertEquals(bare.length, 1);
  assertEquals("note" in bare[0], false);
});

Deno.test("reject note is visible to a reader and does not leak to anonymous", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await pendingPublic(service);
  await service.reject(auditor, { id: "docs-writer", note: "Entry points at an internal host." });
  const approvals = await service.listApprovals(reader);
  assertEquals(approvals.length, 1);
  assertEquals(approvals[0].decision, "rejected");
  assertEquals(approvals[0].note, "Entry points at an internal host.");
  assertEquals(await service.listApprovals(anonymous), []);
  assertEquals(await service.list(anonymous), []);
});

Deno.test("invalid approval notes do not write catalog or approval records", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await pendingPublic(service);

  await assertRejectsCode(
    () => service.approve(auditor, { id: "docs-writer", note: "   " }),
    "INVALID_INPUT",
  );
  await assertRejectsCode(
    () => service.approve(auditor, { id: "docs-writer", note: "line\nbreak" }),
    "INVALID_INPUT",
  );
  await assertRejectsCode(
    () => service.approve(auditor, { id: "docs-writer", note: "x".repeat(501) }),
    "INVALID_INPUT",
  );
  await assertRejectsCode(
    () =>
      service.reject(auditor, {
        id: "docs-writer",
        note: 12 as unknown as string,
      }),
    "INVALID_INPUT",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.governanceState, "pending_public");
  assertEquals(await store.listApprovals(), []);
  assertEquals(await service.list(anonymous), []);
});

Deno.test("self-approval with a note still writes nothing", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await pendingPublic(service, humanMaintainer);
  const selfAuditor: Actor = {
    id: "human:docs-owner",
    kind: "human",
    role: "auditor",
  };
  await assertRejectsCode(
    () => service.approve(selfAuditor, { id: "docs-writer", note: "I reviewed my own surface." }),
    "SELF_APPROVAL",
  );
  assertEquals((await service.get(reader, "docs-writer")).governanceState, "pending_public");
  assertEquals(await store.listApprovals(), []);
});
