import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleMcpRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Gateway access audit is one contract: CLI `gateway audit`, Portal
 * `GET /api/gateway-audit` and MCP `portico_gateway_audit` must return the
 * same auditor-facing rows in the same order for the same auditor session.
 * Maintainers, readers and anonymous stay FORBIDDEN. Reading must not rewrite
 * the catalog or the audit file, and must not leak session tokens. This is
 * not an authorize write path and not a way to execute tools.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface GatewayAuditRow {
  id: string;
  surfaceId: string;
  decision: string;
  reason: string;
  actor: { id: string; kind: string; role: string };
  at: string;
  endpoint?: { kind: string; value: string };
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

async function mcpGatewayAudit(
  url: string,
  session: string | null,
): Promise<Envelope<GatewayAuditRow[]>> {
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
      params: { name: "portico_gateway_audit", arguments: {} },
    }),
  });
  return envelope<GatewayAuditRow[]>(await response.json() as JsonRpcBody);
}

async function portalGatewayAudit(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<GatewayAuditRow[]> }> {
  const response = await fetch(`${url}/api/gateway-audit`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<GatewayAuditRow[]>,
  };
}

async function cliGatewayAudit(
  identities: string,
  audit: string,
  extra: string[] = [],
  env: Record<string, string> = {},
): Promise<{ code: number; body: Envelope<GatewayAuditRow[]> }> {
  const result = await runCli([
    "gateway",
    "audit",
    "--identities",
    identities,
    "--audit",
    audit,
    ...extra,
  ], env);
  return {
    code: result.code,
    body: result.stdout as Envelope<GatewayAuditRow[]>,
  };
}

Deno.test("E2E: CLI, Portal and MCP gateway-audit trails match for auditor; others are refused", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-gateway-audit-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const audit = `${dataDir}/gateway-audit.json`;
  const input = `${dir}/record.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  const env = await bootstrapRoster(identities, sessions);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleMcpRecord(), null, 2)}\n`);

  const maintainerSession = sessionFor("agent:docs-bot")!;
  const auditorSession = sessionFor("human:security-auditor")!;
  const readerSession = sessionFor("human:reader")!;
  const maintainerAuth = actor("maintainer", "agent:docs-bot");
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const readerAuth = actor("reader", "human:reader", "human");

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...maintainerAuth,
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 0, JSON.stringify(registered.stdout));

  const authorized = await runCli([
    "gateway",
    "authorize",
    "--id",
    "docs-mcp",
    "--catalog",
    catalog,
    "--audit",
    audit,
    ...readerAuth,
  ], env);
  assertEquals(authorized.code, 0, JSON.stringify(authorized.stdout));

  const beforeIdentities = await Deno.readFile(identities);
  const beforeSessions = await Deno.readFile(sessions);
  const beforeCatalog = await Deno.readFile(catalog);
  const beforeAudit = await Deno.readFile(audit);

  const portal = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    PORTICO_GATEWAY_AUDIT_PATH: audit,
  }, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    PORTICO_GATEWAY_AUDIT_PATH: audit,
  }, MCP_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;

    const cliAuditor = await cliGatewayAudit(identities, audit, auditorAuth, env);
    const portalAuditor = await portalGatewayAudit(portalUrl, auditorSession);
    const mcpAuditor = await mcpGatewayAudit(mcpUrl, auditorSession);

    assertEquals(cliAuditor.code, 0, JSON.stringify(cliAuditor.body));
    assertEquals(portalAuditor.status, 200);
    assertEquals(mcpAuditor.ok, true, JSON.stringify(mcpAuditor));
    assertEquals(cliAuditor.body.ok, true);
    assertEquals(portalAuditor.body.data, cliAuditor.body.data);
    assertEquals(mcpAuditor.data, cliAuditor.body.data);
    assertEquals((cliAuditor.body.data ?? []).length, 1);
    const row = (cliAuditor.body.data ?? [])[0];
    assertEquals(row.surfaceId, "docs-mcp");
    assertEquals(row.decision, "allowed");
    assertEquals(row.reason, "authorized");
    assertEquals(row.actor.id, "human:reader");
    assertEquals(row.actor.kind, "human");
    assertEquals(row.actor.role, "reader");
    assertEquals(row.endpoint, {
      kind: "mcp_endpoint",
      value: "https://mcp.example.test/servers/docs",
    });
    assertEquals(
      Object.keys(row).sort(),
      ["actor", "at", "decision", "endpoint", "id", "reason", "surfaceId"],
    );
    const payload = JSON.stringify(cliAuditor.body.data);
    assertEquals(
      payload.includes("secretHash") ||
        payload.includes("tokenHash") ||
        payload.includes("pct1_") ||
        payload.includes("pst1_"),
      false,
      "gateway audit trail must not leak credential or session secrets",
    );
    assertEquals(payload.includes(auditorSession), false);
    assertEquals(payload.includes(maintainerSession), false);
    assertEquals(payload.includes(readerSession), false);

    const cliMaintainer = await cliGatewayAudit(identities, audit, maintainerAuth, env);
    const portalMaintainer = await portalGatewayAudit(portalUrl, maintainerSession);
    const mcpMaintainer = await mcpGatewayAudit(mcpUrl, maintainerSession);
    assertEquals(cliMaintainer.code, 1);
    assertEquals(cliMaintainer.body.error?.code, "FORBIDDEN");
    assertEquals(portalMaintainer.status, 403);
    assertEquals(portalMaintainer.body.error?.code, "FORBIDDEN");
    assertEquals(mcpMaintainer.ok, false);
    assertEquals(mcpMaintainer.error?.code, "FORBIDDEN");

    const cliReader = await cliGatewayAudit(identities, audit, readerAuth, env);
    const portalReader = await portalGatewayAudit(portalUrl, readerSession);
    const mcpReader = await mcpGatewayAudit(mcpUrl, readerSession);
    assertEquals(cliReader.code, 1);
    assertEquals(cliReader.body.error?.code, "FORBIDDEN");
    assertEquals(portalReader.status, 403);
    assertEquals(portalReader.body.error?.code, "FORBIDDEN");
    assertEquals(mcpReader.ok, false);
    assertEquals(mcpReader.error?.code, "FORBIDDEN");

    const cliAnon = await cliGatewayAudit(identities, audit, [], env);
    const portalAnon = await portalGatewayAudit(portalUrl, null);
    const mcpAnon = await mcpGatewayAudit(mcpUrl, null);
    assertEquals(cliAnon.body.error?.code, "FORBIDDEN");
    assertEquals(portalAnon.body.error?.code, "FORBIDDEN");
    assertEquals(mcpAnon.error?.code, "FORBIDDEN");

    const posted = await fetch(`${portalUrl}/api/gateway-audit`, {
      method: "POST",
      headers: authHeaders(auditorSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<GatewayAuditRow[]>;
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(identities),
      beforeIdentities,
      "reading gateway audit must not rewrite identities.json",
    );
    assertEquals(
      await Deno.readFile(sessions),
      beforeSessions,
      "reading gateway audit must not rewrite sessions.json",
    );
    assertEquals(
      await Deno.readFile(catalog),
      beforeCatalog,
      "reading gateway audit must not rewrite the catalog",
    );
    assertEquals(
      await Deno.readFile(audit),
      beforeAudit,
      "reading gateway audit must not rewrite gateway-audit.json",
    );
    assert(cliAuditor.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
