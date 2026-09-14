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
 * Catalog query is one contract: CLI `catalog list`, Portal `GET /api/catalog`
 * and MCP `portico_list` must filter the same visible records the same way.
 * Searching never inspects entry URLs or package coordinates.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
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

async function mcpList<T>(
  url: string,
  session: string | null,
  args: Record<string, unknown> = {},
): Promise<Envelope<T>> {
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
      params: { name: "portico_list", arguments: args },
    }),
  });
  return envelope<T>(await response.json() as JsonRpcBody);
}

async function portalList(
  url: string,
  session: string | null,
  query = "",
): Promise<{ status: number; body: Envelope<Array<{ id: string }>> }> {
  const response = await fetch(`${url}/api/catalog${query}`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<Array<{ id: string }>>,
  };
}

async function cliList(
  catalog: string,
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<Array<{ id: string }>> }> {
  const result = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<Array<{ id: string }>>,
  };
}

function idsOf(items: Array<{ id: string }> | undefined): string[] {
  return (items ?? []).map((item) => item.id);
}

Deno.test("E2E: CLI, Portal and MCP apply the same catalog query to visible records", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-query-e2e-" });
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

    const cliWriter = await cliList(catalog, identities, [...readerAuth, "--q", "Writer"]);
    const portalWriter = await portalList(portalUrl, readerSession, "?q=Writer");
    const mcpWriter = await mcpList<Array<{ id: string }>>(mcpUrl, readerSession, { q: "Writer" });

    assertEquals(cliWriter.code, 0, JSON.stringify(cliWriter.body));
    assertEquals(portalWriter.status, 200);
    assertEquals(mcpWriter.ok, true, JSON.stringify(mcpWriter));
    assertEquals(idsOf(cliWriter.body.data), ["docs-writer"]);
    assertEquals(idsOf(portalWriter.body.data), ["docs-writer"]);
    assertEquals(idsOf(mcpWriter.data), ["docs-writer"]);

    const cliEndpoint = await cliList(catalog, identities, [
      ...readerAuth,
      "--q",
      "jsr:@example/docs-writer",
    ]);
    const portalEndpoint = await portalList(
      portalUrl,
      readerSession,
      "?q=jsr%3A%40example%2Fdocs-writer",
    );
    const mcpEndpoint = await mcpList<Array<{ id: string }>>(mcpUrl, readerSession, {
      q: "jsr:@example/docs-writer",
    });
    assertEquals(idsOf(cliEndpoint.body.data), []);
    assertEquals(idsOf(portalEndpoint.body.data), []);
    assertEquals(idsOf(mcpEndpoint.data), []);

    const cliAnon = await cliList(catalog, identities, ["--q", "Writer"]);
    const portalAnon = await portalList(portalUrl, null, "?q=Writer");
    const mcpAnon = await mcpList<Array<{ id: string }>>(mcpUrl, null, { q: "Writer" });
    assertEquals(idsOf(cliAnon.body.data), []);
    assertEquals(idsOf(portalAnon.body.data), []);
    assertEquals(idsOf(mcpAnon.data), []);

    const cliPublic = await cliList(catalog, identities, ["--q", "Web"]);
    const portalPublic = await portalList(portalUrl, null, "?q=Web");
    const mcpPublic = await mcpList<Array<{ id: string }>>(mcpUrl, null, { q: "Web" });
    assertEquals(idsOf(cliPublic.body.data), ["docs-web"]);
    assertEquals(idsOf(portalPublic.body.data), ["docs-web"]);
    assertEquals(idsOf(mcpPublic.data), ["docs-web"]);

    const before = await Deno.readFile(catalog);
    const cliBad = await cliList(catalog, identities, [...readerAuth, "--channel", "carrier-pigeon"]);
    const portalBad = await portalList(portalUrl, readerSession, "?channel=carrier-pigeon");
    const mcpBad = await mcpList<Array<{ id: string }>>(mcpUrl, readerSession, {
      channel: "carrier-pigeon",
    });
    assertEquals(cliBad.code, 1);
    assertEquals(cliBad.body.error?.code, "INVALID_INPUT");
    assertEquals(portalBad.status, 400);
    assertEquals(portalBad.body.error?.code, "INVALID_INPUT");
    assertEquals(mcpBad.ok, false);
    assertEquals(mcpBad.error?.code, "INVALID_INPUT");
    assertEquals(
      await Deno.readFile(catalog),
      before,
      "invalid query must not rewrite the catalog",
    );
    assert(
      idsOf(cliPublic.body.data).length < 2,
      "anonymous query must stay narrower than a reader's unfiltered view",
    );
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
