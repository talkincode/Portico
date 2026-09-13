import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { GatewayService, MemoryGatewayAuditStore } from "../src/gateway/mod.ts";

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

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

const anonymous: Actor = {
  id: "anonymous",
  kind: "human",
  role: "anonymous",
};

const MCP_ENDPOINT = "https://mcp.example.test/servers/docs";

function internalMcp(): RegisterInput {
  return {
    id: "docs-mcp",
    name: "Docs MCP",
    description: "External documentation MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: MCP_ENDPOINT },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function internalCli(): RegisterInput {
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

Deno.test("authorized reader receives a direct MCP route and an append-only audit record", async () => {
  const catalogStore = new MemoryCatalogStore();
  const catalog = new CatalogService(catalogStore);
  const audit = new MemoryGatewayAuditStore();
  const gateway = new GatewayService(catalog, audit);

  await catalog.register(maintainer, internalMcp());
  const route = await gateway.authorize(reader, "docs-mcp");

  assertEquals(route.surfaceId, "docs-mcp");
  assertEquals(route.name, "Docs MCP");
  assertEquals(route.endpoint, { kind: "mcp_endpoint", value: MCP_ENDPOINT });
  assertEquals(route.connect, { mode: "direct" });
  assertEquals(route.actor, reader);
  assert(typeof route.id === "string" && route.id.startsWith("gwa-"));
  assert(typeof route.authorizedAt === "string" && route.authorizedAt.length > 0);

  const events = await audit.list();
  assertEquals(events.length, 1);
  assertEquals(events[0].id, route.id);
  assertEquals(events[0].decision, "allowed");
  assertEquals(events[0].surfaceId, "docs-mcp");
  assertEquals(events[0].endpoint, route.endpoint);
  assertEquals(events[0].actor, reader);

  const listed = await catalogStore.list();
  assertEquals(listed.length, 1);
  assertEquals(listed[0].governanceState, "internal");
});

Deno.test("anonymous authorize of an internal MCP is not found, leaks no endpoint, and writes denied audit", async () => {
  const catalogStore = new MemoryCatalogStore();
  const catalog = new CatalogService(catalogStore);
  const audit = new MemoryGatewayAuditStore();
  const gateway = new GatewayService(catalog, audit);

  await catalog.register(maintainer, internalMcp());
  const before = JSON.stringify(await catalogStore.list());

  const error = await assertRejectsCode(
    () => gateway.authorize(anonymous, "docs-mcp"),
    "NOT_FOUND",
  );
  assert(
    !error.message.includes(MCP_ENDPOINT),
    "denied authorize must not leak the MCP endpoint",
  );

  assertEquals(JSON.stringify(await catalogStore.list()), before);

  const events = await audit.list();
  assertEquals(events.length, 1);
  assertEquals(events[0].decision, "denied");
  assertEquals(events[0].surfaceId, "docs-mcp");
  assertEquals(events[0].actor, anonymous);
  assertEquals(events[0].endpoint, undefined);
});

Deno.test("CLI-only surfaces cannot be authorized through the gateway", async () => {
  const catalog = new CatalogService(new MemoryCatalogStore());
  const audit = new MemoryGatewayAuditStore();
  const gateway = new GatewayService(catalog, audit);
  await catalog.register(maintainer, internalCli());

  await assertRejectsCode(() => gateway.authorize(reader, "docs-writer"), "NOT_FOUND");
  const events = await audit.list();
  assertEquals(events.length, 1);
  assertEquals(events[0].decision, "denied");
  assertEquals(events[0].endpoint, undefined);
});

Deno.test("human auditor can list gateway audit; maintainer and reader cannot", async () => {
  const catalog = new CatalogService(new MemoryCatalogStore());
  const audit = new MemoryGatewayAuditStore();
  const gateway = new GatewayService(catalog, audit);
  await catalog.register(maintainer, internalMcp());
  await gateway.authorize(reader, "docs-mcp");

  const listed = await gateway.listAudit(auditor);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].decision, "allowed");
  assertEquals(listed[0].surfaceId, "docs-mcp");

  await assertRejectsCode(() => gateway.listAudit(maintainer), "FORBIDDEN");
  await assertRejectsCode(() => gateway.listAudit(reader), "FORBIDDEN");
  await assertRejectsCode(() => gateway.listAudit(anonymous), "FORBIDDEN");

  const after = await gateway.listAudit(auditor);
  assertEquals(after.length, 1);
  assertEquals(after[0].decision, "allowed");
});

Deno.test("file store denied authorize does not dirty the catalog file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-gateway-" });
  const catalogPath = `${dir}/catalog.json`;
  const auditPath = `${dir}/gateway-audit.json`;
  const { FileCatalogStore } = await import("../src/catalog/mod.ts");
  const { FileGatewayAuditStore } = await import("../src/gateway/mod.ts");

  const catalogStore = new FileCatalogStore(catalogPath);
  const catalog = new CatalogService(catalogStore);
  const gateway = new GatewayService(catalog, new FileGatewayAuditStore(auditPath));
  await catalog.register(maintainer, internalMcp());
  const before = await Deno.readTextFile(catalogPath);

  await assertRejectsCode(() => gateway.authorize(anonymous, "docs-mcp"), "NOT_FOUND");
  assertEquals(await Deno.readTextFile(catalogPath), before);

  const events = await gateway.listAudit(auditor);
  assertEquals(events.length, 1);
  assertEquals(events[0].decision, "denied");
  assertEquals(events[0].endpoint, undefined);
});
