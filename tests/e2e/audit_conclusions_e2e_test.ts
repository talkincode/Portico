import { assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Security conclusions are one contract across three entrances: CLI
 * `audit conclusions`, Portal `GET /api/conclusions` and MCP
 * `portico_conclusions` must answer the same auditor with the same records.
 *
 * The point of the capability is the role split, so the refusals are as much
 * under test as the happy path: a maintainer cannot write its own verdict, an
 * auditor cannot conclude on a surface it maintains (`SELF_AUDIT`), and an
 * entrance that cannot write must not pretend to. A refused conclusion leaves
 * the conclusion file exactly as it was — no half-written verdict, no catalog
 * event, no dirty maintenance trail.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface ConclusionRow {
  id: string;
  subjectId: string;
  scope: string;
  verdict: string;
  auditorId: string;
  at: string;
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

async function mcpConclusions(
  url: string,
  session: string | null,
  args: Record<string, string> = {},
): Promise<Envelope<ConclusionRow[]>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "portico_conclusions", arguments: args },
    }),
  });
  return envelope<ConclusionRow[]>(await response.json() as JsonRpcBody);
}

async function portalConclusions(
  url: string,
  session: string | null,
  query = "",
): Promise<{ status: number; body: Envelope<ConclusionRow[]> }> {
  const response = await fetch(`${url}/api/conclusions${query}`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<ConclusionRow[]>,
  };
}

async function cliConclusions(
  identities: string,
  catalogPath: string,
  conclusions: string,
  extra: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; body: Envelope<ConclusionRow[]> }> {
  const result = await runCli([
    "audit",
    "conclusions",
    "--conclusions",
    conclusions,
    "--catalog",
    catalogPath,
    "--identities",
    identities,
    ...extra,
  ], env);
  return { code: result.code, body: result.stdout as Envelope<ConclusionRow[]> };
}

interface Fixture {
  env: Record<string, string>;
  catalog: string;
  identities: string;
  sessions: string;
  conclusions: string;
  auditorAuth: string[];
  maintainerAuth: string[];
  readerAuth: string[];
  auditorSession: string;
  maintainerSession: string;
  readerSession: string;
}

/** Roster + two internal surfaces, one of them maintained by the auditor. */
async function fixture(): Promise<Fixture> {
  const dir = await Deno.makeTempDir({ prefix: "portico-conclusions-e2e-" });
  const dataDir = `${dir}/data`;
  await Deno.mkdir(dataDir, { recursive: true });
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  const conclusions = `${dataDir}/conclusions.json`;
  const env = await bootstrapRoster(identities, sessions);

  const owned = {
    ...sampleRecord(),
    id: "auditor-owned-surface",
    name: "Auditor Owned Surface",
    maintainers: [{ id: "human:security-auditor", kind: "human" }],
  };
  for (const [index, record] of [sampleRecord(), owned].entries()) {
    const input = `${dir}/record-${index}.json`;
    await Deno.writeTextFile(input, `${JSON.stringify(record, null, 2)}\n`);
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
  }

  return {
    env,
    catalog,
    identities,
    sessions,
    conclusions,
    auditorAuth: actor("auditor", "human:security-auditor", "human"),
    maintainerAuth: actor("maintainer", "agent:docs-bot"),
    readerAuth: actor("reader", "human:reader", "human"),
    auditorSession: sessionFor("human:security-auditor")!,
    maintainerSession: sessionFor("agent:docs-bot")!,
    readerSession: sessionFor("human:reader")!,
  };
}

async function conclude(
  f: Fixture,
  auth: string[],
  extra: string[],
): Promise<{ code: number; body: Envelope<ConclusionRow> }> {
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
  return { code: result.code, body: result.stdout as Envelope<ConclusionRow> };
}

/** Absent means "no verdict written yet", distinct from an empty file. */
async function conclusionsBytesOrNull(path: string): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

