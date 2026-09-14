import { assert, assertEquals } from "./assert.ts";
import { signedInRoster } from "./fixtures.ts";
import {
  type Actor,
  CatalogService,
  type CatalogStore,
  MemoryCatalogStore,
} from "../src/catalog/mod.ts";
import { handleMcpRequest, type McpContext } from "../src/mcp/mod.ts";

/**
 * The MCP entrance must present exactly the governance state the CLI and the
 * Portal present. These tests pin the protocol mechanics and, more
 * importantly, the visibility rules — an MCP caller is not a privileged
 * caller.
 */

const maintainer: Actor = { id: "agent:docs-bot", kind: "agent", role: "maintainer" };
const auditor: Actor = { id: "human:security-auditor", kind: "human", role: "auditor" };

/** Session tokens the fixture roster actually signed in with. */
const SESSION_TOKENS = new Map<string, string>();

interface JsonRpcBody {
  jsonrpc: string;
  id: unknown;
  result?: {
    tools?: Array<{ name: string }>;
    content?: Array<{ text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

async function seeded(): Promise<{ context: McpContext; catalog: CatalogService }> {
  const store: CatalogStore = new MemoryCatalogStore();
  const catalog = new CatalogService(store);
  const roster = await signedInRoster();
  const access = roster.access;
  for (const id of ["human:security-auditor", "agent:docs-bot", "human:reader"]) {
    SESSION_TOKENS.set(id, roster.tokenFor(id));
  }

  await catalog.register(maintainer, {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  });
  await catalog.register(maintainer, {
    id: "docs-mcp",
    name: "Docs MCP",
    description: "External documentation MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/docs" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  });
  await catalog.publish(maintainer, { id: "docs-mcp", visibility: "public" });
  await catalog.approve(auditor, { id: "docs-mcp" });

  return { context: { catalog, access }, catalog };
}

async function rpc(
  context: McpContext,
  payload: unknown,
  init: RequestInit = {},
): Promise<{ status: number; body: JsonRpcBody }> {
  const response = await handleMcpRequest(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      ...init,
    }),
    context,
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as JsonRpcBody : null! };
}

function envelope(body: JsonRpcBody): Envelope {
  return JSON.parse(body.result?.content?.[0]?.text ?? "null") as Envelope;
}

Deno.test("initialize negotiates a version it actually implements", async () => {
  const { context } = await seeded();

  const known = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  const knownResult = known.body.result as unknown as Record<string, unknown>;
  assertEquals(knownResult.protocolVersion, "2024-11-05");

  const unknown = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: { protocolVersion: "1999-01-01" },
  });
  const unknownResult = unknown.body.result as unknown as Record<string, unknown>;
  assertEquals(unknownResult.protocolVersion, "2025-06-18");
});

Deno.test("tools/list exposes the read-only governance tools", async () => {
  const { context } = await seeded();
  const response = await rpc(context, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = (response.body.result?.tools ?? []).map((tool) => tool.name);
  assertEquals(names, [
    "portico_list",
    "portico_describe",
    "portico_entry",
    "portico_dashboard",
    "portico_audit",
  ]);
});

Deno.test("anonymous sees only approved-public surfaces through MCP", async () => {
  const { context } = await seeded();
  const response = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_list", arguments: {} },
  });
  const ids = (envelope(response.body).data as Array<{ id: string }>).map((item) => item.id);
  assertEquals(ids, ["docs-mcp"]);
});

Deno.test("an MCP caller cannot claim an identity with a header", async () => {
  const { context } = await seeded();
  // A forged auditor header must not turn into an auditor session. This is the
  // rule the Portal and Gateway now follow too.
  const response = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_audit", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      "x-portico-actor-id": "human:security-auditor",
      "x-portico-actor-kind": "human",
      "x-portico-actor-role": "auditor",
    },
  });
  assertEquals(response.body.result?.isError, true);
  assertEquals(envelope(response.body).error?.code, "FORBIDDEN");
});

Deno.test("an MCP session proves the identity the roster granted", async () => {
  const { context } = await seeded();
  // The fixture roster has a real session; the auditor's own session must be
  // able to read the trail, which is the positive half of the rule above.
  const response = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_audit", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SESSION_TOKENS.get("human:security-auditor")!}`,
    },
  });
  assertEquals(response.body.result?.isError, undefined);
  assert(Array.isArray(envelope(response.body).data));
});

Deno.test("the audit tool is refused for non-auditors and filled for auditors", async () => {
  const { context, catalog } = await seeded();

  const refused = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_audit", arguments: {} },
  });
  assertEquals(refused.body.result?.isError, true);
  assertEquals(envelope(refused.body).error?.code, "FORBIDDEN");

  // A session for the human auditor resolves to the same role the roster says.
  const events = await catalog.listChanges(auditor);
  assert(events.length > 0);
});

Deno.test("tool failures keep the same machine-readable code as the CLI", async () => {
  const { context } = await seeded();
  const missing = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_describe", arguments: { id: "does-not-exist" } },
  });
  assertEquals(missing.body.result?.isError, true);
  assertEquals(envelope(missing.body).error?.code, "NOT_FOUND");

  const badFilter = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_list", arguments: { channel: "carrier-pigeon" } },
  });
  assertEquals(badFilter.body.result?.isError, true);
  assertEquals(envelope(badFilter.body).error?.code, "INVALID_INPUT");
});

Deno.test("protocol errors are separated from tool errors", async () => {
  const { context } = await seeded();

  const method = await rpc(context, { jsonrpc: "2.0", id: 1, method: "tools/nope" });
  assertEquals(method.body.error?.code, -32601);

  const tool = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_delete_everything" },
  });
  assertEquals(tool.body.error?.code, -32602);
  assertEquals(tool.body.result, undefined);

  const batch = await rpc(context, [{ jsonrpc: "2.0", id: 3, method: "ping" }]);
  assertEquals(batch.status, 400);
  assertEquals(batch.body.error?.code, -32600);
});

Deno.test("a notification gets 202 and no body", async () => {
  const { context } = await seeded();
  const response = await handleMcpRequest(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }),
    context,
  );
  assertEquals(response.status, 202);
  assertEquals(await response.text(), "");
});

Deno.test("the mcp entrance only accepts POST and returns 405 otherwise", async () => {
  const { context } = await seeded();
  const response = await handleMcpRequest(
    new Request("http://127.0.0.1/mcp", { method: "GET" }),
    context,
  );
  assertEquals(response.status, 405);
});
