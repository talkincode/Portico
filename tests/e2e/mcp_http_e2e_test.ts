import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * `AGENTS.md`: "Portal、CLI、MCP 必须呈现同一治理状态。一个入口公开、另一个
 * 入口仍隐藏，视为缺陷。"
 *
 * This is that rule as an executable assertion. The same identity asks all
 * three entrances the same question, through their real processes, and the
 * answers must be identical — not "similar", the same records in the same
 * order. It also pins that anonymous sees strictly less than a reader.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface JsonRpcBody {
  result?: { content?: Array<{ text: string }> };
}

function envelope<T>(body: JsonRpcBody): Envelope<T> {
  return JSON.parse(body.result?.content?.[0]?.text ?? "null") as Envelope<T>;
}

async function mcpCall<T>(url: string, session: string | null): Promise<Envelope<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Bearer ${session}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "portico_list", arguments: {} },
    }),
  });
  return envelope<T>(await response.json() as JsonRpcBody);
}

async function portalList<T>(url: string, session: string | null): Promise<T> {
  const response = await fetch(`${url}/api/catalog`, {
    headers: session ? { authorization: `Bearer ${session}` } : {},
  });
  const body = await response.json() as Envelope<T>;
  assertEquals(body.ok, true, JSON.stringify(body));
  return body.data as T;
}

async function cliList<T>(
  catalog: string,
  identities: string,
  sessions: string,
  session: string,
): Promise<T> {
  const result = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--identities",
    identities,
    "--sessions",
    sessions,
    "--session",
    session,
  ]);
  assertEquals(result.code, 0, result.raw);
  return (result.stdout as Envelope<T>).data as T;
}

Deno.test("E2E: CLI, Portal and MCP present the same governance state", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-parity-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  // bootstrapRoster grants the standard roster and signs every identity in;
  // `actor()` then authenticates with a real session.
  await bootstrapRoster(identities, sessions);
  const auditor = actor("auditor", "human:security-auditor", "human");

  // ── one approved-public surface and one internal-only surface ────────
  const records: Array<[string, unknown]> = [
    ["mcp", {
      id: "docs-mcp",
      name: "Docs MCP",
      description: "External documentation MCP server.",
      channels: ["mcp"],
      version: "1.0.0",
      visibility: "internal",
      entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/docs" },
      maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    }],
    ["cli", {
      id: "secret-writer",
      name: "Secret Writer",
      description: "Internal-only tooling.",
      channels: ["cli"],
      version: "0.1.0",
      visibility: "internal",
      entry: { kind: "package", value: "jsr:@example/secret-writer" },
      maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    }],
  ];
  for (const [label, record] of records) {
    const file = `${dir}/${label}.json`;
    await Deno.writeTextFile(file, JSON.stringify(record));
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
  const submitted = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("maintainer"),
    "--id",
    "docs-mcp",
    "--visibility",
    "public",
  ]);
  assertEquals(submitted.code, 0, submitted.raw);
  const approved = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...auditor,
    "--id",
    "docs-mcp",
  ]);
  assertEquals(approved.code, 0, approved.raw);

  // A real reader session, not a claimed identity.
  const session = sessionFor("human:reader")!;

  // ── all three entrances, as real processes ───────────────────────────
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

    // Reader: internal + approved public, through every entrance.
    const cliReader = await cliList<Array<{ id: string; governanceState: string }>>(
      catalog,
      identities,
      sessions,
      session,
    );
    const portalReader = await portalList<Array<{ id: string; governanceState: string }>>(
      portalUrl,
      session,
    );
    const mcpReader = await mcpCall<Array<{ id: string; governanceState: string }>>(
      mcpUrl,
      session,
    );

    assertEquals(mcpReader.ok, true, JSON.stringify(mcpReader));
    assertEquals(
      cliReader.map((item) => item.id),
      portalReader.map((item) => item.id),
    );
    assertEquals(
      cliReader.map((item) => item.id),
      (mcpReader.data as Array<{ id: string }>).map((item) => item.id),
    );
    assertEquals(cliReader.length, 2, "a reader must see both surfaces");

    // Anonymous: only what crossed the approval boundary, and strictly less
    // than a reader sees.
    const portalAnonymous = await portalList<Array<{ id: string }>>(portalUrl, null);
    const mcpAnonymous = await mcpCall<Array<{ id: string }>>(mcpUrl, null);
    assertEquals(mcpAnonymous.ok, true, JSON.stringify(mcpAnonymous));
    assertEquals(
      portalAnonymous.map((item) => item.id),
      (mcpAnonymous.data as Array<{ id: string }>).map((item) => item.id),
    );
    assertEquals(portalAnonymous.map((item) => item.id), ["docs-mcp"]);
    assert(
      portalAnonymous.length < cliReader.length,
      "anonymous must see strictly less than a reader",
    );
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
