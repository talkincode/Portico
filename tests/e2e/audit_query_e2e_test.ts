import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import {
  actor,
  bootstrapRoster,
  ROOT,
  runCli,
  sampleRecord,
  sampleWebRecord,
  sessionFor,
} from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Audit query is one contract: CLI `audit list`, Portal `GET /api/audit`
 * and MCP `portico_audit` must filter the same auditor timeline the same way.
 * Searching never inspects entry URLs. Non-auditors stay FORBIDDEN.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface AuditEvent {
  id: string;
  kind: string;
  action: string;
  subjectId: string;
  summary: string;
  entry?: { kind: string; value: string };
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

async function mcpAudit(
  url: string,
  session: string | null,
  args: Record<string, unknown> = {},
): Promise<Envelope<AuditEvent[]>> {
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
      params: { name: "portico_audit", arguments: args },
    }),
  });
  return envelope<AuditEvent[]>(await response.json() as JsonRpcBody);
}

async function portalAudit(
  url: string,
  session: string | null,
  query = "",
): Promise<{ status: number; body: Envelope<AuditEvent[]> }> {
  const response = await fetch(`${url}/api/audit${query}`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<AuditEvent[]>,
  };
}

async function cliAudit(
  catalog: string,
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<AuditEvent[]> }> {
  const result = await runCli([
    "audit",
    "list",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<AuditEvent[]>,
  };
}

function idsOf(items: AuditEvent[] | undefined): string[] {
  return (items ?? []).map((item) => item.id);
}

Deno.test("E2E: CLI, Portal and MCP apply the same audit query for an auditor", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-audit-query-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  await bootstrapRoster(identities, sessions);

  const writerFile = `${dir}/writer.json`;
  const webFile = `${dir}/web.json`;
  await Deno.writeTextFile(writerFile, JSON.stringify(sampleRecord()));
  await Deno.writeTextFile(webFile, JSON.stringify(sampleWebRecord()));

  for (const file of [writerFile, webFile]) {
    const registered = await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...actor("maintainer"),
      "--input",
      file,
    ]);
    assertEquals(registered.code, 0, registered.raw);
  }
  assertEquals(
    (await runCli([
      "catalog",
      "publish",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...actor("maintainer"),
      "--id",
      "docs-web",
      "--visibility",
      "public",
    ])).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "approve",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-web",
    ])).code,
    0,
  );

  const auditorSession = sessionFor("human:security-auditor")!;
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const readerAuth = actor("reader", "human:reader", "human");
  const readerSession = sessionFor("human:reader")!;

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

    const cliWriter = await cliAudit(catalog, identities, [
      ...auditorAuth,
      "--kind",
      "catalog",
      "--q",
      "Writer",
    ]);
    const portalWriter = await portalAudit(
      portalUrl,
      auditorSession,
      "?kind=catalog&q=Writer",
    );
    const mcpWriter = await mcpAudit(mcpUrl, auditorSession, {
      kind: "catalog",
      q: "Writer",
    });

    assertEquals(cliWriter.code, 0, JSON.stringify(cliWriter.body));
    assertEquals(portalWriter.status, 200);
    assertEquals(mcpWriter.ok, true, JSON.stringify(mcpWriter));
    assertEquals(idsOf(cliWriter.body.data), idsOf(portalWriter.body.data));
    assertEquals(idsOf(cliWriter.body.data), idsOf(mcpWriter.data));
    assert(idsOf(cliWriter.body.data).length >= 1);
    assertEquals(
      (cliWriter.body.data ?? []).every((item) =>
        item.kind === "catalog" && item.subjectId === "docs-writer"
      ),
      true,
    );

    const cliEndpoint = await cliAudit(catalog, identities, [
      ...auditorAuth,
      "--q",
      "jsr:@example/docs-writer",
    ]);
    const portalEndpoint = await portalAudit(
      portalUrl,
      auditorSession,
      "?q=jsr%3A%40example%2Fdocs-writer",
    );
    const mcpEndpoint = await mcpAudit(mcpUrl, auditorSession, {
      q: "jsr:@example/docs-writer",
    });
    assertEquals(idsOf(cliEndpoint.body.data), []);
    assertEquals(idsOf(portalEndpoint.body.data), []);
    assertEquals(idsOf(mcpEndpoint.data), []);

    const cliReader = await cliAudit(catalog, identities, [
      ...readerAuth,
      "--kind",
      "catalog",
    ]);
    const portalReader = await portalAudit(portalUrl, readerSession, "?kind=catalog");
    const mcpReader = await mcpAudit(mcpUrl, readerSession, { kind: "catalog" });
    assertEquals(cliReader.code, 1);
    assertEquals(cliReader.body.error?.code, "FORBIDDEN");
    assertEquals(portalReader.status, 403);
    assertEquals(portalReader.body.error?.code, "FORBIDDEN");
    assertEquals(mcpReader.ok, false);
    assertEquals(mcpReader.error?.code, "FORBIDDEN");

    const cliAnon = await cliAudit(catalog, identities, ["--kind", "catalog"]);
    const portalAnon = await portalAudit(portalUrl, null, "?kind=catalog");
    const mcpAnon = await mcpAudit(mcpUrl, null, { kind: "catalog" });
    assertEquals(cliAnon.body.error?.code, "FORBIDDEN");
    assertEquals(portalAnon.body.error?.code, "FORBIDDEN");
    assertEquals(mcpAnon.error?.code, "FORBIDDEN");

    const before = await Deno.readFile(catalog);
    const cliBad = await cliAudit(catalog, identities, [
      ...auditorAuth,
      "--kind",
      "runtime",
    ]);
    const portalBad = await portalAudit(portalUrl, auditorSession, "?kind=runtime");
    const mcpBad = await mcpAudit(mcpUrl, auditorSession, { kind: "runtime" });
    assertEquals(cliBad.code, 1);
    assertEquals(cliBad.body.error?.code, "INVALID_INPUT");
    assertEquals(portalBad.status, 400);
    assertEquals(portalBad.body.error?.code, "INVALID_INPUT");
    assertEquals(mcpBad.ok, false);
    assertEquals(mcpBad.error?.code, "INVALID_INPUT");
    assertEquals(
      await Deno.readFile(catalog),
      before,
      "invalid audit query must not rewrite the catalog",
    );

    const html = await fetch(`${portalUrl}/internal/audit?kind=catalog&q=Writer`, {
      headers: authHeaders(auditorSession),
    });
    assertEquals(html.status, 200);
    assertEquals(html.headers.get("content-type")?.includes("text/html"), true);
    const page = await html.text();
    assert(page.includes("docs-writer"), "filtered audit HTML must show the matching subject");
    assertEquals(
      page.includes("jsr:@example/docs-writer"),
      false,
      "audit HTML must not leak entry coordinates",
    );
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
