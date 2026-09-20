import { assertEquals } from "../assert.ts";
import { GATEWAY_PERMS, MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import {
  actor,
  bootstrapRoster,
  ROOT,
  runCli,
  sampleMcpRecord,
  sampleRecord,
  sessionFor,
} from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Public reachability belongs to the approval trail, not to the record.
 *
 * The catalog is one JSON document: an operator can edit it, a restore can
 * bring back an older copy, and a bug can write into it. The roadmap makes it
 * an iron rule that no entrance — API, CLI, MCP, or a direct write to the store
 * — may turn an unapproved object into something publicly reachable, so this
 * test writes the public claim straight into the file with nothing in the
 * approval trail behind it, and then asks the real Portal, Gateway and MCP
 * processes, over real HTTP, whether the surface became reachable. It must not,
 * for anyone the trail has not granted, while an internal session still sees
 * the same surface as internal everywhere. The same test then drives the
 * sanctioned path to prove the surface does become reachable once a human
 * auditor approves it, and that a later withdrawal takes it away again even if
 * the bytes are re-forged.
 *
 * The CLI is the fourth entrance and is checked alongside each step, because
 * "Portal, CLI, MCP must present the same governance state" is a product rule.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;
const GATEWAY = `${ROOT}src/gateway/main.ts`;

const CLI_SURFACE = "docs-writer";
const MCP_SURFACE = "docs-mcp";

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface Row {
  id: string;
  visibility: string;
  governanceState: string;
}

interface JsonRpcResult {
  result?: { content?: Array<{ text: string }> };
  error?: { code: number; message: string };
}

function rpcEnvelope<T>(body: JsonRpcResult): Envelope<T> {
  return JSON.parse(body.result?.content?.[0]?.text ?? "null") as Envelope<T>;
}

function auth(session: string | null): HeadersInit {
  return session ? { authorization: `Bearer ${session}` } : {};
}

async function cliCatalog(
  catalogPath: string,
  extra: string[],
  env: Record<string, string>,
): Promise<Envelope<Row[]>> {
  const result = await runCli(["catalog", "list", "--catalog", catalogPath, ...extra], env);
  assertEquals(result.code, 0, result.raw || result.stderr);
  return result.stdout as Envelope<Row[]>;
}

async function portalCatalog(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<Row[]> }> {
  const response = await fetch(`${url}/api/catalog`, { headers: auth(session) });
  return { status: response.status, body: await response.json() as Envelope<Row[]> };
}

/** The editorial reading page is where a public surface becomes readable. */
async function portalStory(
  url: string,
  id: string,
  session: string | null,
): Promise<number> {
  const response = await fetch(`${url}/public/s/${id}`, { headers: auth(session) });
  await response.body?.cancel();
  return response.status;
}

async function mcpCatalog(
  url: string,
  session: string | null,
): Promise<Envelope<Row[]>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(session) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "portico_list", arguments: {} },
    }),
  });
  return rpcEnvelope<Row[]>(await response.json() as JsonRpcResult);
}

async function gatewayAuthorize(
  url: string,
  id: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<unknown> }> {
  const response = await fetch(`${url}/gateway/mcp/${id}/authorize`, {
    method: "POST",
    headers: auth(session),
  });
  return { status: response.status, body: await response.json() as Envelope<unknown> };
}

function ids(rows: Row[] | undefined): string[] {
  return (rows ?? []).map((row) => row.id).sort();
}

/** Ids in the order `ids()` reports them, so expectations stay readable. */
function listed(...names: string[]): string[] {
  return [...names].sort();
}

function stateOf(rows: Row[] | undefined, id: string): string | undefined {
  return (rows ?? []).find((row) => row.id === id)?.governanceState;
}

/**
 * Writes the public claim into the record bytes, the way a hand-edit, a
 * restored backup or a direct store write would. The approval trail is left
 * exactly as it is — the point of the test is that the trail, not this field,
 * decides.
 */
async function forgePublicClaim(path: string): Promise<void> {
  const file = JSON.parse(await Deno.readTextFile(path)) as {
    records: Array<Record<string, unknown>>;
    approvals: unknown[];
    changes: unknown[];
  };
  file.records = file.records.map((record) => ({
    ...record,
    visibility: "public",
    governanceState: "approved_public",
  }));
  await Deno.writeTextFile(path, `${JSON.stringify(file, null, 2)}\n`);
}

