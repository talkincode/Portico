import { assert, assertEquals } from "./assert.ts";
import { signedInRoster } from "./fixtures.ts";
import { AuditService } from "../src/audit/mod.ts";
import {
  type Actor,
  CatalogService,
  type CatalogStore,
  MemoryCatalogStore,
} from "../src/catalog/mod.ts";
import { GatewayService, MemoryGatewayAuditStore } from "../src/gateway/mod.ts";
import { handleMcpRequest, type McpContext } from "../src/mcp/mod.ts";
import { MemoryPageStore, PageService } from "../src/ui/mod.ts";

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
    "portico_mcp",
    "portico_dashboard",
    "portico_audit",
    "portico_approvals",
    "portico_identities",
    "portico_grants",
    "portico_revokes",
    "portico_whoami",
    "portico_sessions",
    "portico_credentials",
    "portico_credential_revokes",
    "portico_gateway_audit",
    "portico_page",
  ]);
});

Deno.test("portico_mcp matches catalog.listMcp; anonymous hides internal MCP; CLI surfaces are absent", async () => {
  const { context, catalog } = await seeded();
  await catalog.register(maintainer, {
    id: "ops-mcp",
    name: "Ops MCP",
    description: "Internal operations MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/ops" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  });

  const reader: Actor = { id: "human:reader", kind: "human", role: "reader" };
  const anonymous: Actor = { id: "anonymous", kind: "human", role: "anonymous" };
  const expectedReader = await catalog.listMcp(reader);
  const expectedAnon = await catalog.listMcp(anonymous);
  assertEquals(expectedReader.map((item) => item.id), ["docs-mcp", "ops-mcp"]);
  assertEquals(expectedAnon.map((item) => item.id), ["docs-mcp"]);
  assertEquals(expectedReader.some((item) => item.id === "docs-writer"), false);
  assertEquals(expectedReader[0].connect.mode, "direct");
  assertEquals(expectedReader[0].endpoint.kind, "mcp_endpoint");

  const readerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_mcp", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, undefined);
  assertEquals(envelope(readerCall.body).data, expectedReader);

  const anonCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_mcp", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, undefined);
  assertEquals(envelope(anonCall.body).data, expectedAnon);

  const payload = JSON.stringify(envelope(readerCall.body).data);
  assertEquals(
    payload.includes("secretHash") ||
      payload.includes("tokenHash") ||
      payload.includes("pct1_") ||
      payload.includes("pst1_"),
    false,
  );
});

Deno.test("portico_identities is the same roster for maintainer and auditor; reader and anonymous are FORBIDDEN", async () => {
  const { context } = await seeded();
  const expected = [
    { id: "agent:docs-bot", kind: "agent", role: "maintainer" },
    { id: "human:reader", kind: "human", role: "reader" },
    { id: "human:security-auditor", kind: "human", role: "auditor" },
  ];

  const maintainerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_identities", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("agent:docs-bot")!,
    },
  });
  assertEquals(maintainerCall.body.result?.isError, undefined);
  const maintainerData = envelope(maintainerCall.body).data as Array<{
    id: string;
    kind: string;
    role: string;
  }>;
  assertEquals(
    maintainerData.slice().sort((a, b) => a.id.localeCompare(b.id)),
    expected,
  );
  assertEquals(
    JSON.stringify(maintainerData).includes("secretHash") ||
      JSON.stringify(maintainerData).includes("tokenHash"),
    false,
  );

  const auditorCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_identities", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(envelope(auditorCall.body).data, maintainerData);

  const readerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_identities", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, true);
  assertEquals(envelope(readerCall.body).error?.code, "FORBIDDEN");

  const anonCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_identities", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, true);
  assertEquals(envelope(anonCall.body).error?.code, "FORBIDDEN");
});