Deno.test("E2E: auditor conclusions match across CLI, Portal and MCP; refusals stay unwritten", async () => {
  const f = await fixture();
  const catalogBefore = await Deno.readFile(f.catalog);

  const portal = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: f.sessions,
    PORTICO_GATEWAY_AUDIT_PATH: `${f.catalog.replace(/catalog\.json$/, "gateway-audit.json")}`,
    PORTICO_CONCLUSIONS_PATH: f.conclusions,
  }, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: f.sessions,
    PORTICO_CONCLUSIONS_PATH: f.conclusions,
  }, MCP_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;

    // ── refusals first: nothing below may create the conclusion file ──────
    assertEquals(await conclusionsBytesOrNull(f.conclusions), null);

    const maintainerWrite = await conclude(f, f.maintainerAuth, [
      "--id",
      "docs-writer",
      "--scope",
      "public_boundary",
      "--verdict",
      "cleared",
    ]);
    assertEquals(maintainerWrite.code, 1);
    assertEquals(maintainerWrite.body.error?.code, "FORBIDDEN");

    const readerWrite = await conclude(f, f.readerAuth, [
      "--id",
      "docs-writer",
      "--scope",
      "public_boundary",
      "--verdict",
      "cleared",
    ]);
    assertEquals(readerWrite.code, 1);
    assertEquals(readerWrite.body.error?.code, "FORBIDDEN");

    const anonymousWrite = await conclude(f, [], [
      "--id",
      "docs-writer",
      "--scope",
      "public_boundary",
      "--verdict",
      "flagged",
      "--note",
      "anonymous claim",
    ]);
    assertEquals(anonymousWrite.code, 1);
    assertEquals(anonymousWrite.body.error?.code, "FORBIDDEN");

    // Self-audit: the auditor maintains `auditor-owned-surface`.
    const selfAudit = await conclude(f, f.auditorAuth, [
      "--id",
      "auditor-owned-surface",
      "--scope",
      "entry_target",
      "--verdict",
      "cleared",
    ]);
    assertEquals(selfAudit.code, 1);
    assertEquals(selfAudit.body.error?.code, "SELF_AUDIT");

    // A flagged verdict with no finding is not a conclusion.
    const unflagged = await conclude(f, f.auditorAuth, [
      "--id",
      "docs-writer",
      "--scope",
      "public_boundary",
      "--verdict",
      "flagged",
    ]);
    assertEquals(unflagged.code, 1);
    assertEquals(unflagged.body.error?.code, "INVALID_INPUT");

    // `密钥只引用，不落明文`: an auditor naming the token it found is refused.
    const leaky = await conclude(f, f.auditorAuth, [
      "--id",
      "docs-writer",
      "--scope",
      "secret_leakage",
      "--verdict",
      "flagged",
      "--note",
      "found AKIANOTAREALEXAMPLE1 in the entry",
    ]);
    assertEquals(leaky.code, 1);
    assertEquals(leaky.body.error?.code, "INVALID_INPUT");

    const unknownSubject = await conclude(f, f.auditorAuth, [
      "--id",
      "no-such-surface",
      "--scope",
      "public_boundary",
      "--verdict",
      "cleared",
    ]);
    assertEquals(unknownSubject.code, 1);
    assertEquals(unknownSubject.body.error?.code, "NOT_FOUND");

    assertEquals(
      await conclusionsBytesOrNull(f.conclusions),
      null,
      "every refusal above must leave the conclusion file unwritten",
    );
    assertEquals(
      await Deno.readFile(f.catalog),
      catalogBefore,
      "a refused verdict must not touch the catalog",
    );

    // ── recording, and re-review appending instead of overwriting ─────────
    const cleared = await conclude(f, f.auditorAuth, [
      "--id",
      "docs-writer",
      "--scope",
      "public_boundary",
      "--verdict",
      "cleared",
    ]);
    assertEquals(cleared.code, 0, JSON.stringify(cleared.body));
    assertEquals(cleared.body.data?.subjectId, "docs-writer");
    assertEquals(cleared.body.data?.scope, "public_boundary");
    assertEquals(cleared.body.data?.verdict, "cleared");
    assertEquals(cleared.body.data?.auditorId, "human:security-auditor");

    const flagged = await conclude(f, f.auditorAuth, [
      "--id",
      "docs-writer",
      "--scope",
      "public_boundary",
      "--verdict",
      "flagged",
      "--note",
      "entry points at a third-party host outside the approved boundary",
    ]);
    assertEquals(flagged.code, 0, JSON.stringify(flagged.body));
    assertEquals(flagged.body.data?.verdict, "flagged");
    assertEquals(flagged.body.data?.note?.includes("third-party host"), true);
    assertEquals(
      flagged.body.data?.id === cleared.body.data?.id,
      false,
      "a re-review must add a record, never reuse the earlier id",
    );

    // ── all three entrances answer the auditor identically ───────────────
    const cli = await cliConclusions(f.identities, f.catalog, f.conclusions, f.auditorAuth, f.env);
    const portalResult = await portalConclusions(portalUrl, f.auditorSession);
    const mcpResult = await mcpConclusions(mcpUrl, f.auditorSession);

    assertEquals(cli.code, 0, JSON.stringify(cli.body));
    assertEquals(portalResult.status, 200);
    assertEquals(mcpResult.ok, true, JSON.stringify(mcpResult));
    assertEquals((cli.body.data ?? []).length, 2, "both verdicts stay readable");
    assertEquals(portalResult.body.data, cli.body.data);
    assertEquals(mcpResult.data, cli.body.data);

    const rows = cli.body.data ?? [];
    assertEquals(
      rows.map((row) => row.verdict),
      ["cleared", "flagged"],
      "conclusions are append-only and keep their order",
    );
    assertEquals(
      Object.keys(rows[0]).sort(),
      ["at", "auditorId", "id", "scope", "subjectId", "verdict"],
    );
    assertEquals(
      Object.keys(rows[1]).sort(),
      ["at", "auditorId", "id", "note", "scope", "subjectId", "verdict"],
    );

    // Filters are the same question at all three entrances.
    const filtered = await cliConclusions(
      f.identities,
      f.catalog,
      f.conclusions,
      [...f.auditorAuth, "--scope", "public_boundary", "--verdict", "flagged"],
      f.env,
    );
    assertEquals(filtered.code, 0);
    assertEquals((filtered.body.data ?? []).length, 1);
    assertEquals(filtered.body.data?.[0].verdict, "flagged");

    const portalFiltered = await portalConclusions(
      portalUrl,
      f.auditorSession,
      "?scope=public_boundary&verdict=flagged",
    );
    assertEquals(portalFiltered.body.data, filtered.body.data);
    const mcpFiltered = await mcpConclusions(mcpUrl, f.auditorSession, {
      scope: "public_boundary",
      verdict: "flagged",
    });
    assertEquals(mcpFiltered.data, filtered.body.data);

    const bySubject = await cliConclusions(
      f.identities,
      f.catalog,
      f.conclusions,
      [...f.auditorAuth, "--subject", "auditor-owned-surface"],
      f.env,
    );
    assertEquals(bySubject.code, 0);
    assertEquals(bySubject.body.data, []);

    // ── readers that may not write ──────────────────────────────────────
    const cliMaintainer = await cliConclusions(
      f.identities,
      f.catalog,
      f.conclusions,
      f.maintainerAuth,
      f.env,
    );
    assertEquals(cliMaintainer.code, 1);
    assertEquals(cliMaintainer.body.error?.code, "FORBIDDEN");
    const portalMaintainer = await portalConclusions(portalUrl, f.maintainerSession);
    assertEquals(portalMaintainer.status, 403);
    assertEquals(portalMaintainer.body.error?.code, "FORBIDDEN");
    const mcpMaintainer = await mcpConclusions(mcpUrl, f.maintainerSession);
    assertEquals(mcpMaintainer.ok, false);
    assertEquals(mcpMaintainer.error?.code, "FORBIDDEN");

    const cliReader = await cliConclusions(
      f.identities,
      f.catalog,
      f.conclusions,
      f.readerAuth,
      f.env,
    );
    assertEquals(cliReader.code, 1);
    assertEquals(cliReader.body.error?.code, "FORBIDDEN");
    const portalReader = await portalConclusions(portalUrl, f.readerSession);
    assertEquals(portalReader.status, 403);
    const mcpReader = await mcpConclusions(mcpUrl, f.readerSession);
    assertEquals(mcpReader.error?.code, "FORBIDDEN");

    const cliAnonymous = await cliConclusions(f.identities, f.catalog, f.conclusions, [], f.env);
    assertEquals(cliAnonymous.code, 1);
    assertEquals(cliAnonymous.body.error?.code, "FORBIDDEN");
    const portalAnonymous = await portalConclusions(portalUrl, null);
    assertEquals(portalAnonymous.status, 403);
    const mcpAnonymous = await mcpConclusions(mcpUrl, null);
    assertEquals(mcpAnonymous.error?.code, "FORBIDDEN");

    // A bad filter is INVALID_INPUT, and the role check still comes first.
    const badFilter = await portalConclusions(portalUrl, f.auditorSession, "?scope=whatever");
    assertEquals(badFilter.body.error?.code, "INVALID_INPUT");
    const badFilterAsMaintainer = await portalConclusions(
      portalUrl,
      f.maintainerSession,
      "?scope=whatever",
    );
    assertEquals(
      badFilterAsMaintainer.body.error?.code,
      "FORBIDDEN",
      "a malformed filter must not answer before the role is checked",
    );
    const badFilterViaCli = await cliConclusions(
      f.identities,
      f.catalog,
      f.conclusions,
      [...f.maintainerAuth, "--scope", "whatever"],
      f.env,
    );
    assertEquals(badFilterViaCli.body.error?.code, "FORBIDDEN");
    const badFilterViaMcp = await mcpConclusions(mcpUrl, f.maintainerSession, {
      scope: "whatever",
    });
    assertEquals(badFilterViaMcp.error?.code, "FORBIDDEN");

    // Recording is CLI-only: the read-only entrances have no write path.
    const posted = await fetch(`${portalUrl}/api/conclusions`, {
      method: "POST",
      headers: authHeaders(f.auditorSession),
    });
    assertEquals(posted.status, 405);
    const postedBody = await posted.json() as Envelope<ConclusionRow[]>;
    assertEquals(postedBody.error?.code, "USAGE");

    const tools = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(f.auditorSession) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const toolNames = ((await tools.json() as {
      result?: { tools?: Array<{ name: string }> };
    }).result?.tools ?? []).map((tool) => tool.name);
    assertEquals(toolNames.includes("portico_conclusions"), true);
    assertEquals(
      toolNames.some((name) => name.includes("conclude") && !name.endsWith("conclusions")),
      false,
      "MCP must not expose a way to write a conclusion",
    );

    // Reading must not rewrite anything, and must not carry session secrets.
    const cliPayload = JSON.stringify(cli.body.data);
    for (const token of [f.auditorSession, f.maintainerSession, f.readerSession]) {
      assertEquals(cliPayload.includes(token), false);
    }
    assertEquals(cliPayload.includes("tokenHash"), false);
    assertEquals(cliPayload.includes("secretHash"), false);
    assertEquals(
      await Deno.readFile(f.catalog),
      catalogBefore,
      "concluding and reading must not rewrite the catalog",
    );
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});

