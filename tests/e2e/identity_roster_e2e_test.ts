import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Identity roster listing is one contract: CLI `identity list`, Portal
 * `GET /api/identities` and MCP `portico_identities` must return the same
 * id/kind/role rows (plus optional human email) for the same session.
 * Readers and anonymous stay FORBIDDEN. Reading must not rewrite the roster
 * or leak secrets. Email is not a second proof of identity.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface IdentityRow {
  id: string;
  kind: string;
  role: string;
  email?: string;
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

async function mcpIdentities(
  url: string,
  session: string | null,
): Promise<Envelope<IdentityRow[]>> {
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
      params: { name: "portico_identities", arguments: {} },
    }),
  });
  return envelope<IdentityRow[]>(await response.json() as JsonRpcBody);
}

async function portalIdentities(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<IdentityRow[]> }> {
  const response = await fetch(`${url}/api/identities`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<IdentityRow[]>,
  };
}

async function cliIdentities(
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<IdentityRow[]> }> {
  const result = await runCli([
    "identity",
    "list",
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<IdentityRow[]>,
  };
}

function idsOf(rows: IdentityRow[] | undefined): string[] {
  return (rows ?? []).map((item) => item.id);
}

Deno.test("E2E: CLI, Portal and MCP identity list match for maintainer; reader and anonymous are refused", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-identities-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  await bootstrapRoster(identities, sessions);

  const maintainerSession = sessionFor("agent:docs-bot")!;
  const auditorSession = sessionFor("human:security-auditor")!;
  const readerSession = sessionFor("human:reader")!;
  const maintainerAuth = actor("maintainer", "agent:docs-bot");
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const readerAuth = actor("reader", "human:reader", "human");
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

    const cliMaintainer = await cliIdentities(identities, maintainerAuth);
    const portalMaintainer = await portalIdentities(portalUrl, maintainerSession);
    const mcpMaintainer = await mcpIdentities(mcpUrl, maintainerSession);

    assertEquals(cliMaintainer.code, 0, JSON.stringify(cliMaintainer.body));
    assertEquals(portalMaintainer.status, 200);
    assertEquals(mcpMaintainer.ok, true, JSON.stringify(mcpMaintainer));
    assertEquals(cliMaintainer.body.ok, true);
    assertEquals(portalMaintainer.body.data, cliMaintainer.body.data);
    assertEquals(mcpMaintainer.data, cliMaintainer.body.data);
    assertEquals(idsOf(cliMaintainer.body.data).sort(), [
      "agent:docs-bot",
      "human:auditor",
      "human:docs-owner",
      "human:reader",
      "human:security-auditor",
    ]);
    for (const row of cliMaintainer.body.data ?? []) {
      assertEquals(Object.keys(row).sort(), ["id", "kind", "role"]);
    }
    assertEquals(
      JSON.stringify(cliMaintainer.body.data).includes("secretHash") ||
        JSON.stringify(cliMaintainer.body.data).includes("tokenHash") ||
        JSON.stringify(cliMaintainer.body.data).includes("pct1_") ||
        JSON.stringify(cliMaintainer.body.data).includes("pst1_"),
      false,
      "roster listing must not leak credential or session secrets",
    );

    const cliAuditor = await cliIdentities(identities, auditorAuth);
    const portalAuditor = await portalIdentities(portalUrl, auditorSession);
    const mcpAuditor = await mcpIdentities(mcpUrl, auditorSession);
    assertEquals(cliAuditor.body.data, cliMaintainer.body.data);
    assertEquals(portalAuditor.body.data, cliMaintainer.body.data);
    assertEquals(mcpAuditor.data, cliMaintainer.body.data);

    const cliReader = await cliIdentities(identities, readerAuth);
    const portalReader = await portalIdentities(portalUrl, readerSession);
    const mcpReader = await mcpIdentities(mcpUrl, readerSession);
    assertEquals(cliReader.code, 1);
    assertEquals(cliReader.body.error?.code, "FORBIDDEN");
    assertEquals(portalReader.status, 403);
    assertEquals(portalReader.body.error?.code, "FORBIDDEN");
    assertEquals(mcpReader.ok, false);
    assertEquals(mcpReader.error?.code, "FORBIDDEN");

    const cliAnon = await cliIdentities(identities);
    const portalAnon = await portalIdentities(portalUrl, null);
    const mcpAnon = await mcpIdentities(mcpUrl, null);
    assertEquals(cliAnon.body.error?.code, "FORBIDDEN");
    assertEquals(portalAnon.body.error?.code, "FORBIDDEN");
    assertEquals(mcpAnon.error?.code, "FORBIDDEN");

    assertEquals(
      await Deno.readFile(identities),
      beforeIdentities,
      "reading the roster must not rewrite identities.json",
    );
    const afterCatalog = await Deno.readFile(catalog).catch(() => new Uint8Array());
    assertEquals(
      afterCatalog,
      beforeCatalog,
      "reading the roster must not rewrite the catalog",
    );
    assert(cliMaintainer.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});

Deno.test("E2E: optional human email is shared across CLI, Portal and MCP; agent email is refused", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-identities-email-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  await bootstrapRoster(identities, sessions);

  const granted = await runCli([
    "identity",
    "grant",
    "--identities",
    identities,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:mapped",
    "--kind",
    "human",
    "--role",
    "reader",
    "--email",
    "Mapped@example.invalid",
  ]);
  assertEquals(granted.code, 0, granted.raw || granted.stderr);
  const created = granted.stdout as { ok: boolean; data: IdentityRow };
  assertEquals(created.ok, true);
  assertEquals(created.data.email, "mapped@example.invalid");

  const beforeIdentities = await Deno.readFile(identities);
  const agentEmail = await runCli([
    "identity",
    "grant",
    "--identities",
    identities,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "agent:mail-bot",
    "--kind",
    "agent",
    "--role",
    "maintainer",
    "--email",
    "bot@example.invalid",
  ]);
  assertEquals(agentEmail.code, 1, agentEmail.raw || agentEmail.stderr);
  const agentBody = agentEmail.stdout as Envelope<IdentityRow>;
  assertEquals(agentBody.error?.code, "INVALID_INPUT");
  assertEquals(await Deno.readFile(identities), beforeIdentities);

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
    const maintainerAuth = actor("maintainer", "agent:docs-bot");
    const maintainerSession = sessionFor("agent:docs-bot")!;
    const cliListed = await cliIdentities(identities, maintainerAuth);
    const portalListed = await portalIdentities(portal.body.data.url, maintainerSession);
    const mcpListed = await mcpIdentities(mcp.body.data.url, maintainerSession);
    assertEquals(cliListed.code, 0, JSON.stringify(cliListed.body));
    assertEquals(portalListed.status, 200);
    assertEquals(cliListed.body.data, portalListed.body.data);
    assertEquals(cliListed.body.data, mcpListed.data);
    const mapped = (cliListed.body.data ?? []).find((row) => row.id === "human:mapped");
    assertEquals(mapped?.email, "mapped@example.invalid");
    assertEquals(mapped?.kind, "human");
    assertEquals(mapped?.role, "reader");
    const bot = (cliListed.body.data ?? []).find((row) => row.id === "agent:mail-bot");
    assertEquals(bot, undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
