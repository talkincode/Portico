import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Public-boundary approval records are one contract: CLI `catalog approvals`,
 * Portal `GET /api/approvals` and MCP `portico_approvals` must return the same
 * rows in the same order for the same session, including an optional auditor
 * note. Anonymous sees an empty list. Reading must not rewrite the catalog.
 * This is not an approval write path.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface ApprovalRow {
  id: string;
  surfaceId: string;
  decision: string;
  submittedBy: { id: string; kind: string };
  reviewedBy: { id: string; kind: string };
  reviewedAt: string;
  entry: { kind: string; value: string };
  version: string;
  name: string;
  note?: string;
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

async function mcpApprovals(
  url: string,
  session: string | null,
): Promise<Envelope<ApprovalRow[]>> {
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
      params: { name: "portico_approvals", arguments: {} },
    }),
  });
  return envelope<ApprovalRow[]>(await response.json() as JsonRpcBody);
}

async function portalApprovals(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<ApprovalRow[]> }> {
  const response = await fetch(`${url}/api/approvals`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<ApprovalRow[]>,
  };
}

async function cliApprovals(
  catalog: string,
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<ApprovalRow[]> }> {
  const result = await runCli([
    "catalog",
    "approvals",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<ApprovalRow[]>,
  };
}

Deno.test("E2E: CLI, Portal and MCP approvals match for auditor and reader; anonymous is empty", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approvals-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  await bootstrapRoster(identities, sessions);

  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);
  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...actor("maintainer"),
      "--input",
      input,
    ])).code,
    0,
  );
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
      "docs-writer",
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
      "docs-writer",
      "--note",
      "Package coordinate reviewed.",
    ])).code,
    0,
  );

  const auditorSession = sessionFor("human:security-auditor")!;
  const readerSession = sessionFor("human:reader")!;
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const readerAuth = actor("reader", "human:reader", "human");
  const before = await Deno.readFile(catalog);

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

    const cliAuditor = await cliApprovals(catalog, identities, auditorAuth);
    const portalAuditor = await portalApprovals(portalUrl, auditorSession);
    const mcpAuditor = await mcpApprovals(mcpUrl, auditorSession);

    assertEquals(cliAuditor.code, 0, JSON.stringify(cliAuditor.body));
    assertEquals(portalAuditor.status, 200);
    assertEquals(mcpAuditor.ok, true, JSON.stringify(mcpAuditor));
    assertEquals(cliAuditor.body.ok, true);
    assertEquals(cliAuditor.body.data?.length, 1);
    assertEquals(cliAuditor.body.data?.[0].surfaceId, "docs-writer");
    assertEquals(cliAuditor.body.data?.[0].decision, "approved");
    assertEquals(cliAuditor.body.data?.[0].submittedBy.id, "agent:docs-bot");
    assertEquals(cliAuditor.body.data?.[0].reviewedBy.id, "human:security-auditor");
    assertEquals(cliAuditor.body.data?.[0].reviewedBy.kind, "human");
    assertEquals(cliAuditor.body.data?.[0].entry.value, "jsr:@example/docs-writer");
    assertEquals(cliAuditor.body.data?.[0].note, "Package coordinate reviewed.");
    assertEquals(portalAuditor.body.data, cliAuditor.body.data);
    assertEquals(mcpAuditor.data, cliAuditor.body.data);
    assertEquals(
      JSON.stringify(cliAuditor.body.data).includes("secretHash") ||
        JSON.stringify(cliAuditor.body.data).includes("tokenHash") ||
        JSON.stringify(cliAuditor.body.data).includes("pct1_") ||
        JSON.stringify(cliAuditor.body.data).includes("pst1_"),
      false,
      "approval listing must not leak credential or session secrets",
    );

    const cliReader = await cliApprovals(catalog, identities, readerAuth);
    const portalReader = await portalApprovals(portalUrl, readerSession);
    const mcpReader = await mcpApprovals(mcpUrl, readerSession);
    assertEquals(cliReader.code, 0, JSON.stringify(cliReader.body));
    assertEquals(portalReader.status, 200);
    assertEquals(mcpReader.ok, true, JSON.stringify(mcpReader));
    assertEquals(cliReader.body.data, cliAuditor.body.data);
    assertEquals(portalReader.body.data, cliAuditor.body.data);
    assertEquals(mcpReader.data, cliAuditor.body.data);

    const cliAnon = await cliApprovals(catalog, identities);
    const portalAnon = await portalApprovals(portalUrl, null);
    const mcpAnon = await mcpApprovals(mcpUrl, null);
    assertEquals(cliAnon.code, 0, JSON.stringify(cliAnon.body));
    assertEquals(portalAnon.status, 200);
    assertEquals(mcpAnon.ok, true, JSON.stringify(mcpAnon));
    assertEquals(cliAnon.body.data, []);
    assertEquals(portalAnon.body.data, []);
    assertEquals(mcpAnon.data, []);

    const posted = await fetch(`${portalUrl}/api/approvals`, {
      method: "POST",
      headers: authHeaders(auditorSession),
      body: "{}",
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<unknown>;
    assertEquals(postedBody.ok, false);
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(catalog),
      before,
      "reading approvals must not rewrite the catalog",
    );
    assert(cliAuditor.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
