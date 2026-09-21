import { assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Time slicing: the audit as of an instant that is not now.
 *
 * The trail is append-only and the standing view is derived from it, which
 * makes a second question answerable without a second store: what did this look
 * like *then*. Nothing is written to answer it — the past is read by reading
 * less of the same sealed file, so a historical answer cannot drift from the
 * evidence it is derived from the way a snapshot table could.
 *
 * What is really under test here is the refusal of the silent substitution. A
 * cutoff must name an instant with a zone; a bare day or a wall clock would
 * mean the machine choosing a zone and answering a slightly different question
 * than the one asked, and the reader could not tell. An unusable cutoff is an
 * error, never a quiet fall back to "now" — a wrong window looks exactly like a
 * right one. And a window with no records in it is an empty answer, never a
 * clean bill of health: "no verdict had been recorded yet" must not read as
 * "everything passed".
 *
 * One contract, three entrances: CLI `audit list --as-of` / `audit standings
 * --as-of`, Portal `GET /api/audit`, `GET /api/conclusions`,
 * `GET /api/conclusions/standings` and the `/internal/audit` form (all reading
 * `asOf`), and MCP `portico_audit` / `portico_conclusions` /
 * `portico_conclusion_standings`. The same cutoff must produce the same answer
 * on all of them, and the HTML view must *say* it is historical, because a
 * reconstructed verdict that does not announce its window reads like today's.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface TrailRow {
  id: string;
  at: string;
  kind: string;
  action: string;
  subjectId: string;
  summary: string;
}

interface StandingRow {
  subjectId: string;
  scope: string;
  verdict: string;
  conclusionId: string;
  auditorId: string;
  at: string;
  previousVerdict?: string;
  count: number;
  cleared: number;
  flagged: number;
  note?: string;
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

/** One hour before an instant, in the canonical form the trail writes. */
function before(instant: string, minutes = 60): string {
  return new Date(Date.parse(instant) - minutes * 60_000).toISOString();
}

interface Fixture {
  env: Record<string, string>;
  catalog: string;
  identities: string;
  conclusions: string;
  auditorAuth: string[];
  maintainerAuth: string[];
  readerAuth: string[];
  auditorSession: string;
  maintainerSession: string;
  readerSession: string;
}

/** Roster plus one registered surface, the same ground the other audit E2E uses. */
async function fixture(): Promise<Fixture> {
  const dir = await Deno.makeTempDir({ prefix: "portico-timeslice-e2e-" });
  const dataDir = `${dir}/data`;
  await Deno.mkdir(dataDir, { recursive: true });
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const env = await bootstrapRoster(identities, sessions);

  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer", "agent:docs-bot", "agent"),
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 0, JSON.stringify(registered.stdout));

  return {
    env,
    catalog,
    identities,
    conclusions: `${dataDir}/conclusions.json`,
    auditorAuth: actor("auditor", "human:security-auditor", "human"),
    maintainerAuth: actor("maintainer", "agent:docs-bot"),
    readerAuth: actor("reader", "human:reader", "human"),
    auditorSession: sessionFor("human:security-auditor")!,
    maintainerSession: sessionFor("agent:docs-bot")!,
    readerSession: sessionFor("human:reader")!,
  };
}

async function cliTrail(f: Fixture, extra: string[]): Promise<Envelope<TrailRow[]>> {
  const result = await runCli([
    "audit",
    "list",
    "--catalog",
    f.catalog,
    "--identities",
    f.identities,
    ...extra,
  ], f.env);
  return result.stdout as Envelope<TrailRow[]>;
}

async function cliStandings(f: Fixture, extra: string[]): Promise<Envelope<StandingRow[]>> {
  const result = await runCli([
    "audit",
    "standings",
    "--conclusions",
    f.conclusions,
    "--catalog",
    f.catalog,
    "--identities",
    f.identities,
    ...extra,
  ], f.env);
  return result.stdout as Envelope<StandingRow[]>;
}