Deno.test("E2E: a public claim written straight into the store reaches nobody; approval does", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-public-grant-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const gatewayAudit = `${dataDir}/gateway-audit.json`;
  await Deno.mkdir(dataDir, { recursive: true });
  const env = await bootstrapRoster(identities, sessions);

  const maintainer = actor("maintainer", "agent:docs-bot");
  const reader = actor("reader", "human:reader", "human");
  const auditor = actor("auditor", "human:security-auditor", "human");
  const readerSession = sessionFor("human:reader") ?? null;

  for (
    const [name, record] of [
      ["cli", sampleRecord()],
      ["mcp", sampleMcpRecord()],
    ] as const
  ) {
    const input = `${dir}/${name}.json`;
    await Deno.writeTextFile(input, `${JSON.stringify(record, null, 2)}\n`);
    const registered = await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...maintainer,
      "--input",
      input,
    ], env);
    assertEquals(registered.code, 0, registered.raw || registered.stderr);
  }

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
  const gateway = await bootEntrypoint<{ url: string }>(GATEWAY, {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    PORTICO_GATEWAY_AUDIT_PATH: gatewayAudit,
  }, GATEWAY_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;
    const gatewayUrl = gateway.body.data.url;

    // Nothing has been approved: the records only claim to be public.
    await forgePublicClaim(catalog);

    // Anonymous on every entrance: the claim buys nothing, and no entrance
    // reports the surface as public either.
    assertEquals(ids((await cliCatalog(catalog, [], env)).data), []);
    const anonymousPortal = await portalCatalog(portalUrl, null);
    assertEquals(anonymousPortal.status, 200);
    assertEquals(ids(anonymousPortal.body.data), []);
    assertEquals(ids((await mcpCatalog(mcpUrl, null)).data), []);
    assertEquals(await portalStory(portalUrl, MCP_SURFACE, null), 404);
    assertEquals(await portalStory(portalUrl, CLI_SURFACE, null), 404);
    const anonymousRoute = await gatewayAuthorize(gatewayUrl, MCP_SURFACE, null);
    assertEquals(anonymousRoute.status, 404);
    assertEquals(anonymousRoute.body.ok, false);
    assertEquals(anonymousRoute.body.error?.code, "NOT_FOUND");

    // The denial is on the record: refusing is not the same as ignoring.
    const audit = JSON.parse(await Deno.readTextFile(gatewayAudit)) as {
      records: Array<{ surfaceId: string; decision: string }>;
    };
    assertEquals(
      audit.records.some((row) => row.surfaceId === MCP_SURFACE && row.decision === "denied"),
      true,
    );

    // An internal identity sees the same two surfaces on CLI and Portal, and
    // both report the trail's answer — `internal` — not the forged claim.
    const readerCli = await cliCatalog(catalog, reader, env);
    assertEquals(ids(readerCli.data), listed(CLI_SURFACE, MCP_SURFACE));
    assertEquals(stateOf(readerCli.data, MCP_SURFACE), "internal");
    assertEquals(stateOf(readerCli.data, CLI_SURFACE), "internal");
    const readerPortal = await portalCatalog(portalUrl, readerSession);
    assertEquals(readerPortal.status, 200);
    assertEquals(readerPortal.body.data, readerCli.data);

    // The sanctioned path: the maintainer resubmits, a human auditor approves.
    for (const id of [CLI_SURFACE, MCP_SURFACE]) {
      const published = await runCli([
        "catalog",
        "publish",
        "--id",
        id,
        "--visibility",
        "public",
        "--catalog",
        catalog,
        ...maintainer,
      ], env);
      assertEquals(published.code, 0, published.raw || published.stderr);
    }
    const selfApproved = await runCli([
      "catalog",
      "approve",
      "--id",
      MCP_SURFACE,
      "--catalog",
      catalog,
      ...maintainer,
    ], env);
    assertEquals(selfApproved.code !== 0, true);
    for (const id of [CLI_SURFACE, MCP_SURFACE]) {
      const approved = await runCli([
        "catalog",
        "approve",
        "--id",
        id,
        "--catalog",
        catalog,
        ...auditor,
      ], env);
      assertEquals(approved.code, 0, approved.raw || approved.stderr);
    }

    // Now, and only now, every entrance can reach them.
    assertEquals(ids((await cliCatalog(catalog, [], env)).data), listed(CLI_SURFACE, MCP_SURFACE));
    assertEquals(
      stateOf((await cliCatalog(catalog, [], env)).data, MCP_SURFACE),
      "approved_public",
    );
    assertEquals(
      ids((await portalCatalog(portalUrl, null)).body.data),
      listed(CLI_SURFACE, MCP_SURFACE),
    );
    assertEquals(ids((await mcpCatalog(mcpUrl, null)).data), listed(CLI_SURFACE, MCP_SURFACE));
    assertEquals(await portalStory(portalUrl, MCP_SURFACE, null), 200);
    const routed = await gatewayAuthorize(gatewayUrl, MCP_SURFACE, null);
    assertEquals(routed.status, 200, JSON.stringify(routed.body));
    assertEquals(routed.body.ok, true);

    // A human auditor withdraws both: reachability goes away on every entrance.
    for (const id of [CLI_SURFACE, MCP_SURFACE]) {
      const withdrawn = await runCli([
        "catalog",
        "withdraw",
        "--id",
        id,
        "--catalog",
        catalog,
        ...auditor,
      ], env);
      assertEquals(withdrawn.code, 0, withdrawn.raw || withdrawn.stderr);
    }
    assertEquals(ids((await cliCatalog(catalog, [], env)).data), []);
    assertEquals(ids((await mcpCatalog(mcpUrl, null)).data), []);
    assertEquals(await portalStory(portalUrl, MCP_SURFACE, null), 404);
    assertEquals((await gatewayAuthorize(gatewayUrl, MCP_SURFACE, null)).status, 404);

    // Re-forging the bytes cannot undo the withdrawal: the newest trail entry
    // is the one that counts.
    await forgePublicClaim(catalog);
    assertEquals(ids((await cliCatalog(catalog, [], env)).data), []);
    assertEquals(await portalStory(portalUrl, MCP_SURFACE, null), 404);
    assertEquals(await portalStory(portalUrl, CLI_SURFACE, null), 404);
    assertEquals(ids((await portalCatalog(portalUrl, null)).body.data), []);
    assertEquals(ids((await mcpCatalog(mcpUrl, null)).data), []);
    assertEquals((await gatewayAuthorize(gatewayUrl, MCP_SURFACE, null)).status, 404);
    assertEquals(stateOf((await cliCatalog(catalog, reader, env)).data, MCP_SURFACE), "internal");
    assertEquals(stateOf((await cliCatalog(catalog, reader, env)).data, CLI_SURFACE), "internal");
  } finally {
    await Promise.all([portal.stop(), mcp.stop(), gateway.stop()]);
  }
});
