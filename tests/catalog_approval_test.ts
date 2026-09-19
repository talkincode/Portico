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

function webSurface(url: string): RegisterInput {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["web"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "url", value: url },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

async function pendingPublicWeb(service: CatalogService, url: string): Promise<void> {
  await service.register(maintainer, webSurface(url));
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
}

// Every host here is unreachable from the public internet: RFC1918 space,
// loopback, link-local, IPv6 unique-local/link-local, IPv4-mapped spellings of
// the same, and single-label names — public DNS requires a dot, so a bare
// label is an internal-only name by construction. That last rule matters
// because naming internal hosts explicitly would put the names in this repo.
const INTERNAL_ONLY_ENTRIES = [
  "http://10.0.0.5:8788/docs",
  "http://172.16.4.4/docs",
  "http://192.168.1.10/docs",
  "http://127.0.0.1:8788/docs",
  "http://169.254.10.10/docs",
  "http://0.0.0.0:8788/docs",
  "http://localhost:8788/docs",
  "http://api.localhost/docs",
  "http://intranet:8788/docs",
  "http://wiki/docs",
  "http://[::1]:8788/docs",
  "http://[fd00::1]/docs",
  "http://[fe80::1]/docs",
  "http://[fec0::1]/docs",
  "http://[::ffff:10.0.0.5]/docs",
  "http://10.0.0.5./docs",
];

Deno.test("public approval refuses an entry only reachable inside the network", async () => {
  for (const url of INTERNAL_ONLY_ENTRIES) {
    const store = new MemoryCatalogStore();
    const service = new CatalogService(store);
    await pendingPublicWeb(service, url);
    await assertRejectsCode(
      () => service.approve(auditor, { id: "docs-writer" }),
      "INVALID_STATE",
    );
    assertEquals(
      (await service.get(reader, "docs-writer")).governanceState,
      "pending_public",
      `approval must leave '${url}' pending`,
    );
    assertEquals(await store.listApprovals(), [], `no approval record for '${url}'`);
    assertEquals(await service.list(anonymous), [], `'${url}' must stay anonymous`);
  }
});

Deno.test("public approval refuses an internal-only mcp endpoint", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, {
    id: "docs-mcp",
    name: "Docs MCP",
    description: "Internal documentation MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: "http://10.20.30.40:8790/mcp" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  });
  await service.publish(maintainer, { id: "docs-mcp", visibility: "public" });

  await assertRejectsCode(
    () => service.approve(auditor, { id: "docs-mcp" }),
    "INVALID_STATE",
  );
  assertEquals((await service.get(reader, "docs-mcp")).governanceState, "pending_public");
  assertEquals(await store.listApprovals(), []);
});

Deno.test("internal records may still carry an internal-only coordinate", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, webSurface("http://10.0.0.5:8788/docs"));

  const seen = await service.get(reader, "docs-writer");
  assertEquals(seen.entry.value, "http://10.0.0.5:8788/docs");
  assertEquals(await service.list(anonymous), []);

  const republished = await service.publish(maintainer, {
    id: "docs-writer",
    visibility: "internal",
  });
  assertEquals(republished.visibility, "internal");
});

Deno.test("rejecting an internal-only candidate is still allowed", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await pendingPublicWeb(service, "http://10.0.0.5:8788/docs");

  const rejected = await service.reject(auditor, { id: "docs-writer" });
  assertEquals(rejected.governanceState, "rejected");
  assertEquals((await store.listApprovals()).length, 1);
});

Deno.test("an internal-only candidate can be repaired and then approved", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await pendingPublicWeb(service, "http://10.0.0.5:8788/docs");
  await service.reject(auditor, { id: "docs-writer" });

  await service.update(maintainer, {
    id: "docs-writer",
    entry: { kind: "url", value: "https://docs.example-agents.test/docs" },
  });
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
  const approved = await service.approve(auditor, { id: "docs-writer" });

  assertEquals(approved.governanceState, "approved_public");
  assertEquals((await service.list(anonymous)).length, 1);
});

Deno.test("a public hostname that merely looks numeric is not internal-only", async () => {
  const publicEntries = [
    "https://docs.example.com/agent",
    "https://10.1.2.3.docs.example.com/agent",
    "https://172.16.0.0.docs.example.com/agent",
    "https://agent.example.com./agent",
    "https://[2001:db8::1]/agent",
  ];
  for (const url of publicEntries) {
    const service = new CatalogService(new MemoryCatalogStore());
    await pendingPublicWeb(service, url);
    const approved = await service.approve(auditor, { id: "docs-writer" });
    assertEquals(
      approved.governanceState,
      "approved_public",
      `'${url}' must be approvable`,
    );
  }
});