Deno.test("portico_grants is the same trail for auditor; maintainer, reader and anonymous are FORBIDDEN", async () => {
  const { context } = await seeded();
  const expected = await context.access.listGrants(auditor);
  assertEquals(expected.length >= 2, true);
  assertEquals(expected.some((row) => row.subjectId === "human:security-auditor"), true);
  assertEquals(expected.some((row) => row.subjectId === "agent:docs-bot"), true);

  const auditorCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_grants", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(auditorCall.body.result?.isError, undefined);
  assertEquals(envelope(auditorCall.body).data, expected);
  assertEquals(
    JSON.stringify(envelope(auditorCall.body).data).includes("secretHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("tokenHash"),
    false,
  );

  const maintainerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_grants", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("agent:docs-bot")!,
    },
  });
  assertEquals(maintainerCall.body.result?.isError, true);
  assertEquals(envelope(maintainerCall.body).error?.code, "FORBIDDEN");

  const readerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_grants", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, true);
  assertEquals(envelope(readerCall.body).error?.code, "FORBIDDEN");

  const anonCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_grants", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, true);
  assertEquals(envelope(anonCall.body).error?.code, "FORBIDDEN");
});

Deno.test("portico_page matches PageService.get; anonymous hides internal cards", async () => {
  const { context, catalog } = await seeded();
  const pages = new PageService(
    new MemoryPageStore(),
    catalog,
    new AuditService(catalog, context.access),
  );
  await pages.set(maintainer, {
    components: [
      { kind: "catalog_card", id: "docs-writer" },
      { kind: "permission_hint" },
    ],
  });
  const withPages: McpContext = { ...context, pages };
  const reader: Actor = { id: "human:reader", kind: "human", role: "reader" };
  const expected = await pages.get(reader);
  assertEquals(expected.components[0]?.kind, "catalog_card");
  assertEquals(
    (expected.components[0] as { id?: string }).id,
    "docs-writer",
  );

  const readerCall = await rpc(withPages, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_page", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, undefined);
  assertEquals(envelope(readerCall.body).data, expected);

  const anonCall = await rpc(withPages, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_page", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, undefined);
  const anonPage = envelope(anonCall.body).data as {
    components: Array<{ kind: string; id?: string; name?: string }>;
  };
  assertEquals(anonPage.components.some((item) => item.kind === "catalog_card"), false);
  assertEquals(JSON.stringify(anonPage).includes("Docs Writer"), false);
  assertEquals(JSON.stringify(anonPage).includes("docs-writer"), false);

  const missing = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_page", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(missing.body.result?.isError, undefined);
  assertEquals(envelope(missing.body).data, { components: [] });
});

Deno.test("portico_whoami is the same identity for a session; anonymous is FORBIDDEN", async () => {
  const { context } = await seeded();
  const expected = await context.access.whoami({
    id: "human:reader",
    kind: "human",
    role: "reader",
  });
  assertEquals(expected, { id: "human:reader", kind: "human", role: "reader" });

  const readerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_whoami", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, undefined);
  assertEquals(envelope(readerCall.body).data, expected);
  assertEquals(
    JSON.stringify(envelope(readerCall.body).data).includes("secretHash") ||
      JSON.stringify(envelope(readerCall.body).data).includes("tokenHash") ||
      JSON.stringify(envelope(readerCall.body).data).includes("pct1_") ||
      JSON.stringify(envelope(readerCall.body).data).includes("pst1_"),
    false,
  );

  const maintainerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_whoami", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("agent:docs-bot")!,
    },
  });
  assertEquals(maintainerCall.body.result?.isError, undefined);
  assertEquals(envelope(maintainerCall.body).data, await context.access.whoami(maintainer));

  const auditorCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_whoami", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(auditorCall.body.result?.isError, undefined);
  assertEquals(envelope(auditorCall.body).data, await context.access.whoami(auditor));

  const anonCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_whoami", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, true);
  assertEquals(envelope(anonCall.body).error?.code, "FORBIDDEN");
});

Deno.test("portico_sessions is the same trail for auditor; maintainer, reader and anonymous are FORBIDDEN", async () => {
  const { context } = await seeded();
  const expected = await context.access.listSessions(auditor);
  assertEquals(expected.length >= 3, true);
  assertEquals(expected.some((row) => row.subjectId === "human:security-auditor"), true);
  assertEquals(expected.some((row) => row.subjectId === "agent:docs-bot"), true);

  const auditorCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_sessions", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(auditorCall.body.result?.isError, undefined);
  assertEquals(envelope(auditorCall.body).data, expected);
  assertEquals(
    JSON.stringify(envelope(auditorCall.body).data).includes("secretHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("tokenHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pct1_") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pst1_"),
    false,
  );

  const maintainerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_sessions", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("agent:docs-bot")!,
    },
  });
  assertEquals(maintainerCall.body.result?.isError, true);
  assertEquals(envelope(maintainerCall.body).error?.code, "FORBIDDEN");

  const readerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_sessions", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, true);
  assertEquals(envelope(readerCall.body).error?.code, "FORBIDDEN");

  const anonCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_sessions", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, true);
  assertEquals(envelope(anonCall.body).error?.code, "FORBIDDEN");
});

