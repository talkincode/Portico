import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  type AgentSurface,
  type ApprovalRecord,
  CatalogService,
  FileCatalogStore,
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

function cliSurface(): RegisterInput {
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

function mcpSurface(): RegisterInput {
  return {
    id: "docs-mcp",
    name: "Docs MCP",
    description: "External documentation MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/docs" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

/**
 * A direct write to the store — the adversary `docs/roadmap.md` names when it
 * makes "no entrance, a direct write to the store included, may turn an
 * unapproved object into something publicly reachable" an iron rule. Nothing
 * here goes through `publish`/`approve`, so no approval exists to point at.
 */
function forgedPublicRecord(input: RegisterInput, at = new Date().toISOString()): AgentSurface {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    channels: [...input.channels],
    version: input.version,
    visibility: "public",
    entry: { ...input.entry },
    maintainers: input.maintainers.map((item) => ({ ...item })),
    governanceState: "approved_public",
    publicSubmission: {
      submittedBy: { id: "agent:docs-bot", kind: "agent" },
      submittedAt: at,
    },
    createdAt: at,
    updatedAt: at,
  };
}

function trailRecord(
  surfaceId: string,
  decision: ApprovalRecord["decision"],
  reviewedAt: string,
): ApprovalRecord {
  return {
    id: `apr-${surfaceId}-${decision}-${reviewedAt}`,
    surfaceId,
    decision,
    submittedBy: { id: "agent:docs-bot", kind: "agent" },
    reviewedBy: { id: "human:security-auditor", kind: "human" },
    reviewedAt,
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    version: "1.0.0",
    name: "Docs Writer",
  };
}

Deno.test("a record hand-set to approved_public with no approval record is not publicly reachable", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await store.put(forgedPublicRecord(cliSurface()));

  assertEquals(await service.list(anonymous), []);
  await assertRejectsCode(() => service.get(anonymous, "docs-writer"), "NOT_FOUND");

  // Every channel projection is filtered by the same read path, so a forged
  // record cannot slip out through `cli list` while `catalog list` refuses it.
  assertEquals(await service.listCli(anonymous), []);
  assertEquals(await service.listMcp(anonymous), []);
  assertEquals(await service.listWeb(anonymous), []);
  await assertRejectsCode(() => service.describeCli(anonymous, "docs-writer"), "NOT_FOUND");
});

Deno.test("the forged record reads as internal for internal identities and no approval appears", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await store.put(forgedPublicRecord(cliSurface()));

  const listed = await service.list(reader);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].visibility, "internal");
  assertEquals(listed[0].governanceState, "internal");

  const got = await service.get(maintainer, "docs-writer");
  assertEquals(got.governanceState, "internal");
  assertEquals(got.visibility, "internal");

  // The fabrication is not laundered into the trail either: still no approval.
  assertEquals(await service.listApprovals(reader), []);
});

Deno.test("a genuine independent approval is what grants public reachability", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, cliSurface());
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });

  assertEquals(await service.list(anonymous), []);

  await service.approve(auditor, { id: "docs-writer" });
  const visible = await service.list(anonymous);
  assertEquals(visible.length, 1);
  assertEquals(visible[0].governanceState, "approved_public");
  assertEquals(visible[0].visibility, "public");
});

Deno.test("the latest public decision wins: a newer withdrawal revokes the grant", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, cliSurface());
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await service.approve(auditor, { id: "docs-writer" });
  assertEquals((await service.list(anonymous)).length, 1);

  // Stored bytes still claim approved_public, but the trail's newest decision
  // for this surface is a withdrawal, so nothing is publicly reachable.
  const record = await store.get("docs-writer");
  assert(record, "the approved record should exist");
  await store.commitApproval(
    record as AgentSurface,
    trailRecord("docs-writer", "withdrawn", "2099-01-01T00:00:00.000Z"),
  );

  assertEquals(await service.list(anonymous), []);
  await assertRejectsCode(() => service.get(anonymous, "docs-writer"), "NOT_FOUND");
});

