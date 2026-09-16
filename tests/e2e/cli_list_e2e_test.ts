import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import {
  actor,
  bootstrapRoster,
  ROOT,
  runCli,
  sampleMcpRecord,
  sampleRecord,
  sampleWebRecord,
  sessionFor,
} from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Authorized CLI package coordinates are one contract: CLI `cli list`, Portal
 * `GET /api/cli` and MCP `portico_cli` must return the same rows in the same
 * order for the same identity. Anonymous callers only see approved public
 * CLI surfaces. MCP endpoints and Web hrefs never appear. Reading must not
 * rewrite the catalog or leak session tokens. Portico does not install or
 * execute the listed packages.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface CliRow {
  id: string;
  name: string;
  description: string;
  version: string;
  visibility: string;
  governanceState: string;
  package: { kind: string; value: string };
  connect: { mode: string };
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

async function mcpList(
  url: string,
  session: string | null,
): Promise<Envelope<CliRow[]>> {
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
      params: { name: "portico_cli", arguments: {} },
    }),
  });
  return envelope<CliRow[]>(await response.json() as JsonRpcBody);
}

async function portalList(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<CliRow[]> }> {
  const response = await fetch(`${url}/api/cli`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<CliRow[]>,
  };
}

async function cliList(
  catalog: string,
  extra: string[] = [],
  env: Record<string, string> = {},
): Promise<{ code: number; body: Envelope<CliRow[]> }> {
  const result = await runCli([
    "cli",
    "list",
    "--catalog",
    catalog,
    ...extra,
  ], env);
  return {
    code: result.code,
    body: result.stdout as Envelope<CliRow[]>,
  };
}

function samplePublicCliRecord() {
  return {
    id: "public-docs-cli",
    name: "Public Docs CLI",
    description: "Approved public documentation package.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/public-docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

Deno.test("E2E: CLI, Portal and MCP cli-list match; anonymous hides internal; MCP and Web stay out", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-list-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const cliInput = `${dir}/cli.json`;
  const webInput = `${dir}/web.json`;
  const mcpInput = `${dir}/mcp.json`;
  const publicInput = `${dir}/public-cli.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  const env = await bootstrapRoster(identities, sessions);
  await Deno.writeTextFile(cliInput, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(webInput, `${JSON.stringify(sampleWebRecord(), null, 2)}\n`);
  await Deno.writeTextFile(mcpInput, `${JSON.stringify(sampleMcpRecord(), null, 2)}\n`);
  await Deno.writeTextFile(publicInput, `${JSON.stringify(samplePublicCliRecord(), null, 2)}\n`);

  const maintainerAuth = actor("maintainer", "agent:docs-bot");
  const readerAuth = actor("reader", "human:reader", "human");
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const readerSession = sessionFor("human:reader")!;
  const auditorSession = sessionFor("human:security-auditor")!;
  const maintainerSession = sessionFor("agent:docs-bot")!;

  const registeredCli = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...maintainerAuth,
    "--input",
    cliInput,
  ], env);
  assertEquals(registeredCli.code, 0, JSON.stringify(registeredCli.stdout));

  const registeredWeb = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...maintainerAuth,
    "--input",
    webInput,
  ], env);
  assertEquals(registeredWeb.code, 0, JSON.stringify(registeredWeb.stdout));

  const registeredMcp = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...maintainerAuth,
    "--input",
    mcpInput,
  ], env);
  assertEquals(registeredMcp.code, 0, JSON.stringify(registeredMcp.stdout));

  const registeredPublic = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...maintainerAuth,
    "--input",
    publicInput,
  ], env);
  assertEquals(registeredPublic.code, 0, JSON.stringify(registeredPublic.stdout));

  const published = await runCli([
    "catalog",
    "publish",
    "--id",
    "public-docs-cli",
    "--visibility",
    "public",
    "--catalog",
    catalog,
    ...maintainerAuth,
  ], env);
  assertEquals(published.code, 0, JSON.stringify(published.stdout));

  const approved = await runCli([
    "catalog",
    "approve",
    "--id",
    "public-docs-cli",
    "--catalog",
    catalog,
    ...auditorAuth,
  ], env);
  assertEquals(approved.code, 0, JSON.stringify(approved.stdout));

  const beforeIdentities = await Deno.readFile(identities);
  const beforeSessions = await Deno.readFile(sessions);
  const beforeCatalog = await Deno.readFile(catalog);

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

    const cliReader = await cliList(catalog, readerAuth, env);
    const portalReader = await portalList(portalUrl, readerSession);
    const mcpReader = await mcpList(mcpUrl, readerSession);

    assertEquals(cliReader.code, 0, JSON.stringify(cliReader.body));
    assertEquals(portalReader.status, 200);
    assertEquals(mcpReader.ok, true, JSON.stringify(mcpReader));
    assertEquals(cliReader.body.ok, true);
    assertEquals(portalReader.body.data, cliReader.body.data);
    assertEquals(mcpReader.data, cliReader.body.data);
    assertEquals((cliReader.body.data ?? []).map((row) => row.id), [
      "docs-writer",
      "public-docs-cli",
    ]);
    assertEquals(
      (cliReader.body.data ?? []).some((row) => row.id === "docs-web"),
      false,
    );
    assertEquals(
      (cliReader.body.data ?? []).some((row) => row.id === "docs-mcp"),
      false,
    );
    for (const row of cliReader.body.data ?? []) {
      assertEquals(row.connect.mode, "coordinate");
      assertEquals(row.package.kind, "package");
      assertEquals(
        Object.keys(row).sort(),
        [
          "connect",
          "description",
          "governanceState",
          "id",
          "name",
          "package",
          "version",
          "visibility",
        ],
      );
    }

    const payload = JSON.stringify(cliReader.body.data);
    assertEquals(
      payload.includes("secretHash") ||
        payload.includes("tokenHash") ||
        payload.includes("pct1_") ||
        payload.includes("pst1_"),
      false,
      "cli list must not leak credential or session secrets",
    );
    assertEquals(payload.includes(readerSession), false);
    assertEquals(payload.includes(auditorSession), false);
    assertEquals(payload.includes(maintainerSession), false);

    const cliAnon = await cliList(catalog, [], env);
    const portalAnon = await portalList(portalUrl, null);
    const mcpAnon = await mcpList(mcpUrl, null);
    assertEquals(cliAnon.code, 0, JSON.stringify(cliAnon.body));
    assertEquals(portalAnon.status, 200);
    assertEquals(mcpAnon.ok, true, JSON.stringify(mcpAnon));
    assertEquals(portalAnon.body.data, cliAnon.body.data);
    assertEquals(mcpAnon.data, cliAnon.body.data);
    assertEquals((cliAnon.body.data ?? []).map((row) => row.id), ["public-docs-cli"]);
    assertEquals((cliAnon.body.data ?? [])[0].governanceState, "approved_public");

    const posted = await fetch(`${portalUrl}/api/cli`, {
      method: "POST",
      headers: authHeaders(readerSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<CliRow[]>;
    assertEquals(postedBody.error?.code, "USAGE");

    assertEquals(
      await Deno.readFile(identities),
      beforeIdentities,
      "reading cli list must not rewrite identities.json",
    );
    assertEquals(
      await Deno.readFile(sessions),
      beforeSessions,
      "reading cli list must not rewrite sessions.json",
    );
    assertEquals(
      await Deno.readFile(catalog),
      beforeCatalog,
      "reading cli list must not rewrite the catalog",
    );
    assert(cliReader.body.data !== undefined);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