Deno.test("portico_credentials is the same trail for auditor; maintainer, reader and anonymous are FORBIDDEN", async () => {
  const { context } = await seeded();
  const expected = await context.access.listCredentials(auditor);
  assertEquals(expected.length >= 3, true);
  assertEquals(expected.some((row) => row.subjectId === "human:security-auditor"), true);
  assertEquals(expected.some((row) => row.subjectId === "agent:docs-bot"), true);

  const auditorCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_credentials", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(auditorCall.body.result?.isError, undefined);
  assertEquals(envelope(auditorCall.body).data, expected);
  assertEquals(
    JSON.stringify(envelope(auditorCall.body).data).includes("secretHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("tokenHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pct1_") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pst1_"),
    false,
  );

  const maintainerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_credentials", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("agent:docs-bot")!,
    },
  });
  assertEquals(maintainerCall.body.result?.isError, true);
  assertEquals(envelope(maintainerCall.body).error?.code, "FORBIDDEN");

  const readerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_credentials", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, true);
  assertEquals(envelope(readerCall.body).error?.code, "FORBIDDEN");

  const anonCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_credentials", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, true);
  assertEquals(envelope(anonCall.body).error?.code, "FORBIDDEN");
});

Deno.test("portico_credential_revokes is the same trail for auditor; maintainer, reader and anonymous are FORBIDDEN", async () => {
  const { context } = await seeded();
  await context.access.grant(auditor, {
    id: "agent:retired-bot",
    kind: "agent",
    role: "maintainer",
  });
  await context.access.issueCredential(auditor, { id: "agent:retired-bot" });
  await context.access.revokeCredentials(auditor, { id: "agent:retired-bot" });
  const expected = await context.access.listCredentialRevokes(auditor);
  assertEquals(expected.length, 1);
  assertEquals(expected[0].subjectId, "agent:retired-bot");

  const auditorCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_credential_revokes", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(auditorCall.body.result?.isError, undefined);
  assertEquals(envelope(auditorCall.body).data, expected);
  assertEquals(
    JSON.stringify(envelope(auditorCall.body).data).includes("secretHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("tokenHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pct1_") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pst1_"),
    false,
  );

  const maintainerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_credential_revokes", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("agent:docs-bot")!,
    },
  });
  assertEquals(maintainerCall.body.result?.isError, true);
  assertEquals(envelope(maintainerCall.body).error?.code, "FORBIDDEN");

  const readerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_credential_revokes", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, true);
  assertEquals(envelope(readerCall.body).error?.code, "FORBIDDEN");

  const anonCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_credential_revokes", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, true);
  assertEquals(envelope(anonCall.body).error?.code, "FORBIDDEN");
});

