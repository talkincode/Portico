import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Login-credential history is one contract: CLI `identity credentials`, Portal
 * `GET /api/credentials` and MCP `portico_credentials` must return the same
 * auditor-facing rows in the same order for the same auditor session.
 * Maintainers, readers and anonymous stay FORBIDDEN. Reading must not
 * rewrite the session file or leak tokens or hashes. This is not an issue
 * or revoke path.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface CredentialRow {
  id: string;
  subjectId: string;
  credentialRef: string;
  issuedBy: { id: string; kind: string };
  issuedAt: string;
  revokedAt?: string;
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

async function mcpCredentials(
  url: string,
  session: string | null,
): Promise<Envelope<CredentialRow[]>> {
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
      params: { name: "portico_credentials", arguments: {} },
    }),
  });
  return envelope<CredentialRow[]>(await response.json() as JsonRpcBody);
}

async function portalCredentials(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<CredentialRow[]> }> {
  const response = await fetch(`${url}/api/credentials`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<CredentialRow[]>,
  };
}

async function cliCredentials(
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<CredentialRow[]> }> {
  const result = await runCli([
    "identity",
    "credentials",
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<CredentialRow[]>,
  };
}

function subjectsOf(rows: CredentialRow[] | undefined): string[] {
  return (rows ?? []).map((item) => item.subjectId);
}

Deno.test("E2E: CLI, Portal and MCP credential trails match for auditor; others are refused", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-credentials-e2e-" });
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
  const beforeSessions = await Deno.readFile(sessions);
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

    const cliAuditor = await cliCredentials(identities, auditorAuth);
    const portalAuditor = await portalCredentials(portalUrl, auditorSession);
    const mcpAuditor = await mcpCredentials(mcpUrl, auditorSession);

    assertEquals(cliAuditor.code, 0, JSON.stringify(cliAuditor.body));
    assertEquals(portalAuditor.status, 200);
    assertEquals(mcpAuditor.ok, true, JSON.stringify(mcpAuditor));
    assertEquals(cliAuditor.body.ok, true);
    assertEquals(portalAuditor.body.data, cliAuditor.body.data);
    assertEquals(mcpAuditor.data, cliAuditor.body.data);
    assertEquals(subjectsOf(cliAuditor.body.data).includes("human:security-auditor"), true);
    assertEquals(subjectsOf(cliAuditor.body.data).includes("agent:docs-bot"), true);
    assertEquals(subjectsOf(cliAuditor.body.data).includes("human:reader"), true);
    assertEquals((cliAuditor.body.data ?? []).length >= 3, true);
    for (const row of cliAuditor.body.data ?? []) {
      assertEquals(
        Object.keys(row).sort(),
        row.revokedAt
          ? ["credentialRef", "id", "issuedAt", "issuedBy", "revokedAt", "subjectId"]
          : ["credentialRef", "id", "issuedAt", "issuedBy", "subjectId"],
      );
      assertEquals(typeof row.id, "string");
      assertEquals(row.id.length > 0, true);
      assertEquals(row.credentialRef.startsWith("issued:"), true);
      assertEquals(typeof row.issuedAt, "string");
      assertEquals(typeof row.issuedBy.id, "string");
      assertEquals(typeof row.issuedBy.kind, "string");
    }
    const payload = JSON.stringify(cliAuditor.body.data);
    assertEquals(
      payload.includes("secretHash") ||
        payload.includes("tokenHash") ||
        payload.includes("pct1_") ||
        payload.includes("pst1_"),
      false,
      "credential trail must not leak credential or session secrets",
    );
    assertEquals(payload.includes(auditorSession), false);
    assertEquals(payload.includes(maintainerSession), false);
    assertEquals(payload.includes(readerSession), false);

    const cliMaintainer = await cliCredentials(identities, maintainerAuth);
    const portalMaintainer = await portalCredentials(portalUrl, maintainerSession);
    const mcpMaintainer = await mcpCredentials(mcpUrl, maintainerSession);
    assertEquals(cliMaintainer.code, 1);
    assertEquals(cliMaintainer.body.error?.code, "FORBIDDEN");
    assertEquals(portalMaintainer.status, 403);
    assertEquals(portalMaintainer.body.error?.code, "FORBIDDEN");
    assertEquals(mcpMaintainer.ok, false);
    assertEquals(mcpMaintainer.error?.code, "FORBIDDEN");

    const cliReader = await cliCredentials(identities, readerAuth);
    const portalReader = await portalCredentials(portalUrl, readerSession);
    const mcpReader = await mcpCredentials(mcpUrl, readerSession);
    assertEquals(cliReader.code, 1);
    assertEquals(cliReader.body.error?.code, "FORBIDDEN");
    assertEquals(portalReader.status, 403);
    assertEquals(portalReader.body.error?.code, "FORBIDDEN");
    assertEquals(mcpReader.ok, false);
    assertEquals(mcpReader.error?.code, "FORBIDDEN");

    const cliMissingStore = await cliCredentials(identities);
    assertEquals(cliMissingStore.body.error?.code, "USAGE");

    const cliAnon = await cliCredentials(identities, ["--sessions", sessions]);
    const portalAnon = await portalCredentials(portalUrl, null);
    const mcpAnon = await mcpCredentials(mcpUrl, null);
    assertEquals(cliAnon.body.error?.code, "FORBIDDEN");
    assertEquals(portalAnon.body.error?.code, "FORBIDDEN");
    assertEquals(mcpAnon.error?.code, "FORBIDDEN");

    const posted = await fetch(`${portalUrl}/api/credentials`, {
      method: "POST",
      headers: authHeaders(auditorSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<CredentialRow[]>;
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(identities),
      beforeIdentities,
      "reading credentials must not rewrite identities.json",
    );
    assertEquals(
      await Deno.readFile(sessions),
      beforeSessions,
      "reading credentials must not rewrite sessions.json",
    );
    const afterCatalog = await Deno.readFile(catalog).catch(() => new Uint8Array());
    assertEquals(
      afterCatalog,
      beforeCatalog,
      "reading credentials must not rewrite the catalog",
    );
    assert(cliAuditor.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
