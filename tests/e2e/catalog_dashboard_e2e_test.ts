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
 * Governance dashboard is one contract: CLI `catalog dashboard`, Portal
 * `GET /api/dashboard` and MCP `portico_dashboard` must return the same
 * visibility-scoped counts and the same surface order. It is not an ops
 * metrics board, and reading it must not rewrite the catalog.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface DashboardCounts {
  visible: number;
  draft: number;
  internal: number;
  pending_public: number;
  approved_public: number;
  rejected: number;
}

interface DashboardView {
  counts: DashboardCounts;
  surfaces: Array<{ id: string; governanceState: string }>;
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

async function mcpDashboard(
  url: string,
  session: string | null,
): Promise<Envelope<DashboardView>> {
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
      params: { name: "portico_dashboard", arguments: {} },
    }),
  });
  return envelope<DashboardView>(await response.json() as JsonRpcBody);
}

async function portalDashboard(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<DashboardView> }> {
  const response = await fetch(`${url}/api/dashboard`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<DashboardView>,
  };
}

async function cliDashboard(
  catalog: string,
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<DashboardView> }> {
  const result = await runCli([
    "catalog",
    "dashboard",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<DashboardView>,
  };
}

function idsOf(view: DashboardView | undefined): string[] {
  return (view?.surfaces ?? []).map((item) => item.id);
}

Deno.test("E2E: CLI, Portal and MCP dashboard match for reader and anonymous", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-dashboard-e2e-" });
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

  const readerSession = sessionFor("human:reader")!;
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

    const cliReader = await cliDashboard(catalog, identities, readerAuth);
    const portalReader = await portalDashboard(portalUrl, readerSession);
    const mcpReader = await mcpDashboard(mcpUrl, readerSession);

    assertEquals(cliReader.code, 0, JSON.stringify(cliReader.body));
    assertEquals(portalReader.status, 200);
    assertEquals(mcpReader.ok, true, JSON.stringify(mcpReader));
    assertEquals(cliReader.body.ok, true);
    assertEquals(cliReader.body.data?.counts, {
      visible: 2,
      draft: 0,
      internal: 1,
      pending_public: 0,
      approved_public: 1,
      rejected: 0,
    });
    assertEquals(idsOf(cliReader.body.data), ["docs-web", "docs-writer"]);
    assertEquals(portalReader.body.data, cliReader.body.data);
    assertEquals(mcpReader.data, cliReader.body.data);

    const cliAnon = await cliDashboard(catalog, identities);
    const portalAnon = await portalDashboard(portalUrl, null);
    const mcpAnon = await mcpDashboard(mcpUrl, null);

    assertEquals(cliAnon.code, 0, JSON.stringify(cliAnon.body));
    assertEquals(portalAnon.status, 200);
    assertEquals(mcpAnon.ok, true, JSON.stringify(mcpAnon));
    assertEquals(cliAnon.body.data?.counts, {
      visible: 1,
      draft: 0,
      internal: 0,
      pending_public: 0,
      approved_public: 1,
      rejected: 0,
    });
    assertEquals(idsOf(cliAnon.body.data), ["docs-web"]);
    assertEquals(portalAnon.body.data, cliAnon.body.data);
    assertEquals(mcpAnon.data, cliAnon.body.data);
    assert(
      (cliAnon.body.data?.counts.visible ?? 0) < (cliReader.body.data?.counts.visible ?? 0),
      "anonymous dashboard must be narrower than a reader's",
    );

    const missingCatalog = await runCli(["catalog", "dashboard"]);
    assertEquals(missingCatalog.code, 1);
    assertEquals(
      (missingCatalog.stdout as Envelope<unknown>).error?.code,
      "USAGE",
    );

    assertEquals(
      await Deno.readFile(catalog),
      before,
      "reading the dashboard must not rewrite the catalog",
    );
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
