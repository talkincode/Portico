import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * One page, two windows: the declaration that keeps them apart.
 *
 * An auditor may read the trail and the standing verdicts as of an instant that
 * is not now, and those readings announce their cutoff. The seal verdict cannot
 * follow them: it re-reads the files as they stand, and there is no stored
 * state of a file to answer a past question from. Put the two side by side on
 * one screen and the risk is specific — the seal's `ok` gets read as the
 * integrity of the instant the trail was sliced at, which is a claim nothing
 * checked.
 *
 * So the rule under test is a declaration, on every entrance: the seal report
 * carries `window: "current"` (CLI, Portal, MCP all render the one payload), the
 * page marks each panel with the window it answers (`data-window`), and a caller
 * who asks the seal for another instant is refused instead of being handed the
 * present. Refusing is the point: a dropped cutoff and a harmless one look
 * identical from the outside.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface SealReportRow {
  window: string;
  ok: boolean;
  unsealed: number;
  anchored: number;
  pillars: Array<{ pillar: string; ok: boolean; sealed: number; unsealed: string[]; tip: string }>;
}

interface JsonRpcBody {
  result?: { content?: Array<{ text: string }> };
}

function envelope<T>(body: JsonRpcBody): Envelope<T> {
  return JSON.parse(body.result?.content?.[0]?.text ?? "null") as Envelope<T>;
}

function authHeaders(session: string | null): HeadersInit {
  return session ? { authorization: `Bearer ${session}` } : {};
}

async function mcpCall<T>(
  url: string,
  session: string | null,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Envelope<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return envelope<T>(await response.json() as JsonRpcBody);
}

