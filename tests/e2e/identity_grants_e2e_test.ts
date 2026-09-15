import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Authorization-grant history is one contract: CLI `identity grants`, Portal
 * `GET /api/grants` and MCP `portico_grants` must return the same append-only
 * rows in the same order for the same auditor session. Maintainers, readers
 * and anonymous stay FORBIDDEN. Reading must not rewrite the roster or leak
 * secrets. This is not a grant write path.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface GrantRow {
  id: string;
  subjectId: string;
  kind: string;
  role: string;
  grantedBy: { id: string; kind: string };
  grantedAt: string;
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

async function mcpGrants(
  url: string,
  session: string | null,
): Promise<Envelope<GrantRow[]>> {
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
      params: { name: "portico_grants", arguments: {} },
    }),
  });
  return envelope<GrantRow[]>(await response.json() as JsonRpcBody);
}

async function portalGrants(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<GrantRow[]> }> {
  const response = await fetch(`${url}/api/grants`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<GrantRow[]>,
  };
}

async function cliGrants(
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<GrantRow[]> }> {
  const result = await runCli([
    "identity",
    "grants",
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<GrantRow[]>,
  };
}

function subjectsOf(rows: GrantRow[] | undefined): string[] {
  return (rows ?? []).map((item) => item.subjectId);
}

Deno.test("E2E: CLI, Portal and MCP grant trails match for auditor; others are refused", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-grants-e2e-" });
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

    const cliAuditor = await cliGrants(identities, auditorAuth);
    const portalAuditor = await portalGrants(portalUrl, auditorSession);
    const mcpAuditor = await mcpGrants(mcpUrl, auditorSession);

    assertEquals(cliAuditor.code, 0, JSON.stringify(cliAuditor.body));
    assertEquals(portalAuditor.status, 200);
    assertEquals(mcpAuditor.ok, true, JSON.stringify(mcpAuditor));
    assertEquals(cliAuditor.body.ok, true);
    assertEquals(portalAuditor.body.data, cliAuditor.body.data);
    assertEquals(mcpAuditor.data, cliAuditor.body.data);
    assertEquals(subjectsOf(cliAuditor.body.data).sort(), [
      "agent:docs-bot",
      "human:auditor",
      "human:docs-owner",
      "human:reader",
      "human:security-auditor",
    ]);
    for (const row of cliAuditor.body.data ?? []) {
      assertEquals(
        Object.keys(row).sort(),
        ["grantedAt", "grantedBy", "id", "kind", "role", "subjectId"],
      );
      assertEquals(Object.keys(row.grantedBy).sort(), ["id", "kind"]);
    }
    assertEquals(
      JSON.stringify(cliAuditor.body.data).includes("secretHash") ||
        JSON.stringify(cliAuditor.body.data).includes("tokenHash") ||
        JSON.stringify(cliAuditor.body.data).includes("pct1_") ||
        JSON.stringify(cliAuditor.body.data).includes("pst1_"),
      false,
      "grant trail must not leak credential or session secrets",
    );

    const cliMaintainer = await cliGrants(identities, maintainerAuth);
    const portalMaintainer = await portalGrants(portalUrl, maintainerSession);
    const mcpMaintainer = await mcpGrants(mcpUrl, maintainerSession);
    assertEquals(cliMaintainer.code, 1);
    assertEquals(cliMaintainer.body.error?.code, "FORBIDDEN");
    assertEquals(portalMaintainer.status, 403);
    assertEquals(portalMaintainer.body.error?.code, "FORBIDDEN");
    assertEquals(mcpMaintainer.ok, false);
    assertEquals(mcpMaintainer.error?.code, "FORBIDDEN");

    const cliReader = await cliGrants(identities, readerAuth);
    const portalReader = await portalGrants(portalUrl, readerSession);
    const mcpReader = await mcpGrants(mcpUrl, readerSession);
    assertEquals(cliReader.code, 1);
    assertEquals(cliReader.body.error?.code, "FORBIDDEN");
    assertEquals(portalReader.status, 403);
    assertEquals(portalReader.body.error?.code, "FORBIDDEN");
    assertEquals(mcpReader.ok, false);
    assertEquals(mcpReader.error?.code, "FORBIDDEN");

    const cliAnon = await cliGrants(identities);
    const portalAnon = await portalGrants(portalUrl, null);
    const mcpAnon = await mcpGrants(mcpUrl, null);
    assertEquals(cliAnon.body.error?.code, "FORBIDDEN");
    assertEquals(portalAnon.body.error?.code, "FORBIDDEN");
    assertEquals(mcpAnon.error?.code, "FORBIDDEN");

    const posted = await fetch(`${portalUrl}/api/grants`, {
      method: "POST",
      headers: authHeaders(auditorSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<GrantRow[]>;
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(identities),
      beforeIdentities,
      "reading grants must not rewrite identities.json",
    );
    const afterCatalog = await Deno.readFile(catalog).catch(() => new Uint8Array());
    assertEquals(
      afterCatalog,
      beforeCatalog,
      "reading grants must not rewrite the catalog",
    );
    assert(cliAuditor.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