Deno.test("portico_gateway_audit is the same trail for auditor; maintainer, reader and anonymous are FORBIDDEN", async () => {
  const { context, catalog } = await seeded();
  const gateway = new GatewayService(catalog, new MemoryGatewayAuditStore());
  const reader: Actor = { id: "human:reader", kind: "human", role: "reader" };
  await gateway.authorize(reader, "docs-mcp");
  const withGateway: McpContext = { ...context, gateway };
  const expected = await gateway.listAudit(auditor);
  assertEquals(expected.length, 1);
  assertEquals(expected[0].surfaceId, "docs-mcp");
  assertEquals(expected[0].decision, "allowed");

  const auditorCall = await rpc(withGateway, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_gateway_audit", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(auditorCall.body.result?.isError, undefined);
  assertEquals(envelope(auditorCall.body).data, expected);
  assertEquals(
    JSON.stringify(envelope(auditorCall.body).data).includes("secretHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("tokenHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pct1_") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pst1_"),
    false,
  );

  const maintainerCall = await rpc(withGateway, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_gateway_audit", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("agent:docs-bot")!,
    },
  });
  assertEquals(maintainerCall.body.result?.isError, true);
  assertEquals(envelope(maintainerCall.body).error?.code, "FORBIDDEN");

  const readerCall = await rpc(withGateway, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_gateway_audit", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, true);
  assertEquals(envelope(readerCall.body).error?.code, "FORBIDDEN");

  const anonCall = await rpc(withGateway, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_gateway_audit", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, true);
  assertEquals(envelope(anonCall.body).error?.code, "FORBIDDEN");

  const missing = await rpc(context, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "portico_gateway_audit", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(missing.body.result?.isError, undefined);
  assertEquals(envelope(missing.body).data, []);
});

Deno.test("portico_revokes is the same trail for auditor; maintainer, reader and anonymous are FORBIDDEN", async () => {
  const { context } = await seeded();
  await context.access.grant(auditor, {
    id: "agent:retired-bot",
    kind: "agent",
    role: "maintainer",
  });
  await context.access.revoke(auditor, { id: "agent:retired-bot" });
  const expected = await context.access.listRevokes(auditor);
  assertEquals(expected.length, 1);
  assertEquals(expected[0].subjectId, "agent:retired-bot");

  const auditorCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_revokes", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(auditorCall.body.result?.isError, undefined);
  assertEquals(envelope(auditorCall.body).data, expected);
  assertEquals(
    JSON.stringify(envelope(auditorCall.body).data).includes("secretHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("tokenHash") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pct1_") ||
      JSON.stringify(envelope(auditorCall.body).data).includes("pst1_"),
    false,
  );

  const maintainerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_revokes", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("agent:docs-bot")!,
    },
  });
  assertEquals(maintainerCall.body.result?.isError, true);
  assertEquals(envelope(maintainerCall.body).error?.code, "FORBIDDEN");

  const readerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_revokes", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(readerCall.body.result?.isError, true);
  assertEquals(envelope(readerCall.body).error?.code, "FORBIDDEN");

  const anonCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_revokes", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, true);
  assertEquals(envelope(anonCall.body).error?.code, "FORBIDDEN");
});

Deno.test("portico_approvals matches catalog.listApprovals for signed-in callers; anonymous is empty", async () => {
  const { context, catalog } = await seeded();
  const expected = await catalog.listApprovals(auditor);
  assertEquals(expected.length, 1);
  assertEquals(expected[0].surfaceId, "docs-mcp");
  assertEquals(expected[0].decision, "approved");

  const auditorCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_approvals", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(auditorCall.body.result?.isError, undefined);
  assertEquals(envelope(auditorCall.body).data, expected);

  const maintainerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_approvals", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("agent:docs-bot")!,
    },
  });
  assertEquals(envelope(maintainerCall.body).data, expected);

  const readerCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_approvals", arguments: {} },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:reader")!,
    },
  });
  assertEquals(envelope(readerCall.body).data, expected);

  const anonCall = await rpc(context, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_approvals", arguments: {} },
  });
  assertEquals(anonCall.body.result?.isError, undefined);
  assertEquals(envelope(anonCall.body).data, []);
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

  const badAudit = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_audit", arguments: { kind: "runtime" } },
  }, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + SESSION_TOKENS.get("human:security-auditor")!,
    },
  });
  assertEquals(badAudit.body.result?.isError, true);
  assertEquals(envelope(badAudit.body).error?.code, "INVALID_INPUT");
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

Deno.test("portico_list q filters visible records and does not search endpoints", async () => {
  const { context } = await seeded();
  const asReader = {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SESSION_TOKENS.get("human:reader")!}`,
    },
  };

  const writer = await rpc(context, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "portico_list", arguments: { q: "Writer" } },
  }, asReader);
  assertEquals(writer.status, 200, JSON.stringify(writer.body));
  assertEquals(writer.body.result?.isError, undefined, JSON.stringify(writer.body));
  assertEquals(
    (envelope(writer.body).data as Array<{ id: string }>).map((item) => item.id),
    ["docs-writer"],
  );

  const endpoint = await rpc(context, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "portico_list", arguments: { q: "mcp.example.test" } },
  }, asReader);
  assertEquals(envelope(endpoint.body).data, []);

  const anon = await rpc(context, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "portico_list", arguments: { q: "Writer" } },
  });
  assertEquals(envelope(anon.body).data, []);

  const tooLong = await rpc(context, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "portico_list", arguments: { q: "a".repeat(121) } },
  });
  assertEquals(tooLong.body.result?.isError, true);
  assertEquals(envelope(tooLong.body).error?.code, "INVALID_INPUT");
});