Deno.test("an approval in the trail does not publish a record whose own fields are internal", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, cliSurface());
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await service.approve(auditor, { id: "docs-writer" });

  // Hand-editing the record back is the shrink direction and is honoured; the
  // approval alone is not enough to keep it reachable.
  const record = await store.get("docs-writer");
  assert(record, "the approved record should exist");
  await store.put({
    ...(record as AgentSurface),
    visibility: "internal",
    governanceState: "internal",
  });

  assertEquals(await service.list(anonymous), []);
  assertEquals((await service.list(reader)).length, 1);
});

Deno.test("a forged public record is repairable in band: update normalizes it, then approval grants it", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await store.put(forgedPublicRecord(cliSurface()));

  const updated = await service.update(maintainer, {
    id: "docs-writer",
    description: "Reviewed and corrected.",
  });
  assertEquals(updated.governanceState, "internal");
  assertEquals(updated.visibility, "internal");
  assertEquals(updated.publicSubmission, undefined);

  // The normalization is written, not only derived: the stored bytes match.
  const stored = await store.get("docs-writer");
  assertEquals(stored?.governanceState, "internal");
  assertEquals(stored?.visibility, "internal");
  assertEquals(stored?.publicSubmission, undefined);

  // Nothing about the public boundary is weakened by the repair: the id is not
  // poisoned, but it still needs a fresh submission and a fresh independent
  // approval.
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
  assertEquals(await service.list(anonymous), []);
  assertEquals((await service.list(reader))[0].governanceState, "pending_public");

  await service.approve(auditor, { id: "docs-writer" });
  assertEquals((await service.list(anonymous))[0].governanceState, "approved_public");
});

Deno.test("the grant is per surface: approving one candidate does not publish a forged neighbour", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, cliSurface());
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await service.approve(auditor, { id: "docs-writer" });

  await store.put(forgedPublicRecord(mcpSurface()));

  const visible = await service.list(anonymous);
  assertEquals(visible.map((record) => record.id), ["docs-writer"]);
  assertEquals(await service.listMcp(anonymous), []);
});

Deno.test("a forged public MCP surface is not routable through the registered endpoint", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await store.put(forgedPublicRecord(mcpSurface()));

  // Anonymous — the caller a public surface exists for — gets neither the
  // endpoint nor a routing decision.
  assertEquals(await service.listMcp(anonymous), []);
  await assertRejectsCode(() => service.describeMcp(anonymous, "docs-mcp"), "NOT_FOUND");

  // An internal identity still sees the registration; it is just not public.
  const listed = await service.listMcp(reader);
  assertEquals(listed[0].governanceState, "internal");
  assertEquals((await service.describeMcp(reader, "docs-mcp")).version, "1.0.0");
});

Deno.test("file store: a raw forgery on disk is refused, and reading it does not rewrite the file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-public-grant-" });
  const path = `${dir}/catalog.json`;
  try {
    const store = new FileCatalogStore(path);
    await store.put(forgedPublicRecord(cliSurface()));
    const forged = await Deno.readTextFile(path);
    assert(forged.includes("approved_public"), "the fixture should start publicly marked");

    const service = new CatalogService(store);
    assertEquals(await service.list(anonymous), []);
    assertEquals((await service.list(reader))[0].governanceState, "internal");

    // Reads are still reads: the forged bytes are left exactly as they are for
    // the operator to inspect, and the boundary is enforced on the way out.
    assertEquals(await Deno.readTextFile(path), forged);

    await service.update(maintainer, { id: "docs-writer", version: "1.0.1" });
    const repaired = await Deno.readTextFile(path);
    assert(!repaired.includes("approved_public"), "the governed write should normalize the record");
    assertEquals((await service.list(reader))[0].governanceState, "internal");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
