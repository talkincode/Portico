import { assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * The standing verdict is the second half of the append-only trail: the trail
 * says what was concluded and when, this says what that adds up to *now*.
 *
 * One contract, three entrances — CLI `audit standings`, Portal
 * `GET /api/conclusions/standings` (rendered on `/internal/audit`) and MCP
 * `portico_conclusion_standings` — must answer the same auditor with the same
 * answer, because a portal that derives its own opinion is a fourth opinion.
 *
 * Two properties are as much under test as the happy path. The filter is on the
 * standing state, not on history: a flag that was later cleared must not match
 * `verdict=flagged` even though the trail still carries it. And nothing here
 * writes: reading the derived view leaves the conclusion file byte-for-byte
 * unchanged, refusals included.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
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
  gate?: string;
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

async function mcpStandings(
  url: string,
  session: string | null,
  args: Record<string, string> = {},
): Promise<Envelope<StandingRow[]>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "portico_conclusion_standings", arguments: args },
    }),
  });
  return envelope<StandingRow[]>(await response.json() as JsonRpcBody);
}

async function portalStandings(
  url: string,
  session: string | null,
  query = "",
): Promise<{ status: number; body: Envelope<StandingRow[]> }> {
  const response = await fetch(`${url}/api/conclusions/standings${query}`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<StandingRow[]>,
  };
}

async function cliStandings(
  f: Fixture,
  extra: string[],
): Promise<{ code: number; body: Envelope<StandingRow[]> }> {
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
  return { code: result.code, body: result.stdout as Envelope<StandingRow[]> };
}