async function portalGet<T>(
  url: string,
  path: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${url}${path}`, { headers: authHeaders(session) });
  return { status: response.status, body: await response.json() as Envelope<T> };
}

interface Fixture {
  env: Record<string, string>;
  catalog: string;
  identities: string;
  sessions: string;
  conclusions: string;
  audit: string;
  auditorAuth: string[];
  readerAuth: string[];
  auditorSession: string;
  readerSession: string;
}

/** A trail with something in every pillar: catalog, identity, gateway, verdicts. */
async function fixture(): Promise<Fixture> {
  const dir = await Deno.makeTempDir({ prefix: "portico-window-e2e-" });
  const dataDir = `${dir}/data`;
  await Deno.mkdir(dataDir, { recursive: true });
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const conclusions = `${dataDir}/conclusions.json`;
  const audit = `${dataDir}/gateway-audit.json`;
  const env = await bootstrapRoster(identities, sessions);

  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("maintainer", "agent:docs-bot"),
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 0, JSON.stringify(registered.stdout));
  const published = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("maintainer", "agent:docs-bot"),
    "--id",
    "docs-writer",
    "--visibility",
    "public",
  ], env);
  assertEquals(published.code, 0, JSON.stringify(published.stdout));
  // A refused entry is an audit event too, and it seals the gateway pillar.
  const denied = await runCli([
    "gateway",
    "authorize",
    "--catalog",
    catalog,
    "--identities",
    identities,
    "--audit",
    audit,
    "--id",
    "mcp:not-a-surface",
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(denied.code, 1, JSON.stringify(denied.stdout));
  // A verdict is sealed too: every pillar this report covers holds records.
  const concluded = await runCli([
    "audit",
    "conclude",
    "--conclusions",
    conclusions,
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
    "--scope",
    "public_boundary",
    "--verdict",
    "cleared",
  ], env);
  assertEquals(concluded.code, 0, JSON.stringify(concluded.stdout));

  return {
    env,
    catalog,
    identities,
    sessions,
    conclusions,
    audit,
    auditorAuth: actor("auditor", "human:security-auditor", "human"),
    readerAuth: actor("reader", "human:reader", "human"),
    auditorSession: sessionFor("human:security-auditor")!,
    readerSession: sessionFor("human:reader")!,
  };
}

function auditEnv(f: Fixture): Record<string, string> {
  return {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: f.sessions,
    PORTICO_CONCLUSIONS_PATH: f.conclusions,
    PORTICO_GATEWAY_AUDIT_PATH: f.audit,
  };
}

async function cliVerify(
  f: Fixture,
  extra: string[] = [],
): Promise<{ code: number; body: Envelope<SealReportRow> }> {
  const result = await runCli([
    "audit",
    "verify",
    "--catalog",
    f.catalog,
    "--identities",
    f.identities,
    "--audit",
    f.audit,
    "--conclusions",
    f.conclusions,
    ...f.auditorAuth,
    ...extra,
  ], f.env);
  return { code: result.code, body: result.stdout as Envelope<SealReportRow> };
}

/** The integrity panel, the standing panel and the trail, as rendered. */
function integrityPanel(html: string): string {
  const match = html.match(/<section[^>]*data-integrity="[^"]*"[\s\S]*?<\/section>/);
  assert(match !== null, "the audit page must render an integrity panel");
  return match![0];
}

function standingsPanel(html: string): string {
  const match = html.match(/<section[^>]*data-standings="[^"]*"[\s\S]*?<\/section>/);
  assert(match !== null, "the audit page must render a standing-verdict panel");
  return match![0];
}

function timeline(html: string): string {
  const match = html.match(/<ol[^>]*class="tk-timeline"[^>]*>/);
  assert(match !== null, "the audit page must render the trail");
  return match![0];
}

function openingTag(panel: string): string {
  return panel.slice(0, panel.indexOf(">") + 1);
}

/** One hour before an instant, in the canonical form the trail writes. */
function before(instant: string, minutes = 60): string {
  return new Date(Date.parse(instant) - minutes * 60_000).toISOString();
}

Deno.test("E2E: the seal says it answers the current files, on every entrance", async () => {
  const f = await fixture();
  const portal = await bootEntrypoint<{ url: string }>(PORTAL, auditEnv(f), PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, auditEnv(f), MCP_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;

    // ── one payload, three entrances, and it names its window ────────────
    const cli = await cliVerify(f);
    assertEquals(cli.code, 0, JSON.stringify(cli.body));
    const report = cli.body.data!;
    assertEquals(report.window, "current", JSON.stringify(report));
    assertEquals(report.ok, true, "the seeded trail must be intact");
    assertEquals(report.pillars.length, 4, "all four pillars are configured here");

    const portalReport = await portalGet<SealReportRow>(
      portalUrl,
      "/api/audit-verify",
      f.auditorSession,
    );
    assertEquals(portalReport.status, 200);
    assertEquals(portalReport.body.data, report);

    const mcpReport = await mcpCall<SealReportRow>(
      mcpUrl,
      f.auditorSession,
      "portico_audit_verify",
    );
    assertEquals(mcpReport.ok, true, JSON.stringify(mcpReport));
    assertEquals(mcpReport.data, report);

    // ── the page declares each panel's window ────────────────────────────
    const trail = await runCli([
      "audit",
      "list",
      "--catalog",
      f.catalog,
      "--identities",
      f.identities,
      "--audit",
      f.audit,
      ...f.auditorAuth,
    ], f.env);
    const events = (trail.stdout as Envelope<Array<{ at: string }>>).data ?? [];
    assertEquals(events.length > 0, true, "the fixture must leave a trail");
    const firstAt = events[0].at;
    const beforeEverything = before(firstAt);
    const afterEverything = new Date(Date.now() + 3_600_000).toISOString();

    const catalogBytes = await Deno.readFile(f.catalog);
    const conclusionBytes = await Deno.readFile(f.conclusions);
    const auditBytes = await Deno.readFile(f.audit);

    const currentPage = await fetch(`${portalUrl}/internal/audit`, {
      headers: authHeaders(f.auditorSession),
    });
    assertEquals(currentPage.status, 200);
    const currentHtml = await currentPage.text();
    const currentIntegrity = integrityPanel(currentHtml);
    assertEquals(
      openingTag(currentIntegrity).includes('data-window="current"'),
      true,
      currentIntegrity,
    );
    assertEquals(currentIntegrity.includes("int-integrity__scope"), false, "no window, no note");
    assertEquals(
      openingTag(standingsPanel(currentHtml)).includes('data-window="as-of"'),
      true,
      openingTag(standingsPanel(currentHtml)),
    );
    assertEquals(
      timeline(currentHtml).includes('data-window="as-of"'),
      true,
      timeline(currentHtml),
    );
    assertEquals(timeline(currentHtml).includes("data-asof"), false, timeline(currentHtml));

    // ── a cutoff reaches the verdicts and the trail, not the seal ────────
    const slicedPage = await fetch(
      `${portalUrl}/internal/audit?asOf=${encodeURIComponent(afterEverything)}`,
      { headers: authHeaders(f.auditorSession) },
    );
    assertEquals(slicedPage.status, 200);
    const slicedHtml = await slicedPage.text();
    const slicedIntegrity = integrityPanel(slicedHtml);
    assertEquals(
      openingTag(slicedIntegrity).includes('data-window="current"'),
      true,
      slicedIntegrity,
    );
    assertEquals(slicedIntegrity.includes("int-integrity__scope"), true, slicedIntegrity);
    assertEquals(slicedIntegrity.includes("封条校验没有历史模式"), true, slicedIntegrity);
    assertEquals(
      slicedIntegrity.includes(`<time datetime="${afterEverything}">`),
      true,
      slicedIntegrity,
    );
    assertEquals(
      openingTag(standingsPanel(slicedHtml)).includes(`data-asof="${afterEverything}"`),
      true,
      openingTag(standingsPanel(slicedHtml)),
    );
    assertEquals(
      timeline(slicedHtml).includes(`data-asof="${afterEverything}"`),
      true,
      timeline(slicedHtml),
    );

    // The window moves the reader, never the verdict: the same numbers appear
    // beside a trail that a second cutoff empties out completely.
    const emptyPage = await fetch(
      `${portalUrl}/internal/audit?asOf=${encodeURIComponent(beforeEverything)}`,
      { headers: authHeaders(f.auditorSession) },
    );
    assertEquals(emptyPage.status, 200);
    const emptyHtml = await emptyPage.text();
    assertEquals(emptyHtml.includes("该时刻没有审计事件。"), true, "the trail must read empty");
    const readings = (html: string): string[] =>
      ["integrity", "sealed", "unsealed", "anchored"].map((name) =>
        integrityPanel(html).match(new RegExp(`data-${name}="[^"]*"`))?.[0] ?? name
      );
    assertEquals(readings(slicedHtml), readings(currentHtml));
    assertEquals(readings(emptyHtml), readings(currentHtml));

    // ── nothing above wrote anything ─────────────────────────────────────
    assertEquals(await Deno.readFile(f.catalog), catalogBytes);
    assertEquals(await Deno.readFile(f.conclusions), conclusionBytes);
    assertEquals(await Deno.readFile(f.audit), auditBytes);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});