/**
 * Two of the auditor's questions are about the repository itself — the Deno L0
 * runtime boundary and the public-surface redaction rule — and neither has a
 * catalog record to attach a verdict to. They are concluded by id in their own
 * namespace, and the verdict names the gate that answers it, so the sign-off
 * stays tied to evidence that can be re-run at all three entrances.
 */
Deno.test("E2E: a repository boundary conclusion is the same verdict at every entrance", async () => {
  const f = await fixture();
  const catalogBefore = await Deno.readFile(f.catalog);

  const portal = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: f.sessions,
    PORTICO_CONCLUSIONS_PATH: f.conclusions,
  }, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: f.sessions,
    PORTICO_CONCLUSIONS_PATH: f.conclusions,
  }, MCP_PERMS);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;

    // ── refusals: a boundary is not a surface, in either direction ────────
    for (
      const [label, toWrite] of [
        ["a surface question", ["--id", "boundary:runtime-l0", "--scope", "public_boundary"]],
        ["a boundary question", ["--id", "docs-writer", "--scope", "runtime_l0"]],
        ["another contract's question", [
          "--id",
          "boundary:public-redaction",
          "--scope",
          "runtime_l0",
        ]],
      ] as Array<[string, string[]]>
    ) {
      const refused = await conclude(f, f.auditorAuth, [
        ...toWrite,
        "--verdict",
        "cleared",
      ]);
      assertEquals(refused.code, 1, label);
      assertEquals(refused.body.error?.code, "INVALID_INPUT", label);
    }

    // An id that merely looks like a boundary is not one.
    const ghost = await conclude(f, f.auditorAuth, [
      "--id",
      "boundary:ghost",
      "--scope",
      "runtime_l0",
      "--verdict",
      "cleared",
    ]);
    assertEquals(ghost.code, 1);
    assertEquals(ghost.body.error?.code, "NOT_FOUND");

    // The role split is unchanged: a maintainer cannot certify the tree.
    const maintainer = await conclude(f, f.maintainerAuth, [
      "--id",
      "boundary:runtime-l0",
      "--scope",
      "runtime_l0",
      "--verdict",
      "cleared",
    ]);
    assertEquals(maintainer.code, 1);
    assertEquals(maintainer.body.error?.code, "FORBIDDEN");

    assertEquals(await conclusionsBytesOrNull(f.conclusions), null);
    assertEquals(await Deno.readFile(f.catalog), catalogBefore);

    // ── recording a verdict, and re-review appending instead of overwriting
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
    assertEquals(flagged.body.data?.subjectId, "boundary:public-redaction");
    assertEquals(flagged.body.data?.gate, "check:redaction");

    const cleared = await conclude(f, f.auditorAuth, [
      "--id",
      "boundary:runtime-l0",
      "--scope",
      "runtime_l0",
      "--verdict",
      "cleared",
    ]);
    assertEquals(cleared.code, 0, JSON.stringify(cleared.body));
    assertEquals(cleared.body.data?.gate, "check:runtime-boundary");
    assertEquals(
      cleared.body.data?.id === flagged.body.data?.id,
      false,
      "each contract keeps its own record",
    );

    // ── all three entrances answer the auditor identically ───────────────
    const cli = await cliConclusions(
      f.identities,
      f.catalog,
      f.conclusions,
      [...f.auditorAuth, "--subject", "boundary:runtime-l0"],
      f.env,
    );
    assertEquals(cli.code, 0, JSON.stringify(cli.body));
    assertEquals((cli.body.data ?? []).length, 1);
    assertEquals(
      Object.keys(cli.body.data?.[0] ?? {}).sort(),
      ["at", "auditorId", "gate", "id", "scope", "subjectId", "verdict"],
    );

    const portalResult = await portalConclusions(
      portalUrl,
      f.auditorSession,
      "?scope=runtime_l0",
    );
    assertEquals(portalResult.status, 200);
    assertEquals(portalResult.body.data, cli.body.data);

    const mcpResult = await mcpConclusions(mcpUrl, f.auditorSession, { scope: "runtime_l0" });
    assertEquals(mcpResult.ok, true, JSON.stringify(mcpResult));
    assertEquals(mcpResult.data, cli.body.data);

    // Both records stay readable, and the subject filter answers per contract.
    const bothAtPortal = await portalConclusions(portalUrl, f.auditorSession);
    assertEquals((bothAtPortal.body.data ?? []).length, 2);
    const redactionOnly = await mcpConclusions(mcpUrl, f.auditorSession, {
      subject: "boundary:public-redaction",
    });
    assertEquals(redactionOnly.data, [flagged.body.data]);

    // A boundary id is not a catalog record: nothing new appears in the
    // discovery plane, which is what makes it a contract and not an entry.
    const catalogView = await fetch(`${portalUrl}/api/catalog`, {
      headers: authHeaders(f.auditorSession),
    });
    const records = (await catalogView.json() as {
      data?: Array<{ id: string }>;
    }).data ?? [];
    assertEquals(records.map((row) => row.id).sort(), ["auditor-owned-surface", "docs-writer"]);

    // A boundary verdict is an opinion, not a governance event.
    assertEquals(await Deno.readFile(f.catalog), catalogBefore);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});

/**
 * An entrance with no conclusion file configured reports an empty trail, and
 * an anonymous caller of the corpus route learns nothing extra.
 */
Deno.test("E2E: unconfigured conclusion path reports an empty trail", async () => {
  const f = await fixture();
  const portal = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: f.sessions,
  }, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: f.catalog,
    PORTICO_IDENTITIES_PATH: f.identities,
    PORTICO_SESSIONS_PATH: f.sessions,
  }, MCP_PERMS);

  try {
    const portalResult = await portalConclusions(
      portal.body.data.url,
      f.auditorSession,
    );
    assertEquals(portalResult.status, 200);
    assertEquals(portalResult.body.data, []);
    const mcpResult = await mcpConclusions(mcp.body.data.url, f.auditorSession);
    assertEquals(mcpResult.data, []);
    assertEquals(
      await conclusionsBytesOrNull(f.conclusions),
      null,
      "reading must not create the conclusion file",
    );
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