async function conclude(
  f: Fixture,
  extra: string[],
): Promise<{ code: number; body: Envelope<{ id: string; at: string }> }> {
  const result = await runCli([
    "audit",
    "conclude",
    "--conclusions",
    f.conclusions,
    "--catalog",
    f.catalog,
    "--identities",
    f.identities,
    ...f.auditorAuth,
    ...extra,
  ], f.env);
  return { code: result.code, body: result.stdout as Envelope<{ id: string; at: string }> };
}

/** The `<section>` that renders the standing verdicts, not the whole page. */
function standingsPanel(html: string): string {
  const match = html.match(/<section[^>]*data-standings="[^"]*"[\s\S]*?<\/section>/);
  if (!match) throw new Error("the audit page must render a standing-verdict panel");
  return match[0];
}

function sectionTag(panel: string): string {
  return panel.slice(0, panel.indexOf(">") + 1);
}

Deno.test("E2E: a cutoff reconstructs the audit of that instant, and says that it is historical", async () => {
  const f = await fixture();
  const portal = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: `${f.catalog.replace(/catalog\.json$/, "sessions.json")}`,
    PORTICO_CONCLUSIONS_PATH: f.conclusions,
  }, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: `${f.catalog.replace(/catalog\.json$/, "sessions.json")}`,
    PORTICO_CONCLUSIONS_PATH: f.conclusions,
  }, MCP_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;
    const auth = [...f.auditorAuth];

    // The trail already exists before the register the fixture performed:
    // bootstrap granted the roster. Both instants are read off the trail
    // itself, never invented, so the cutoffs below sit on real record
    // timestamps rather than on a clock this test would be guessing at.
    const bootstrapped = await cliTrail(f, auth);
    const grants = bootstrapped.data ?? [];
    assertEquals(grants.length > 0, true, JSON.stringify(bootstrapped));
    const firstAt = grants[0].at;
    const beforeEverything = before(firstAt);

    const afterRegister = (await cliTrail(f, auth)).data ?? [];
    const register = afterRegister.find((event) => event.action === "register");
    assertEquals(register !== undefined, true, JSON.stringify(afterRegister));
    const registeredAt = register!.at;

    // Two verdicts on one subject, one after the other: the reconstruction has
    // to be able to show the first while the second is what stands today.
    const flagged = await conclude(f, [
      "--id",
      "boundary:public-redaction",
      "--scope",
      "secret_leakage",
      "--verdict",
      "flagged",
      "--note",
      "one tracked file still names the deployment host",
    ]);
    assertEquals(flagged.code, 0, JSON.stringify(flagged.body));
    const flaggedAt = flagged.body.data!.at;
    const cleared = await conclude(f, [
      "--id",
      "boundary:public-redaction",
      "--scope",
      "secret_leakage",
      "--verdict",
      "cleared",
      "--note",
      "host name replaced by a placeholder",
    ]);
    assertEquals(cleared.code, 0, JSON.stringify(cleared.body));
    const clearedAt = cleared.body.data!.at;
    assertEquals(clearedAt > flaggedAt, true, `${flaggedAt} then ${clearedAt}`);

    const written = await Deno.readFile(f.conclusions);
    const catalogBytes = await Deno.readFile(f.catalog);

    // ── the same cutoff, the same answer, on all three entrances ─────────
    const cliThen = await cliStandings(f, [...auth, "--as-of", flaggedAt]);
    assertEquals(cliThen.ok, true, JSON.stringify(cliThen));
    assertEquals(cliThen.data?.length, 1);
    const [then] = cliThen.data!;
    assertEquals(then.verdict, "flagged");
    assertEquals(then.conclusionId, flagged.body.data!.id);
    assertEquals(then.count, 1);
    assertEquals(then.flagged, 1);
    assertEquals(then.cleared, 0);
    assertEquals(then.previousVerdict, undefined);
    assertEquals(then.note, "one tracked file still names the deployment host");

    const portalThen = await portalGet<StandingRow[]>(
      portalUrl,
      `/api/conclusions/standings?asOf=${encodeURIComponent(flaggedAt)}`,
      f.auditorSession,
    );
    assertEquals(portalThen.status, 200);
    assertEquals(portalThen.body.data, cliThen.data);

    const mcpThen = await mcpCall<StandingRow[]>(
      mcpUrl,
      f.auditorSession,
      "portico_conclusion_standings",
      {
        asOf: flaggedAt,
      },
    );
    assertEquals(mcpThen.ok, true, JSON.stringify(mcpThen));
    assertEquals(mcpThen.data, cliThen.data);

    // The trail reads the same window: as of the first verdict, the first
    // verdict is all there was.
    const cliTrailThen = await cliTrail(f, [...auth, "--as-of", flaggedAt]);
    assertEquals(
      (cliTrailThen.data ?? []).map((event) => event.id).includes(register!.id),
      true,
    );
    const conclusionsThen = await portalGet<Array<{ id: string }>>(
      portalUrl,
      `/api/conclusions?asOf=${encodeURIComponent(flaggedAt)}`,
      f.auditorSession,
    );
    assertEquals(conclusionsThen.body.data?.map((record) => record.id), [flagged.body.data!.id]);

    // ── the boundary is inclusive, and today is one point on the line ────
    const cliNow = await cliStandings(f, [...auth, "--as-of", clearedAt]);
    assertEquals(cliNow.data, (await cliStandings(f, auth)).data);
    assertEquals(cliNow.data?.[0].verdict, "cleared");
    assertEquals(cliNow.data?.[0].previousVerdict, "flagged");
    assertEquals(cliNow.data?.[0].count, 2);
    // An instant after the last record is the same answer as no cutoff at all:
    // the slice reads the trail, it does not interpolate between records.
    const distant = await cliStandings(f, [...auth, "--as-of", "2030-01-01T00:00:00Z"]);
    assertEquals(distant.data, cliNow.data);

    // ── a window with nothing in it is empty, not "all clear" ────────────
    const beforeCli = await cliStandings(f, [...auth, "--as-of", beforeEverything]);
    assertEquals(beforeCli.data, []);
    const beforePortal = await portalGet<StandingRow[]>(
      portalUrl,
      `/api/conclusions/standings?asOf=${encodeURIComponent(beforeEverything)}`,
      f.auditorSession,
    );
    assertEquals(beforePortal.body.data, []);
    // No conclusion had been recorded as of the register either: the two
    // questions are answered from one derivation, not two stores.
    const asOfRegister = await cliStandings(f, [...auth, "--as-of", registeredAt]);
    assertEquals(asOfRegister.data, []);

    // The maintenance trail slices too, and the register is later than the
    // roster it landed beside.
    assertEquals((await cliTrail(f, [...auth, "--as-of", beforeEverything])).data, []);
    const earlyTrail = (await cliTrail(f, [...auth, "--as-of", firstAt])).data ?? [];
    assertEquals(earlyTrail.map((event) => event.id).includes(register!.id), false);
    assertEquals(
      (await cliTrail(f, [...auth, "--as-of", registeredAt])).data?.map((event) => event.id)
        .includes(register!.id),
      true,
    );
    const trailThenPortal = await portalGet<TrailRow[]>(
      portalUrl,
      `/api/audit?asOf=${encodeURIComponent(firstAt)}`,
      f.auditorSession,
    );
    assertEquals(
      trailThenPortal.body.data?.map((event) => event.id),
      earlyTrail.map((event) => event.id),
    );
    const trailThenMcp = await mcpCall<TrailRow[]>(mcpUrl, f.auditorSession, "portico_audit", {
      asOf: firstAt,
    });
    assertEquals(trailThenMcp.data?.map((event) => event.id), earlyTrail.map((event) => event.id));

    // ── the page a human reads announces its window ──────────────────────
    const thenPage = await fetch(
      `${portalUrl}/internal/audit?asOf=${encodeURIComponent(flaggedAt)}`,
      { headers: authHeaders(f.auditorSession) },
    );
    assertEquals(thenPage.status, 200);
    const thenHtml = await thenPage.text();
    const thenPanel = standingsPanel(thenHtml);
    const thenTag = sectionTag(thenPanel);
    assertEquals(thenTag.includes(`data-asof="${flaggedAt}"`), true, thenTag);
    assertEquals(thenPanel.includes("当时判定"), true, thenPanel);
    assertEquals(thenPanel.includes("当前判定"), false, thenPanel);
    assertEquals(
      thenPanel.includes(`读取窗口：截至 <time datetime="${flaggedAt}">`),
      true,
      thenPanel,
    );
    // The verdict that stood then was a flag, which is exactly what today's
    // panel no longer shows for this subject.
    assertEquals(
      thenPanel.includes(
        `data-subject="boundary:public-redaction" data-scope="secret_leakage" data-verdict="flagged" data-count="1" data-flagged="1"`,
      ),
      true,
      thenPanel,
    );
    assertEquals(thenPanel.includes("仍标记"), true, thenPanel);
    // The form carries the cutoff, so the reader can see and change the window
    // they are looking through.
    assertEquals(thenHtml.includes(`name="asOf" value="${flaggedAt}"`), true, thenHtml);
    assertEquals(thenHtml.includes("回到当前窗口"), true, thenHtml);

    const nowPage = await fetch(`${portalUrl}/internal/audit`, {
      headers: authHeaders(f.auditorSession),
    });
    const nowPanel = standingsPanel(await nowPage.text());
    assertEquals(sectionTag(nowPanel).includes("data-asof"), false, sectionTag(nowPanel));
    assertEquals(nowPanel.includes("当前判定"), true, nowPanel);
    assertEquals(nowPanel.includes("当时判定"), false, nowPanel);
    assertEquals(nowPanel.includes("回到当前窗口"), false, nowPanel);
    assertEquals(nowPanel.includes("仍标记"), false, nowPanel);

    // "Back to the present" drops the window and nothing else.
    const clearHref = thenHtml.match(/int-filters__reset" href="([^"]+)"/)![1];
    const clearPage = await fetch(`${portalUrl}${clearHref.replaceAll("&amp;", "&")}`, {
      headers: authHeaders(f.auditorSession),
    });
    assertEquals(clearPage.status, 200);
    assertEquals(standingsPanel(await clearPage.text()).includes("当前判定"), true);

    // A window before the trail even starts says so, on both surfaces of the
    // page: the trail and the verdicts.
    const emptyPage = await fetch(
      `${portalUrl}/internal/audit?asOf=${encodeURIComponent(beforeEverything)}`,
      { headers: authHeaders(f.auditorSession) },
    );
    assertEquals(emptyPage.status, 200);
    const emptyHtml = await emptyPage.text();
    assertEquals(emptyHtml.includes("该时刻没有审计事件。"), true);
    assertEquals(emptyHtml.includes("该时刻没有审计结论。"), true);
    // An empty historical panel must not read as a pass, and must not borrow
    // the wording of "nothing was ever concluded".
    assertEquals(emptyHtml.includes("还没有留下判定"), false);

    // ── nothing above wrote anything ────────────────────────────────────
    assertEquals(await Deno.readFile(f.conclusions), written);
    assertEquals(await Deno.readFile(f.catalog), catalogBytes);

    const refusedMethod = await fetch(
      `${portalUrl}/api/conclusions/standings?asOf=${encodeURIComponent(flaggedAt)}`,
      { method: "POST", headers: authHeaders(f.auditorSession) },
    );
    assertEquals(refusedMethod.status, 405);
    assertEquals(await Deno.readFile(f.conclusions), written);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});