Deno.test("E2E: the seal refuses a window it cannot answer, and the role gate answers first", async () => {
  const f = await fixture();
  const portal = await bootEntrypoint<{ url: string }>(PORTAL, auditEnv(f), PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, auditEnv(f), MCP_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;
    const cutoff = new Date(Date.now() + 3_600_000).toISOString();
    const catalogBytes = await Deno.readFile(f.catalog);

    // A well-formed instant and an unparseable word get the same answer: this
    // verdict has no historical mode, so there is nothing to correct.
    for (const asOf of [cutoff, "2026-09-21", "yesterday"]) {
      const portalBad = await portalGet<SealReportRow>(
        portalUrl,
        `/api/audit-verify?asOf=${encodeURIComponent(asOf)}`,
        f.auditorSession,
      );
      assertEquals(portalBad.status, 400, asOf);
      assertEquals(portalBad.body.error?.code, "INVALID_INPUT", asOf);

      const cliBad = await cliVerify(f, ["--as-of", asOf]);
      assertEquals(cliBad.code, 1, asOf);
      assertEquals(cliBad.body.error?.code, "INVALID_INPUT", asOf);

      const mcpBad = await mcpCall<SealReportRow>(
        mcpUrl,
        f.auditorSession,
        "portico_audit_verify",
        {
          asOf,
        },
      );
      assertEquals(mcpBad.ok, false, asOf);
      assertEquals(mcpBad.error?.code, "INVALID_INPUT", asOf);
    }

    // ── the gate is answered before the window is judged ─────────────────
    // A caller who may not read the seal must not learn which cutoffs it would
    // have had to correct, nor that its request was about a window at all.
    for (
      const [label, session, auth] of [
        ["reader", f.readerSession, f.readerAuth],
        ["anonymous", null, []],
      ] as const
    ) {
      const portalRefused = await portalGet<SealReportRow>(
        portalUrl,
        `/api/audit-verify?asOf=${encodeURIComponent(cutoff)}`,
        session,
      );
      assertEquals(portalRefused.status, 403, label);
      assertEquals(portalRefused.body.error?.code, "FORBIDDEN", label);

      const cliRefused = await runCli([
        "audit",
        "verify",
        "--catalog",
        f.catalog,
        "--identities",
        f.identities,
        "--audit",
        f.audit,
        "--conclusions",
        f.conclusions,
        ...auth,
        "--as-of",
        cutoff,
      ], f.env);
      assertEquals(cliRefused.code, 1, label);
      assertEquals((cliRefused.stdout as Envelope<unknown>).error?.code, "FORBIDDEN", label);

      const mcpRefused = await mcpCall<SealReportRow>(
        mcpUrl,
        session,
        "portico_audit_verify",
        { asOf: cutoff },
      );
      assertEquals(mcpRefused.error?.code, "FORBIDDEN", label);

      // The page carrying both panels stays invisible to them, cutoff or not.
      const pageRefused = await fetch(
        `${portalUrl}/internal/audit?asOf=${encodeURIComponent(cutoff)}`,
        { headers: authHeaders(session) },
      );
      assertEquals(pageRefused.status, 404, label);
    }

    // The seal is still a read, and refusing a window did not change that.
    const refusedMethod = await fetch(`${portalUrl}/api/audit-verify`, {
      method: "POST",
      headers: authHeaders(f.auditorSession),
    });
    assertEquals(refusedMethod.status, 405);
    assertEquals(await Deno.readFile(f.catalog), catalogBytes);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