async function conclude(
  f: Fixture,
  auth: string[],
  extra: string[],
): Promise<{ code: number; body: Envelope<unknown> }> {
  const result = await runCli([
    "audit",
    "conclude",
    "--conclusions",
    f.conclusions,
    "--catalog",
    f.catalog,
    "--identities",
    f.identities,
    ...auth,
    ...extra,
  ], f.env);
  return { code: result.code, body: result.stdout as Envelope<unknown> };
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

/** Roster plus one registered surface the auditor may conclude on. */
async function fixture(): Promise<Fixture> {
  const dir = await Deno.makeTempDir({ prefix: "portico-standings-e2e-" });
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

/** The `<section>` that renders the standing verdicts, not the whole page. */
function standingsPanel(html: string): string {
  const match = html.match(/<section[^>]*data-standings="[^"]*"[\s\S]*?<\/section>/);
  if (!match) throw new Error("the audit page must render a standing-verdict panel");
  return match[0];
}

function sectionTag(panel: string): string {
  return panel.slice(0, panel.indexOf(">") + 1);
}

Deno.test("E2E: standing verdicts match across CLI, Portal and MCP, and reading writes nothing", async () => {
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

    // A boundary contract found flagged, then fixed and cleared: the standing
    // verdict is `cleared`, and the flag stays visible as history.
    const flagged = await conclude(f, f.auditorAuth, [
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
    const cleared = await conclude(f, f.auditorAuth, [
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
    const surface = await conclude(f, f.auditorAuth, [
      "--id",
      "docs-writer",
      "--scope",
      "entry_target",
      "--verdict",
      "cleared",
    ]);
    assertEquals(surface.code, 0, JSON.stringify(surface.body));

    const written = await Deno.readFile(f.conclusions);
    const withSession = [...f.auditorAuth];

    // ── the three entrances agree, field for field ───────────────────────
    const cli = await cliStandings(f, withSession);
    assertEquals(cli.code, 0, JSON.stringify(cli.body));
    const rows = cli.body.data ?? [];
    assertEquals(rows.length, 2);

    const boundary = rows.find((row) => row.subjectId === "boundary:public-redaction")!;
    assertEquals(boundary.verdict, "cleared");
    assertEquals(boundary.previousVerdict, "flagged");
    assertEquals(boundary.count, 2);
    assertEquals(boundary.cleared, 1);
    assertEquals(boundary.flagged, 1);
    assertEquals(boundary.gate, "check:redaction");
    assertEquals(boundary.note, "host name replaced by a placeholder");
    assertEquals(boundary.auditorId, "human:security-auditor");
    assertEquals(boundary.conclusionId, (cleared.body.data as { id: string }).id);

    const portalResult = await portalStandings(portalUrl, f.auditorSession);
    assertEquals(portalResult.status, 200);
    assertEquals(portalResult.body.data, cli.body.data);

    const mcpResult = await mcpStandings(mcpUrl, f.auditorSession);
    assertEquals(mcpResult.ok, true, JSON.stringify(mcpResult));
    assertEquals(mcpResult.data, cli.body.data);

    // ── the filter reads the standing state, not the trail ───────────────
    const stillFlagged = await portalStandings(portalUrl, f.auditorSession, "?verdict=flagged");
    assertEquals(stillFlagged.body.data, []);

    // The trail itself still carries the flag: the two answers differ on
    // purpose, and both are correct for the question they answer.
    const trail = await fetch(`${portalUrl}/api/conclusions?verdict=flagged`, {
      headers: authHeaders(f.auditorSession),
    });
    const trailRows = (await trail.json() as { data?: Array<{ id: string }> }).data ?? [];
    assertEquals(trailRows.length, 1);

    const byScope = await cliStandings(f, [...withSession, "--scope", "entry_target"]);
    assertEquals(byScope.body.data, [rows.find((row) => row.subjectId === "docs-writer")]);
    const bySubject = await mcpStandings(mcpUrl, f.auditorSession, {
      subject: "boundary:public-redaction",
    });
    assertEquals(bySubject.data, [boundary]);

    // ── the same answer is on the page the auditor actually reads ────────
    const page = await fetch(`${portalUrl}/internal/audit`, {
      headers: authHeaders(f.auditorSession),
    });
    assertEquals(page.status, 200);
    const html = await page.text();
    const panel = standingsPanel(html);
    const tag = sectionTag(panel);
    assertEquals(tag.includes(`data-standings="2"`), true, tag);
    assertEquals(tag.includes(`data-flagged="0"`), true, tag);
    assertEquals(
      panel.includes(
        `data-subject="boundary:public-redaction" data-scope="secret_leakage" data-verdict="cleared" data-count="2" data-flagged="1" data-gate="check:redaction"`,
      ),
      true,
      panel,
    );
    // Found-then-fixed must not read like never flagged.
    assertEquals(panel.includes("上一条判定为标记，后来被清除"), true, panel);
    assertEquals(panel.includes("其中 1 次标记"), true, panel);
    assertEquals(panel.includes("仍标记"), false, panel);
    // A read-only surface offers no control that could write a verdict.
    assertEquals(/<(form|input|button|select|textarea)\b/.test(panel), false, panel);

    // ── nothing above wrote anything ────────────────────────────────────
    assertEquals(await Deno.readFile(f.conclusions), written);
    const refusedWrite = await fetch(`${portalUrl}/api/conclusions/standings`, {
      method: "POST",
      headers: authHeaders(f.auditorSession),
    });
    assertEquals(refusedWrite.status, 405);
    assertEquals(
      (await refusedWrite.json() as Envelope<unknown>).error?.code,
      "USAGE",
    );
    assertEquals(await Deno.readFile(f.conclusions), written);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});

Deno.test("E2E: only the auditor reads standing verdicts, and an empty trail is not a pass", async () => {
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

    // No conclusion was ever written: the answer is empty, and the page has to
    // say that instead of showing a clean bill of health.
    const page = await fetch(`${portalUrl}/internal/audit`, {
      headers: authHeaders(f.auditorSession),
    });
    assertEquals(page.status, 200);
    const panel = standingsPanel(await page.text());
    const tag = sectionTag(panel);
    assertEquals(tag.includes(`data-standings="0"`), true, tag);
    assertEquals(panel.includes("还没有留下判定"), true, panel);
    // An empty panel must render no verdict at all: "no verdict recorded" and
    // "verdict cleared" are different answers and must not look alike.
    assertEquals(/data-verdict=/.test(panel), false, panel);
    assertEquals(panel.includes("已清除"), false, panel);
    assertEquals(panel.includes("仍标记"), false, panel);

    // ── maintainers and readers are refused, per entrance ──────────────
    for (
      const [label, session, auth] of [
        ["maintainer", f.maintainerSession, f.maintainerAuth],
        ["reader", f.readerSession, f.readerAuth],
        ["anonymous", null, []],
      ] as const
    ) {
      const cliResult = await cliStandings(f, [...auth]);
      assertEquals(cliResult.code, 1, `${label}: ${JSON.stringify(cliResult.body)}`);
      assertEquals(cliResult.body.error?.code, "FORBIDDEN", label);

      const portalResult = await portalStandings(portalUrl, session);
      assertEquals(portalResult.status, 403, label);
      assertEquals(portalResult.body.error?.code, "FORBIDDEN", label);

      const mcpResult = await mcpStandings(mcpUrl, session);
      assertEquals(mcpResult.ok, false, label);
      assertEquals(mcpResult.error?.code, "FORBIDDEN", label);

      // The page itself stays invisible to a non-auditor.
      const pageResult = await fetch(`${portalUrl}/internal/audit`, {
        headers: authHeaders(session),
      });
      assertEquals(pageResult.status, 404, label);
    }

    // A refused read leaves no conclusion file behind.
    const missing = await Deno.readFile(f.conclusions).then(
      () => false,
      (error) => error instanceof Deno.errors.NotFound,
    );
    assertEquals(missing, true, "reading must not create the conclusion file");
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