Deno.test("E2E: an unusable cutoff is refused everywhere, and the role gate is answered first", async () => {
  const f = await fixture();
  const portal = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: `${f.catalog.replace(/catalog\.json$/, "sessions.json")}`,
    PORTICO_CONCLUSIONS_PATH: f.conclusions,
  }, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: `${f.catalog.replace(/catalog\.json$/, "sessions.json")}`,
    PORTICO_CONCLUSIONS_PATH: f.conclusions,
  }, MCP_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;

    const flagged = await conclude(f, [
      "--id",
      "docs-writer",
      "--scope",
      "entry_target",
      "--verdict",
      "flagged",
      "--note",
      "entry serves a placeholder host that is not this deployment's",
    ]);
    assertEquals(flagged.code, 0, JSON.stringify(flagged.body));
    const written = await Deno.readFile(f.conclusions);

    // A day, a wall clock and a word are all refused: the machine will not pick
    // a zone for the caller, and it will not read a broken value as "now".
    for (const unusable of ["2026-09-21", "2026-09-21T00:00:00", "yesterday", "now"]) {
      const cliTrailBad = await runCli([
        "audit",
        "list",
        "--catalog",
        f.catalog,
        "--identities",
        f.identities,
        ...f.auditorAuth,
        "--as-of",
        unusable,
      ], f.env);
      assertEquals(cliTrailBad.code, 1, unusable);
      assertEquals(
        (cliTrailBad.stdout as Envelope<unknown>).error?.code,
        "INVALID_INPUT",
        unusable,
      );

      const cliBad = await cliStandings(f, [...f.auditorAuth, "--as-of", unusable]);
      assertEquals(cliBad.error?.code, "INVALID_INPUT", unusable);

      const portalBad = await portalGet<StandingRow[]>(
        portalUrl,
        `/api/conclusions/standings?asOf=${encodeURIComponent(unusable)}`,
        f.auditorSession,
      );
      assertEquals(portalBad.status, 400, unusable);
      assertEquals(portalBad.body.error?.code, "INVALID_INPUT", unusable);

      const mcpBad = await mcpCall<StandingRow[]>(
        mcpUrl,
        f.auditorSession,
        "portico_conclusion_standings",
        { asOf: unusable },
      );
      assertEquals(mcpBad.ok, false, unusable);
      assertEquals(mcpBad.error?.code, "INVALID_INPUT", unusable);
    }

    // A date that does not exist is refused rather than rolled into the next
    // month, where the caller would never see the substitution.
    for (
      const rollover of ["2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-09-21T24:00:00Z"]
    ) {
      const cliBad = await cliStandings(f, [...f.auditorAuth, "--as-of", rollover]);
      assertEquals(cliBad.error?.code, "INVALID_INPUT", rollover);
    }

    // The trail, the conclusions list and the HTML page refuse it too.
    for (
      const path of [
        `/api/audit?asOf=2026-09-21`,
        `/api/conclusions?asOf=2026-09-21`,
        `/internal/audit?asOf=2026-09-21`,
      ]
    ) {
      const refused = await portalGet<unknown>(portalUrl, path, f.auditorSession);
      assertEquals(refused.status, 400, path);
      assertEquals(refused.body.error?.code, "INVALID_INPUT", path);
    }
    const trailBadMcp = await mcpCall<TrailRow[]>(mcpUrl, f.auditorSession, "portico_audit", {
      asOf: "2026-09-21",
    });
    assertEquals(trailBadMcp.error?.code, "INVALID_INPUT");
    const conclusionsBadMcp = await mcpCall<unknown>(
      mcpUrl,
      f.auditorSession,
      "portico_conclusions",
      {
        asOf: "2026-02-30",
      },
    );
    assertEquals(conclusionsBadMcp.error?.code, "INVALID_INPUT");

    // ── the gate is answered before the grammar is corrected ─────────────
    // A caller who may not read the audit must not be able to probe which
    // cutoff forms parse, so the refusal is the role's, not the filter's.
    for (
      const [label, session, auth] of [
        ["maintainer", f.maintainerSession, f.maintainerAuth],
        ["reader", f.readerSession, f.readerAuth],
        ["anonymous", null, []],
      ] as const
    ) {
      const cliRefused = await cliStandings(f, [...auth, "--as-of", "yesterday"]);
      assertEquals(cliRefused.error?.code, "FORBIDDEN", label);

      const portalRefused = await portalGet<unknown>(
        portalUrl,
        "/api/conclusions/standings?asOf=yesterday",
        session,
      );
      assertEquals(portalRefused.status, 403, label);
      assertEquals(portalRefused.body.error?.code, "FORBIDDEN", label);

      const mcpRefused = await mcpCall<unknown>(
        mcpUrl,
        session,
        "portico_conclusion_standings",
        { asOf: "yesterday" },
      );
      assertEquals(mcpRefused.error?.code, "FORBIDDEN", label);

      // The page stays invisible, cutoff or not.
      const pageRefused = await fetch(`${portalUrl}/internal/audit?asOf=yesterday`, {
        headers: authHeaders(session),
      });
      assertEquals(pageRefused.status, 404, label);
    }

    // Every refusal above left the trail exactly as it was.
    assertEquals(await Deno.readFile(f.conclusions), written);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
