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
 * The audience report is one contract across three entrances: CLI
 * `catalog audience`, Portal `GET /api/audience/<id>` and MCP
 * `portico_audience`. They must agree on what a surface claims, what the read
 * path serves, which decision the trail holds and who that reaches — otherwise
 * a maintainer and an auditor can read the same surface and disagree about
 * whether it is public.
 *
 * The reach of every listed subject is also checked against the ordinary read
 * path for that identity, so the roster view can never drift from the
 * visibility rule. Reading the report writes nothing.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface AudienceSubject {
  id: string;
  kind: string;
  role: string;
  reachable: boolean;
}

interface AudienceReport {
  id: string;
  name: string;
  claimed: { visibility: string; governanceState: string };
  served: { visibility: string; governanceState: string };
  reachable: boolean;
  decision: string | null;
  mismatch: string | null;
  subjects: AudienceSubject[];
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

async function cliAudience(
  catalog: string,
  identities: string,
  auth: string[],
  id: string,
): Promise<{ code: number; body: Envelope<AudienceReport> }> {
  const result = await runCli([
    "catalog",
    "audience",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...auth,
    "--id",
    id,
  ]);
  return { code: result.code, body: result.stdout as Envelope<AudienceReport> };
}

async function portalAudience(
  url: string,
  session: string | null,
  id: string,
): Promise<{ status: number; body: Envelope<AudienceReport> }> {
  const response = await fetch(`${url}/api/audience/${id}`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<AudienceReport>,
  };
}

async function mcpAudience(
  url: string,
  session: string | null,
  id: string,
): Promise<Envelope<AudienceReport>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "portico_audience", arguments: { id } },
    }),
  });
  return envelope<AudienceReport>(await response.json() as JsonRpcBody);
}

