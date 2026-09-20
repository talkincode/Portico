import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Credential-revoke history is one contract: CLI `identity credential revokes`,
 * Portal `GET /api/credential-revokes` and MCP `portico_credential_revokes`
 * must return the same auditor-facing rows in the same order for the same
 * auditor session. Maintainers, readers and anonymous stay FORBIDDEN. Reading
 * must not rewrite the roster or leak tokens or hashes. This is not a
 * credential-revoke write path.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface CredentialRevokeRow {
  id: string;
  subjectId: string;
  kind: string;
  role: string;
  revokedBy: { id: string; kind: string };
  revokedAt: string;
  credentials: number;
  sessions: number;
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

async function mcpCredentialRevokes(
  url: string,
  session: string | null,
): Promise<Envelope<CredentialRevokeRow[]>> {
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
      params: { name: "portico_credential_revokes", arguments: {} },
    }),
  });
  return envelope<CredentialRevokeRow[]>(await response.json() as JsonRpcBody);
}

async function portalCredentialRevokes(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<CredentialRevokeRow[]> }> {
  const response = await fetch(`${url}/api/credential-revokes`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<CredentialRevokeRow[]>,
  };
}

async function cliCredentialRevokes(
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<CredentialRevokeRow[]> }> {
  const result = await runCli([
    "identity",
    "credential",
    "revokes",
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<CredentialRevokeRow[]>,
  };
}

function subjectsOf(rows: CredentialRevokeRow[] | undefined): string[] {
  return (rows ?? []).map((item) => item.subjectId);
}

Deno.test("E2E: CLI, Portal and MCP credential-revoke trails match for auditor; others are refused", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cred-revokes-e2e-" });
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

  const revoked = await runCli([
    "identity",
    "credential",
    "revoke",
    "--identities",
    identities,
    ...auditorAuth,
    "--id",
    "human:docs-owner",
  ]);
  assertEquals(revoked.code, 0, JSON.stringify(revoked.stdout));

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

    const cliAuditor = await cliCredentialRevokes(identities, auditorAuth);
    const portalAuditor = await portalCredentialRevokes(portalUrl, auditorSession);
    const mcpAuditor = await mcpCredentialRevokes(mcpUrl, auditorSession);

    assertEquals(cliAuditor.code, 0, JSON.stringify(cliAuditor.body));
    assertEquals(portalAuditor.status, 200);
    assertEquals(mcpAuditor.ok, true, JSON.stringify(mcpAuditor));
    assertEquals(cliAuditor.body.ok, true);
    assertEquals(portalAuditor.body.data, cliAuditor.body.data);
    assertEquals(mcpAuditor.data, cliAuditor.body.data);
    assertEquals(subjectsOf(cliAuditor.body.data), ["human:docs-owner"]);
    assertEquals((cliAuditor.body.data ?? []).length, 1);
    for (const row of cliAuditor.body.data ?? []) {
      assertEquals(
        Object.keys(row).sort(),
        ["credentials", "id", "kind", "revokedAt", "revokedBy", "role", "sessions", "subjectId"],
      );
      assertEquals(Object.keys(row.revokedBy).sort(), ["id", "kind"]);
      assertEquals(typeof row.id, "string");
      assertEquals(row.id.length > 0, true);
      assertEquals(typeof row.revokedAt, "string");
      assertEquals(row.kind, "human");
      assertEquals(row.role, "maintainer");
      assertEquals(row.revokedBy.id, "human:security-auditor");
      assertEquals(row.revokedBy.kind, "human");
      assertEquals(row.credentials >= 1, true);
      assertEquals(row.sessions >= 1, true);
    }
    const payload = JSON.stringify(cliAuditor.body.data);
    assertEquals(
      payload.includes("secretHash") ||
        payload.includes("tokenHash") ||
        payload.includes("pct1_") ||
        payload.includes("pst1_"),
      false,
      "credential-revoke trail must not leak credential or session secrets",
    );
    assertEquals(payload.includes(auditorSession), false);
    assertEquals(payload.includes(maintainerSession), false);
    assertEquals(payload.includes(readerSession), false);

    const cliMaintainer = await cliCredentialRevokes(identities, maintainerAuth);
    const portalMaintainer = await portalCredentialRevokes(portalUrl, maintainerSession);
    const mcpMaintainer = await mcpCredentialRevokes(mcpUrl, maintainerSession);
    assertEquals(cliMaintainer.code, 1);
    assertEquals(cliMaintainer.body.error?.code, "FORBIDDEN");
    assertEquals(portalMaintainer.status, 403);
    assertEquals(portalMaintainer.body.error?.code, "FORBIDDEN");
    assertEquals(mcpMaintainer.ok, false);
    assertEquals(mcpMaintainer.error?.code, "FORBIDDEN");

    const cliReader = await cliCredentialRevokes(identities, readerAuth);
    const portalReader = await portalCredentialRevokes(portalUrl, readerSession);
    const mcpReader = await mcpCredentialRevokes(mcpUrl, readerSession);
    assertEquals(cliReader.code, 1);
    assertEquals(cliReader.body.error?.code, "FORBIDDEN");
    assertEquals(portalReader.status, 403);
    assertEquals(portalReader.body.error?.code, "FORBIDDEN");
    assertEquals(mcpReader.ok, false);
    assertEquals(mcpReader.error?.code, "FORBIDDEN");

    const cliAnon = await cliCredentialRevokes(identities);
    const portalAnon = await portalCredentialRevokes(portalUrl, null);
    const mcpAnon = await mcpCredentialRevokes(mcpUrl, null);
    assertEquals(cliAnon.body.error?.code, "FORBIDDEN");
    assertEquals(portalAnon.body.error?.code, "FORBIDDEN");
    assertEquals(mcpAnon.error?.code, "FORBIDDEN");

    const posted = await fetch(`${portalUrl}/api/credential-revokes`, {
      method: "POST",
      headers: authHeaders(auditorSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<CredentialRevokeRow[]>;
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(identities),
      beforeIdentities,
      "reading credential revokes must not rewrite identities.json",
    );
    assertEquals(
      await Deno.readFile(sessions),
      beforeSessions,
      "reading credential revokes must not rewrite sessions.json",
    );
    const afterCatalog = await Deno.readFile(catalog).catch(() => new Uint8Array());
    assertEquals(
      afterCatalog,
      beforeCatalog,
      "reading credential revokes must not rewrite the catalog",
    );
    assert(cliAuditor.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
