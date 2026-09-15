import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Composed portal page is one contract: CLI `page get`, Portal `GET /api/page`
 * and MCP `portico_page` must return the same resolved components for the same
 * session. Anonymous callers must not see internal catalog cards. Reading must
 * not rewrite the page or catalog files. This is not a page-set write path.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface PageView {
  updatedAt?: string;
  updatedBy?: { id: string; kind: string; role: string };
  components: Array<{ kind: string; id?: string; name?: string; role?: string }>;
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

async function mcpPage(
  url: string,
  session: string | null,
): Promise<Envelope<PageView>> {
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
      params: { name: "portico_page", arguments: {} },
    }),
  });
  return envelope<PageView>(await response.json() as JsonRpcBody);
}

async function portalPage(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<PageView> }> {
  const response = await fetch(`${url}/api/page`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<PageView>,
  };
}

async function cliPage(
  page: string,
  catalog: string,
  identities: string,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<PageView> }> {
  const result = await runCli([
    "page",
    "get",
    "--page",
    page,
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...extra,
  ]);
  return {
    code: result.code,
    body: result.stdout as Envelope<PageView>,
  };
}

Deno.test("E2E: CLI, Portal and MCP page get match; anonymous hides internal cards", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-page-get-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const page = `${dataDir}/page.json`;
  const input = `${dir}/record.json`;
  const pageInput = `${dir}/page-input.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(
    pageInput,
    `${
      JSON.stringify(
        {
          components: [
            { kind: "catalog_card", id: "docs-writer" },
            { kind: "permission_hint" },
          ],
        },
        null,
        2,
      )
    }\n`,
  );

  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      input,
    ], env)).code,
    0,
  );
  assertEquals(
    (await runCli([
      "page",
      "set",
      "--page",
      page,
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      pageInput,
    ], env)).code,
    0,
  );

  const readerSession = sessionFor("human:reader")!;
  const readerAuth = actor("reader", "human:reader", "human");
  const beforePage = await Deno.readFile(page);
  const beforeCatalog = await Deno.readFile(catalog);

  const portal = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    PORTICO_PAGE_PATH: page,
  }, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    PORTICO_PAGE_PATH: page,
  }, MCP_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;

    const cliReader = await cliPage(page, catalog, identities, readerAuth);
    const portalReader = await portalPage(portalUrl, readerSession);
    const mcpReader = await mcpPage(mcpUrl, readerSession);

    assertEquals(cliReader.code, 0, JSON.stringify(cliReader.body));
    assertEquals(portalReader.status, 200);
    assertEquals(mcpReader.ok, true, JSON.stringify(mcpReader));
    assertEquals(cliReader.body.ok, true);
    assertEquals(cliReader.body.data?.components[0]?.kind, "catalog_card");
    assertEquals(cliReader.body.data?.components[0]?.id, "docs-writer");
    assertEquals(cliReader.body.data?.components[0]?.name, "Docs Writer");
    assertEquals(cliReader.body.data?.components[1]?.kind, "permission_hint");
    assertEquals(cliReader.body.data?.components[1]?.role, "reader");
    assertEquals(portalReader.body.data, cliReader.body.data);
    assertEquals(mcpReader.data, cliReader.body.data);
    assertEquals(
      JSON.stringify(cliReader.body.data).includes("secretHash") ||
        JSON.stringify(cliReader.body.data).includes("tokenHash") ||
        JSON.stringify(cliReader.body.data).includes("pct1_") ||
        JSON.stringify(cliReader.body.data).includes("pst1_"),
      false,
      "page get must not leak credential or session secrets",
    );

    const cliAnon = await cliPage(page, catalog, identities);
    const portalAnon = await portalPage(portalUrl, null);
    const mcpAnon = await mcpPage(mcpUrl, null);
    assertEquals(cliAnon.code, 0, JSON.stringify(cliAnon.body));
    assertEquals(portalAnon.status, 200);
    assertEquals(mcpAnon.ok, true, JSON.stringify(mcpAnon));
    assertEquals(
      cliAnon.body.data?.components.some((item) => item.kind === "catalog_card"),
      false,
    );
    assertEquals(portalAnon.body.data, cliAnon.body.data);
    assertEquals(mcpAnon.data, cliAnon.body.data);
    assertEquals(JSON.stringify(cliAnon.body.data).includes("Docs Writer"), false);
    assertEquals(JSON.stringify(cliAnon.body.data).includes("docs-writer"), false);

    const posted = await fetch(`${portalUrl}/api/page`, {
      method: "POST",
      headers: authHeaders(readerSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<PageView>;
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(page),
      beforePage,
      "reading page must not rewrite page.json",
    );
    assertEquals(
      await Deno.readFile(catalog),
      beforeCatalog,
      "reading page must not rewrite the catalog",
    );
    assert(cliReader.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