Deno.test("E2E: the audience report is one answer from CLI, Portal and MCP", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-audience-e2e-" });
  const dataDir = `${dir}/data`;
  const catalog = `${dataDir}/catalog.json`;
  const identities = `${dataDir}/identities.json`;
  const sessions = `${dataDir}/sessions.json`;
  await bootstrapRoster(identities, sessions);

  const cliFile = `${dir}/cli.json`;
  const webFile = `${dir}/web.json`;
  const draftFile = `${dir}/draft.json`;
  await Deno.writeTextFile(cliFile, JSON.stringify(sampleRecord()));
  await Deno.writeTextFile(webFile, JSON.stringify(sampleWebRecord()));
  await Deno.writeTextFile(
    draftFile,
    JSON.stringify({
      ...sampleRecord(),
      id: "docs-draft",
      name: "Docs Draft",
    }),
  );

  const maintainer = actor("maintainer");
  const audit = actor("auditor", "human:security-auditor", "human");

  for (const file of [cliFile, webFile]) {
    const registered = await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...maintainer,
      "--input",
      file,
    ]);
    assertEquals(registered.code, 0, registered.raw);
  }
  assertEquals(
    (await runCli([
      "catalog",
      "draft",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...maintainer,
      "--input",
      draftFile,
    ])).code,
    0,
  );
  for (const step of ["publish", "approve"]) {
    const result = await runCli([
      "catalog",
      step,
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...(step === "approve" ? audit : maintainer),
      "--id",
      "docs-web",
      ...(step === "publish" ? ["--visibility", "public"] : []),
    ]);
    assertEquals(result.code, 0, result.raw);
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

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;
    const auditorSession = sessionFor("human:security-auditor")!;
    const maintainerSession = sessionFor("agent:docs-bot")!;
    const readerSession = sessionFor("human:reader")!;

    // ── an approved public surface: identical answer from all three ──────
    const cliAudit = await cliAudience(catalog, identities, audit, "docs-web");
    const portalAudit = await portalAudience(portalUrl, auditorSession, "docs-web");
    const mcpAudit = await mcpAudience(mcpUrl, auditorSession, "docs-web");

    assertEquals(cliAudit.code, 0, JSON.stringify(cliAudit.body));
    assertEquals(portalAudit.status, 200, JSON.stringify(portalAudit.body));
    assertEquals(mcpAudit.ok, true, JSON.stringify(mcpAudit));
    assertEquals(cliAudit.body.data?.claimed, {
      visibility: "public",
      governanceState: "approved_public",
    });
    assertEquals(cliAudit.body.data?.served, {
      visibility: "public",
      governanceState: "approved_public",
    });
    assertEquals(cliAudit.body.data?.decision, "approved");
    assertEquals(cliAudit.body.data?.mismatch, null);
    assertEquals(cliAudit.body.data?.reachable, true);
    assertEquals(portalAudit.body.data, cliAudit.body.data);
    assertEquals(mcpAudit.data, cliAudit.body.data);

    // ── the maintainer reads the same boundary ───────────────────────────
    const cliMaintainer = await cliAudience(
      catalog,
      identities,
      maintainer,
      "docs-web",
    );
    const portalMaintainer = await portalAudience(
      portalUrl,
      maintainerSession,
      "docs-web",
    );
    const mcpMaintainer = await mcpAudience(mcpUrl, maintainerSession, "docs-web");

    assertEquals(cliMaintainer.code, 0, JSON.stringify(cliMaintainer.body));
    assertEquals(cliMaintainer.body.data, cliAudit.body.data);
    assertEquals(portalMaintainer.body.data, cliMaintainer.body.data);
    assertEquals(mcpMaintainer.data, cliMaintainer.body.data);

    // ── the roster names the roles it holds, not the ones it echoes ──────
    assertEquals(
      cliAudit.body.data?.subjects.map((subject) => [subject.id, subject.role]),
      [
        ["agent:docs-bot", "maintainer"],
        ["human:auditor", "reader"],
        ["human:docs-owner", "maintainer"],
        ["human:reader", "reader"],
        ["human:security-auditor", "auditor"],
      ],
    );
    assertEquals(
      cliAudit.body.data?.subjects.every((subject) => subject.reachable),
      true,
      "an approved public surface reaches every signed-in identity",
    );

    // ── every declared reach matches that identity's own read path ───────
    for (const subject of cliAudit.body.data?.subjects ?? []) {
      const read = await runCli([
        "catalog",
        "get",
        "--catalog",
        catalog,
        "--identities",
        identities,
        ...actor(subject.role, subject.id, subject.kind),
        "--id",
        "docs-web",
      ]);
      assertEquals(
        read.code === 0,
        subject.reachable,
        `${subject.id} reach disagrees with its own read of docs-web`,
      );
    }

    // ── a draft is not a reportable surface for the audit role ───────────
    const auditorDraft = await cliAudience(
      catalog,
      identities,
      audit,
      "docs-draft",
    );
    assertEquals(auditorDraft.code, 1);
    assertEquals(auditorDraft.body.error?.code, "NOT_FOUND");
    assertEquals(
      (await portalAudience(portalUrl, auditorSession, "docs-draft")).status,
      404,
    );
    assertEquals(
      (await mcpAudience(mcpUrl, auditorSession, "docs-draft")).error?.code,
      "NOT_FOUND",
    );

    const maintainerDraft = await cliAudience(
      catalog,
      identities,
      maintainer,
      "docs-draft",
    );
    assertEquals(maintainerDraft.code, 0, JSON.stringify(maintainerDraft.body));
    assertEquals(maintainerDraft.body.data?.served, {
      visibility: "internal",
      governanceState: "draft",
    });
    assertEquals(maintainerDraft.body.data?.reachable, false);
    assertEquals(maintainerDraft.body.data?.mismatch, null);

    // ── reader and anonymous are refused by every entrance ───────────────
    const readerReport = await cliAudience(
      catalog,
      identities,
      actor("reader", "human:reader", "human"),
      "docs-web",
    );
    assertEquals(readerReport.code, 1);
    assertEquals(readerReport.body.error?.code, "FORBIDDEN");
    assertEquals(
      (await portalAudience(portalUrl, readerSession, "docs-web")).status,
      403,
    );
    assertEquals(
      (await mcpAudience(mcpUrl, readerSession, "docs-web")).error?.code,
      "FORBIDDEN",
    );

    const anonymousReport = await cliAudience(catalog, identities, [], "docs-web");
    assertEquals(anonymousReport.code, 1);
    assertEquals(anonymousReport.body.error?.code, "FORBIDDEN");
    assertEquals((await portalAudience(portalUrl, null, "docs-web")).status, 403);
    assertEquals(
      (await mcpAudience(mcpUrl, null, "docs-web")).error?.code,
      "FORBIDDEN",
    );

    // A refused role learns nothing from naming an id that does not exist.
    const readerMissing = await cliAudience(
      catalog,
      identities,
      actor("reader", "human:reader", "human"),
      "not-registered",
    );
    assertEquals(readerMissing.body.error?.code, "FORBIDDEN");
    const auditorMissing = await cliAudience(
      catalog,
      identities,
      audit,
      "not-registered",
    );
    assertEquals(auditorMissing.body.error?.code, "NOT_FOUND");

    // ── after a withdrawal the boundary reads internal at all entrances ──
    assertEquals(
      (await runCli([
        "catalog",
        "withdraw",
        "--catalog",
        catalog,
        "--identities",
        identities,
        ...audit,
        "--id",
        "docs-web",
      ])).code,
      0,
    );

    const cliWithdrawn = await cliAudience(catalog, identities, audit, "docs-web");
    const portalWithdrawn = await portalAudience(
      portalUrl,
      auditorSession,
      "docs-web",
    );
    const mcpWithdrawn = await mcpAudience(mcpUrl, auditorSession, "docs-web");

    assertEquals(cliWithdrawn.body.data?.claimed, {
      visibility: "internal",
      governanceState: "internal",
    });
    assertEquals(cliWithdrawn.body.data?.served, {
      visibility: "internal",
      governanceState: "internal",
    });
    assertEquals(cliWithdrawn.body.data?.decision, "withdrawn");
    assertEquals(cliWithdrawn.body.data?.mismatch, null);
    assertEquals(cliWithdrawn.body.data?.reachable, false);
    assertEquals(portalWithdrawn.body.data, cliWithdrawn.body.data);
    assertEquals(mcpWithdrawn.data, cliWithdrawn.body.data);
    assert(
      cliWithdrawn.body.data?.subjects.every((subject) => subject.reachable) ===
        true,
      "a withdrawn surface stays readable to signed-in identities",
    );

    // ── reading the boundary is read-only ───────────────────────────────
    const before = await Deno.readFile(catalog);
    const approvalsBefore = await runCli([
      "catalog",
      "approvals",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...audit,
    ]);
    await cliAudience(catalog, identities, audit, "docs-web");
    const approvalsAfter = await runCli([
      "catalog",
      "approvals",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...audit,
    ]);
    assertEquals(approvalsAfter.stdout, approvalsBefore.stdout);
    assert(
      (approvalsBefore.stdout as Envelope<unknown[]>).data?.length === 2,
      "the audience report must not append a decision to the trail",
    );
    assertEquals(
      await Deno.readFile(catalog),
      before,
      "reading the audience report must not rewrite the catalog",
    );
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
