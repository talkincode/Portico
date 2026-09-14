import { assert, assertEquals } from "./assert.ts";
import { type RosterFixture, signedInRoster } from "./fixtures.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import {
  GatewayService,
  handleGatewayRequest,
  MemoryGatewayAuditStore,
} from "../src/gateway/mod.ts";

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

let roster: RosterFixture;

async function seededContext() {
  roster = await signedInRoster();
  const access = roster.access;
  const catalogStore = new MemoryCatalogStore();
  const catalog = new CatalogService(catalogStore);
  const gateway = new GatewayService(catalog, new MemoryGatewayAuditStore());
  return { catalog, catalogStore, access, gateway };
}

/** A real Bearer session: an identity is proven, never asserted. */
function actorHeaders(actor: Actor): HeadersInit {
  return roster.headersFor(actor.id);
}

async function jsonOf(response: Response): Promise<{
  status: number;
  body: { ok: boolean; data?: unknown; error?: { code: string; message: string } };
}> {
  const body = await response.json();
  return { status: response.status, body };
}

Deno.test("reader authorizes the same MCP endpoint over the gateway HTTP surface", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalMcp());

  const response = await handleGatewayRequest(
    new Request("http://portico.local/gateway/mcp/docs-mcp/authorize", {
      method: "POST",
      headers: actorHeaders(reader),
    }),
    context,
  );
  const { status, body } = await jsonOf(response);
  assertEquals(status, 200);
  assertEquals(body.ok, true);
  const route = body.data as {
    surfaceId: string;
    endpoint: { value: string };
    connect: { mode: string };
  };
  assertEquals(route.surfaceId, "docs-mcp");
  assertEquals(route.endpoint.value, MCP_ENDPOINT);
  assertEquals(route.connect.mode, "direct");
});

Deno.test("anonymous gateway authorize of internal MCP is not found and leaks no endpoint", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalMcp());

  const response = await handleGatewayRequest(
    new Request("http://portico.local/gateway/mcp/docs-mcp/authorize", { method: "POST" }),
    context,
  );
  const { status, body } = await jsonOf(response);
  assertEquals(status, 404);
  assertEquals(body.ok, false);
  assertEquals(body.error?.code, "NOT_FOUND");
  assert(
    !JSON.stringify(body).includes(MCP_ENDPOINT),
    "denied HTTP authorize must not leak the endpoint",
  );
});

Deno.test("auditor can read gateway audit; maintainer cannot", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalMcp());
  await handleGatewayRequest(
    new Request("http://portico.local/gateway/mcp/docs-mcp/authorize", {
      method: "POST",
      headers: actorHeaders(reader),
    }),
    context,
  );

  const allowed = await jsonOf(
    await handleGatewayRequest(
      new Request("http://portico.local/gateway/audit", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(allowed.status, 200);
  const events = allowed.body.data as Array<{ decision: string; surfaceId: string }>;
  assertEquals(events.length, 1);
  assertEquals(events[0].decision, "allowed");
  assertEquals(events[0].surfaceId, "docs-mcp");

  const forbidden = await jsonOf(
    await handleGatewayRequest(
      new Request("http://portico.local/gateway/audit", { headers: actorHeaders(maintainer) }),
      context,
    ),
  );
  assertEquals(forbidden.status, 403);
  assertEquals(forbidden.body.error?.code, "FORBIDDEN");
});

Deno.test("gateway refuses MCP tool calls and does not mutate the catalog", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalMcp());
  const before = JSON.stringify(await context.catalogStore.list());

  const response = await handleGatewayRequest(
    new Request("http://portico.local/gateway/mcp/docs-mcp", {
      method: "POST",
      headers: { ...actorHeaders(reader), "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search", arguments: { q: "docs" } },
      }),
    }),
    context,
  );
  const { status, body } = await jsonOf(response);
  assertEquals(status, 405);
  assertEquals(body.ok, false);
  assertEquals(body.error?.code, "USAGE");
  assert(
    body.error?.message.includes("does not execute"),
    "refusal must say the gateway does not execute tools",
  );
  assertEquals(JSON.stringify(await context.catalogStore.list()), before);
});
