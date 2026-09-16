import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleWebRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Authorized Web connection info is one contract: CLI `web list`, Portal
 * `GET /api/web` and MCP `portico_web` must return the same rows in the same
 * order for the same identity. Anonymous callers only see approved public
 * Web surfaces. MCP endpoints and CLI package coordinates never appear.
 * Reading must not rewrite the catalog or leak session tokens. Portico does
 * not proxy or render the listed hrefs.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface WebRow {
  id: string;
  name: string;
  description: string;
  version: string;
  visibility: string;
  governanceState: string;
  href: { kind: string; value: string };
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
): Promise<Envelope<WebRow[]>> {
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
      params: { name: "portico_web", arguments: {} },
    }),
  });
  return envelope<WebRow[]>(await response.json() as JsonRpcBody);
}

async function portalList(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<WebRow[]> }> {
  const response = await fetch(`${url}/api/web`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<WebRow[]>,
  };
}

async function cliList(
  catalog: string,
  extra: string[] = [],
  env: Record<string, string> = {},
): Promise<{ code: number; body: Envelope<WebRow[]> }> {
  const result = await runCli([
    "web",
    "list",
    "--catalog",
    catalog,
    ...extra,
  ], env);
  return {
    code: result.code,
    body: result.stdout as Envelope<WebRow[]>,
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

function sampleMcpRecord() {
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

function samplePublicWebRecord() {
  return {
    id: "public-docs-web",
    name: "Public Docs Web",
    description: "Approved public documentation portal.",
    channels: ["web"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "url", value: "https://docs.example.test/portals/public-docs" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

Deno.test("E2E: CLI, Portal and MCP web-list match; anonymous hides internal; MCP and CLI stay out", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-web-list-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const webInput = `${dir}/web.json`;
  const cliInput = `${dir}/cli.json`;
  const mcpInput = `${dir}/mcp.json`;
  const publicInput = `${dir}/public-web.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  const env = await bootstrapRoster(identities, sessions);
  await Deno.writeTextFile(webInput, `${JSON.stringify(sampleWebRecord(), null, 2)}\n`);
  await Deno.writeTextFile(cliInput, `${JSON.stringify(sampleCliRecord(), null, 2)}\n`);
  await Deno.writeTextFile(mcpInput, `${JSON.stringify(sampleMcpRecord(), null, 2)}\n`);
  await Deno.writeTextFile(publicInput, `${JSON.stringify(samplePublicWebRecord(), null, 2)}\n`);

  const maintainerAuth = actor("maintainer", "agent:docs-bot");
  const readerAuth = actor("reader", "human:reader", "human");
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const readerSession = sessionFor("human:reader")!;
  const auditorSession = sessionFor("human:security-auditor")!;
  const maintainerSession = sessionFor("agent:docs-bot")!;

  const registeredWeb = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...maintainerAuth,
    "--input",
    webInput,
  ], env);
  assertEquals(registeredWeb.code, 0, JSON.stringify(registeredWeb.stdout));

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
    "public-docs-web",
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
    "public-docs-web",
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
      "docs-web",
      "public-docs-web",
    ]);
    assertEquals(
      (cliReader.body.data ?? []).some((row) => row.id === "docs-cli"),
      false,
    );
    assertEquals(
      (cliReader.body.data ?? []).some((row) => row.id === "docs-mcp"),
      false,
    );
    for (const row of cliReader.body.data ?? []) {
      assertEquals(row.connect.mode, "direct");
      assertEquals(row.href.kind, "url");
      assertEquals(
        Object.keys(row).sort(),
        [
          "connect",
          "description",
          "governanceState",
          "href",
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
      "web list must not leak credential or session secrets",
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
    assertEquals((cliAnon.body.data ?? []).map((row) => row.id), ["public-docs-web"]);
    assertEquals((cliAnon.body.data ?? [])[0].governanceState, "approved_public");

    const posted = await fetch(`${portalUrl}/api/web`, {
      method: "POST",
      headers: authHeaders(readerSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<WebRow[]>;
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(identities),
      beforeIdentities,
      "reading web list must not rewrite identities.json",
    );
    assertEquals(
      await Deno.readFile(sessions),
      beforeSessions,
      "reading web list must not rewrite sessions.json",
    );
    assertEquals(
      await Deno.readFile(catalog),
      beforeCatalog,
      "reading web list must not rewrite the catalog",
    );
    assert(cliReader.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
