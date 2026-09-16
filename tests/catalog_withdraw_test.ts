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

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

const agentAuditor: Actor = {
  id: "agent:fake-auditor",
  kind: "agent",
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

async function approvedPublic(service: CatalogService): Promise<void> {
  await service.register(maintainer, surface());
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await service.approve(auditor, { id: "docs-writer" });
}

Deno.test("human auditor withdraws an approved public surface; anonymous loses access", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await approvedPublic(service);

  const visible = await service.list(anonymous);
  assertEquals(visible.length, 1);
  assertEquals(visible[0].governanceState, "approved_public");

  const withdrawn = await service.withdraw(auditor, { id: "docs-writer" });
  assertEquals(withdrawn.governanceState, "internal");
  assertEquals(withdrawn.visibility, "internal");
  assertEquals(withdrawn.publicSubmission, undefined);

  assertEquals(await service.list(anonymous), []);
  await assertRejectsCode(() => service.get(anonymous, "docs-writer"), "NOT_FOUND");

  const internal = await service.get(reader, "docs-writer");
  assertEquals(internal.governanceState, "internal");

  const approvals = await service.listApprovals(auditor);
  assertEquals(approvals.map((record) => record.decision), ["approved", "withdrawn"]);
  const last = approvals[approvals.length - 1];
  assertEquals(last.surfaceId, "docs-writer");
  assertEquals(last.reviewedBy.id, "human:security-auditor");
  assertEquals(last.reviewedBy.kind, "human");
  assertEquals(last.submittedBy.id, "agent:docs-bot");
  assertEquals(last.entry.value, "jsr:@example/docs-writer");
});

Deno.test("withdrawal is reserved for a human auditor; maintainer, reader, and agent are rejected without dirty writes", async () => {
  for (const actor of [maintainer, reader, anonymous, agentAuditor]) {
    const service = new CatalogService(new MemoryCatalogStore());
    await approvedPublic(service);

    await assertRejectsCode(() => service.withdraw(actor, { id: "docs-writer" }), "FORBIDDEN");

    const record = await service.get(auditor, "docs-writer");
    assertEquals(record.governanceState, "approved_public");
    assertEquals(record.visibility, "public");
    assertEquals((await service.list(anonymous)).length, 1);
    assertEquals((await service.listApprovals(auditor)).map((r) => r.decision), ["approved"]);
  }
});

Deno.test("only a live approved public surface can be withdrawn", async () => {
  const missing = new CatalogService(new MemoryCatalogStore());
  await assertRejectsCode(() => missing.withdraw(auditor, { id: "docs-writer" }), "NOT_FOUND");

  const internal = new CatalogService(new MemoryCatalogStore());
  await internal.register(maintainer, surface());
  await assertRejectsCode(() => internal.withdraw(auditor, { id: "docs-writer" }), "INVALID_STATE");
  assertEquals((await internal.get(maintainer, "docs-writer")).governanceState, "internal");
  assertEquals(await internal.listApprovals(auditor), []);

  const pending = new CatalogService(new MemoryCatalogStore());
  await pending.register(maintainer, surface());
  await pending.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await assertRejectsCode(() => pending.withdraw(auditor, { id: "docs-writer" }), "INVALID_STATE");
  assertEquals(
    (await pending.get(maintainer, "docs-writer")).governanceState,
    "pending_public",
  );
  assertEquals(await pending.listApprovals(auditor), []);

  const rejected = new CatalogService(new MemoryCatalogStore());
  await rejected.register(maintainer, surface());
  await rejected.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await rejected.reject(auditor, { id: "docs-writer" });
  await assertRejectsCode(() => rejected.withdraw(auditor, { id: "docs-writer" }), "INVALID_STATE");
  assertEquals((await rejected.get(reader, "docs-writer")).governanceState, "rejected");
  assertEquals((await rejected.listApprovals(auditor)).map((r) => r.decision), ["rejected"]);
});

Deno.test("withdrawal is not idempotent and rejects unknown or secret fields without writing", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await approvedPublic(service);

  await assertRejectsCode(
    () => service.withdraw(auditor, { id: "docs-writer", token: "pct1_plaintext" } as never),
    "INVALID_INPUT",
  );
  await assertRejectsCode(
    () => service.withdraw(auditor, { id: "docs-writer", visibility: "internal" } as never),
    "INVALID_INPUT",
  );
  assertEquals((await service.get(auditor, "docs-writer")).governanceState, "approved_public");

  await service.withdraw(auditor, { id: "docs-writer" });
  await assertRejectsCode(
    () => service.withdraw(auditor, { id: "docs-writer" }),
    "INVALID_STATE",
  );
  assertEquals((await service.listApprovals(auditor)).map((r) => r.decision), [
    "approved",
    "withdrawn",
  ]);
});

Deno.test("auditor withdraw with a note stores it; invalid note does not withdraw", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await approvedPublic(service);
  await service.withdraw(auditor, {
    id: "docs-writer",
    note: "Public entry retired after the owner left.",
  });
  assertEquals(await service.list(anonymous), []);
  const approvals = await service.listApprovals(reader);
  const last = approvals[approvals.length - 1];
  assertEquals(last.decision, "withdrawn");
  assertEquals(last.note, "Public entry retired after the owner left.");

  const blocked = new CatalogService(new MemoryCatalogStore());
  await approvedPublic(blocked);
  await assertRejectsCode(
    () => blocked.withdraw(auditor, { id: "docs-writer", note: "no\ttab" }),
    "INVALID_INPUT",
  );
  assertEquals((await blocked.get(anonymous, "docs-writer")).governanceState, "approved_public");
  assertEquals((await blocked.listApprovals(auditor)).map((r) => r.decision), ["approved"]);
});

Deno.test("a withdrawn surface needs a fresh approval before it is public again", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await approvedPublic(service);
  await service.withdraw(auditor, { id: "docs-writer" });
  assertEquals(await service.list(anonymous), []);

  const resubmitted = await service.publish(maintainer, {
    id: "docs-writer",
    visibility: "public",
  });
  assertEquals(resubmitted.governanceState, "pending_public");
  assertEquals(await service.list(anonymous), []);
  await assertRejectsCode(() => service.get(anonymous, "docs-writer"), "NOT_FOUND");

  const approved = await service.approve(auditor, { id: "docs-writer" });
  assertEquals(approved.governanceState, "approved_public");
  assertEquals((await service.list(anonymous)).length, 1);
});
