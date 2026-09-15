import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Current-session identity is one contract: CLI `identity whoami`, Portal
 * `GET /api/whoami` and MCP `portico_whoami` must return the same
 * `{id,kind,role}` for the same session. Anonymous stays FORBIDDEN on Portal
 * and MCP. Reading must not rewrite the roster or leak secrets. This is not a
 * login or grant write path.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface Whoami {
  id: string;
  kind: string;
  role: string;
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

async function mcpWhoami(
  url: string,
  session: string | null,
): Promise<Envelope<Whoami>> {
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
      params: { name: "portico_whoami", arguments: {} },
    }),
  });
  return envelope<Whoami>(await response.json() as JsonRpcBody);
}

async function portalWhoami(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<Whoami> }> {
  const response = await fetch(`${url}/api/whoami`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<Whoami>,
  };
}

async function cliWhoami(
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<Whoami> }> {
  const result = await runCli([
    "identity",
    "whoami",
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<Whoami>,
  };
}

Deno.test("E2E: CLI, Portal and MCP whoami match for a session; anonymous is refused", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-whoami-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  await bootstrapRoster(identities, sessions);

  const readerSession = sessionFor("human:reader")!;
  const maintainerSession = sessionFor("agent:docs-bot")!;
  const auditorSession = sessionFor("human:security-auditor")!;
  const readerAuth = actor("reader", "human:reader", "human");
  const maintainerAuth = actor("maintainer", "agent:docs-bot");
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const beforeIdentities = await Deno.readFile(identities);
  const beforeCatalog = await Deno.readFile(catalog).catch(() => new Uint8Array());

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

    const cliReader = await cliWhoami(identities, readerAuth);
    const portalReader = await portalWhoami(portalUrl, readerSession);
    const mcpReader = await mcpWhoami(mcpUrl, readerSession);

    assertEquals(cliReader.code, 0, JSON.stringify(cliReader.body));
    assertEquals(portalReader.status, 200);
    assertEquals(mcpReader.ok, true, JSON.stringify(mcpReader));
    assertEquals(cliReader.body.ok, true);
    assertEquals(cliReader.body.data, { id: "human:reader", kind: "human", role: "reader" });
    assertEquals(portalReader.body.data, cliReader.body.data);
    assertEquals(mcpReader.data, cliReader.body.data);
    assertEquals(Object.keys(cliReader.body.data ?? {}).sort(), ["id", "kind", "role"]);
    assertEquals(
      JSON.stringify(cliReader.body.data).includes("secretHash") ||
        JSON.stringify(cliReader.body.data).includes("tokenHash") ||
        JSON.stringify(cliReader.body.data).includes("pct1_") ||
        JSON.stringify(cliReader.body.data).includes("pst1_"),
      false,
      "whoami must not leak credential or session secrets",
    );

    const cliMaintainer = await cliWhoami(identities, maintainerAuth);
    const portalMaintainer = await portalWhoami(portalUrl, maintainerSession);
    const mcpMaintainer = await mcpWhoami(mcpUrl, maintainerSession);
    assertEquals(cliMaintainer.code, 0);
    assertEquals(cliMaintainer.body.data, {
      id: "agent:docs-bot",
      kind: "agent",
      role: "maintainer",
    });
    assertEquals(portalMaintainer.body.data, cliMaintainer.body.data);
    assertEquals(mcpMaintainer.data, cliMaintainer.body.data);

    const cliAuditor = await cliWhoami(identities, auditorAuth);
    const portalAuditor = await portalWhoami(portalUrl, auditorSession);
    const mcpAuditor = await mcpWhoami(mcpUrl, auditorSession);
    assertEquals(cliAuditor.code, 0);
    assertEquals(cliAuditor.body.data, {
      id: "human:security-auditor",
      kind: "human",
      role: "auditor",
    });
    assertEquals(portalAuditor.body.data, cliAuditor.body.data);
    assertEquals(mcpAuditor.data, cliAuditor.body.data);

    const cliAnon = await cliWhoami(identities);
    const portalAnon = await portalWhoami(portalUrl, null);
    const mcpAnon = await mcpWhoami(mcpUrl, null);
    assertEquals(cliAnon.body.error?.code, "USAGE");
    assertEquals(portalAnon.status, 403);
    assertEquals(portalAnon.body.error?.code, "FORBIDDEN");
    assertEquals(mcpAnon.ok, false);
    assertEquals(mcpAnon.error?.code, "FORBIDDEN");

    const posted = await fetch(`${portalUrl}/api/whoami`, {
      method: "POST",
      headers: authHeaders(readerSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<Whoami>;
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(identities),
      beforeIdentities,
      "reading whoami must not rewrite identities.json",
    );
    const afterCatalog = await Deno.readFile(catalog).catch(() => new Uint8Array());
    assertEquals(
      afterCatalog,
      beforeCatalog,
      "reading whoami must not rewrite the catalog",
    );
    assert(cliReader.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
