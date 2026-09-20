import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleMcpRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Authorized MCP connection info is one contract: CLI `mcp list`, Portal
 * `GET /api/mcp` and MCP `portico_mcp` must return the same rows in the same
 * order for the same identity. Anonymous callers only see approved public
 * MCP surfaces. CLI package coordinates never appear. Reading must not
 * rewrite the catalog or leak session tokens. Portico does not proxy or
 * execute the listed endpoints.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface McpRow {
  id: string;
  name: string;
  description: string;
  version: string;
  visibility: string;
  governanceState: string;
  endpoint: { kind: string; value: string };
  connect: { mode: string };
}

interface JsonRpcBody {
  result?: { content?: Array<{ text: string }>; isError?: boolean };
}

function envelope<T>(body: JsonRpcBody): Envelope<T> {
  return JSON.parse(body.result?.content?.[0]?.text ?? "null") as Envelope<T>;
}

function authHeaders(session: string | null): HeadersInit {
  return session ? { authorization: `Bearer ${session}` } : {};
}

async function mcpList(
  url: string,
  session: string | null,
): Promise<Envelope<McpRow[]>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(session),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "portico_mcp", arguments: {} },
    }),
  });
  return envelope<McpRow[]>(await response.json() as JsonRpcBody);
}

async function portalList(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<McpRow[]> }> {
  const response = await fetch(`${url}/api/mcp`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<McpRow[]>,
  };
}

async function cliList(
  catalog: string,
  extra: string[] = [],
  env: Record<string, string> = {},
): Promise<{ code: number; body: Envelope<McpRow[]> }> {
  const result = await runCli([
    "mcp",
    "list",
    "--catalog",
    catalog,
    ...extra,
  ], env);
  return {
    code: result.code,
    body: result.stdout as Envelope<McpRow[]>,
  };
}

function sampleCliRecord() {
  return {
    id: "docs-cli",
    name: "Docs CLI",
    description: "Package coordinate for the docs writer.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function samplePublicMcpRecord() {
  return {
    id: "public-docs-mcp",
    name: "Public Docs MCP",
    description: "Approved public documentation MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/public-docs" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

Deno.test("E2E: CLI, Portal and MCP mcp-list match; anonymous hides internal; CLI packages stay out", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-mcp-list-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const mcpInput = `${dir}/mcp.json`;
  const cliInput = `${dir}/cli.json`;
  const publicInput = `${dir}/public-mcp.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  const env = await bootstrapRoster(identities, sessions);
  await Deno.writeTextFile(mcpInput, `${JSON.stringify(sampleMcpRecord(), null, 2)}\n`);
  await Deno.writeTextFile(cliInput, `${JSON.stringify(sampleCliRecord(), null, 2)}\n`);
  await Deno.writeTextFile(publicInput, `${JSON.stringify(samplePublicMcpRecord(), null, 2)}\n`);

  const maintainerAuth = actor("maintainer", "agent:docs-bot");
  const readerAuth = actor("reader", "human:reader", "human");
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const readerSession = sessionFor("human:reader")!;
  const auditorSession = sessionFor("human:security-auditor")!;
  const maintainerSession = sessionFor("agent:docs-bot")!;

  const registeredMcp = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...maintainerAuth,
    "--input",
    mcpInput,
  ], env);
  assertEquals(registeredMcp.code, 0, JSON.stringify(registeredMcp.stdout));

  const registeredCli = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...maintainerAuth,
    "--input",
    cliInput,
  ], env);
  assertEquals(registeredCli.code, 0, JSON.stringify(registeredCli.stdout));

  const registeredPublic = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...maintainerAuth,
    "--input",
    publicInput,
  ], env);
  assertEquals(registeredPublic.code, 0, JSON.stringify(registeredPublic.stdout));

  const published = await runCli([
    "catalog",
    "publish",
    "--id",
    "public-docs-mcp",
    "--visibility",
    "public",
    "--catalog",
    catalog,
    ...maintainerAuth,
  ], env);
  assertEquals(published.code, 0, JSON.stringify(published.stdout));

  const approved = await runCli([
    "catalog",
    "approve",
    "--id",
    "public-docs-mcp",
    "--catalog",
    catalog,
    ...auditorAuth,
  ], env);
  assertEquals(approved.code, 0, JSON.stringify(approved.stdout));

  const beforeIdentities = await Deno.readFile(identities);
  const beforeSessions = await Deno.readFile(sessions);
  const beforeCatalog = await Deno.readFile(catalog);

  const portal = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
  }, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
  }, MCP_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;

    const cliReader = await cliList(catalog, readerAuth, env);
    const portalReader = await portalList(portalUrl, readerSession);
    const mcpReader = await mcpList(mcpUrl, readerSession);

    assertEquals(cliReader.code, 0, JSON.stringify(cliReader.body));
    assertEquals(portalReader.status, 200);
    assertEquals(mcpReader.ok, true, JSON.stringify(mcpReader));
    assertEquals(cliReader.body.ok, true);
    assertEquals(portalReader.body.data, cliReader.body.data);
    assertEquals(mcpReader.data, cliReader.body.data);
    assertEquals((cliReader.body.data ?? []).map((row) => row.id), [
      "docs-mcp",
      "public-docs-mcp",
    ]);
    assertEquals(
      (cliReader.body.data ?? []).some((row) => row.id === "docs-cli"),
      false,
    );
    for (const row of cliReader.body.data ?? []) {
      assertEquals(row.connect.mode, "direct");
      assertEquals(row.endpoint.kind, "mcp_endpoint");
      assertEquals(
        Object.keys(row).sort(),
        [
          "connect",
          "description",
          "endpoint",
          "governanceState",
          "id",
          "name",
          "version",
          "visibility",
        ],
      );
    }

    const payload = JSON.stringify(cliReader.body.data);
    assertEquals(
      payload.includes("secretHash") ||
        payload.includes("tokenHash") ||
        payload.includes("pct1_") ||
        payload.includes("pst1_"),
      false,
      "mcp list must not leak credential or session secrets",
    );
    assertEquals(payload.includes(readerSession), false);
    assertEquals(payload.includes(auditorSession), false);
    assertEquals(payload.includes(maintainerSession), false);

    const cliAnon = await cliList(catalog, [], env);
    const portalAnon = await portalList(portalUrl, null);
    const mcpAnon = await mcpList(mcpUrl, null);
    assertEquals(cliAnon.code, 0, JSON.stringify(cliAnon.body));
    assertEquals(portalAnon.status, 200);
    assertEquals(mcpAnon.ok, true, JSON.stringify(mcpAnon));
    assertEquals(portalAnon.body.data, cliAnon.body.data);
    assertEquals(mcpAnon.data, cliAnon.body.data);
    assertEquals((cliAnon.body.data ?? []).map((row) => row.id), ["public-docs-mcp"]);
    assertEquals((cliAnon.body.data ?? [])[0].governanceState, "approved_public");

    const posted = await fetch(`${portalUrl}/api/mcp`, {
      method: "POST",
      headers: authHeaders(readerSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<McpRow[]>;
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(identities),
      beforeIdentities,
      "reading mcp list must not rewrite identities.json",
    );
    assertEquals(
      await Deno.readFile(sessions),
      beforeSessions,
      "reading mcp list must not rewrite sessions.json",
    );
    assertEquals(
      await Deno.readFile(catalog),
      beforeCatalog,
      "reading mcp list must not rewrite the catalog",
    );
    assert(cliReader.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
