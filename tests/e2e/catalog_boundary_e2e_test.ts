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
 * The catalog-wide boundary sweep is one contract across three entrances: CLI
 * `catalog boundary`, Portal `GET /api/boundary` and MCP `portico_boundary`.
 *
 * A per-record report answers "is this one surface exposed?". This one answers
 * the question an auditor actually signs off on: what is exposed right now,
 * which decision each exposure rests on, and which visible records disagree
 * with the trail in either direction. The sweep must never widen what a role
 * can read — its visible count has to equal that role's own catalog read — and
 * reading it must leave the catalog and the trail byte-identical.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface PublicFaceEntry {
  id: string;
  name: string;
  version: string;
  channels: string[];
  entry: { kind: string; value: string };
  approvedBy: { id: string; kind: string };
  approvedAt: string;
}

interface BoundaryDisagreement {
  id: string;
  name: string;
  claimed: { visibility: string; governanceState: string };
  served: { visibility: string; governanceState: string };
  reachable: boolean;
  decision: string | null;
  mismatch: string;
}

interface BoundarySweepView {
  counts: {
    visible: number;
    public_face: number;
    claimed_public: number;
    approved: number;
    mismatched: number;
  };
  publicFace: PublicFaceEntry[];
  mismatches: BoundaryDisagreement[];
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

async function cliBoundary(
  catalog: string,
  identities: string,
  auth: string[],
): Promise<{ code: number; body: Envelope<BoundarySweepView> }> {
  const result = await runCli([
    "catalog",
    "boundary",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...auth,
  ]);
  return { code: result.code, body: result.stdout as Envelope<BoundarySweepView> };
}

async function portalBoundary(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<BoundarySweepView> }> {
  const response = await fetch(`${url}/api/boundary`, {
    headers: authHeaders(session),
  });
  return {
    status: response.status,
    body: await response.json() as Envelope<BoundarySweepView>,
  };
}

async function mcpBoundary(
  url: string,
  session: string | null,
): Promise<Envelope<BoundarySweepView>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "portico_boundary", arguments: {} },
    }),
  });
  return envelope<BoundarySweepView>(await response.json() as JsonRpcBody);
}

/** Rewrites one record's own bytes, the way a hand edit to the file would. */
async function forgeRecord(
  catalog: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const file = JSON.parse(await Deno.readTextFile(catalog)) as {
    records: Array<{ id: string }>;
  };
  const index = file.records.findIndex((item) => item.id === id);
  assert(index >= 0, `no record '${id}' to forge`);
  file.records[index] = { ...file.records[index], ...patch };
  await Deno.writeTextFile(catalog, JSON.stringify(file));
}

async function catalogList(
  catalog: string,
  identities: string,
  auth: string[],
): Promise<string[]> {
  const result = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...auth,
  ]);
  assertEquals(result.code, 0, result.raw || result.stderr);
  const rows = (result.stdout as Envelope<Array<{ id: string }>>).data ?? [];
  return rows.map((row) => row.id);
}

async function approvalsTrail(
  catalog: string,
  identities: string,
  auth: string[],
): Promise<string> {
  const result = await runCli([
    "catalog",
    "approvals",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...auth,
  ]);
  assertEquals(result.code, 0, result.raw || result.stderr);
  return JSON.stringify(result.stdout);
}

/** Registers a cli surface, a web surface, and a draft; approves the web one. */
async function seedBoundary(dir: string): Promise<{
  catalog: string;
  identities: string;
  sessions: string;
}> {
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
    JSON.stringify({ ...sampleRecord(), id: "docs-draft", name: "Docs Draft" }),
  );

  const maintainer = actor("maintainer");
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
    assertEquals(registered.code, 0, registered.raw || registered.stderr);
  }
  const drafted = await runCli([
    "catalog",
    "draft",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...maintainer,
    "--input",
    draftFile,
  ]);
  assertEquals(drafted.code, 0, drafted.raw || drafted.stderr);

  const audit = actor("auditor", "human:security-auditor", "human");
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
    assertEquals(result.code, 0, result.raw || result.stderr);
  }

  return { catalog, identities, sessions };
}

async function bootBoth(
  catalog: string,
  identities: string,
  sessions: string,
) {
  const env = {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
  };
  return {
    portal: await bootEntrypoint<{ url: string }>(PORTAL, env, PORTAL_PERMS),
    mcp: await bootEntrypoint<{ url: string }>(MCP, env, MCP_PERMS),
  };
}

Deno.test("E2E: the live public face reads the same from every entrance", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-boundary-e2e-" });
  const { catalog, identities, sessions } = await seedBoundary(dir);
  const audit = actor("auditor", "human:security-auditor", "human");
  const maintainer = actor("maintainer");
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

    // ── the auditor reads the boundary from all three entrances ──────────
    const cliAudit = await cliBoundary(catalog, identities, audit);
    const portalAudit = await portalBoundary(portalUrl, auditorSession);
    const mcpAudit = await mcpBoundary(mcpUrl, auditorSession);

    assertEquals(cliAudit.code, 0, JSON.stringify(cliAudit.body));
    assertEquals(portalAudit.status, 200, JSON.stringify(portalAudit.body));
    assertEquals(mcpAudit.ok, true, JSON.stringify(mcpAudit));
    assertEquals(cliAudit.body.data?.counts, {
      visible: 2,
      public_face: 1,
      claimed_public: 1,
      approved: 1,
      mismatched: 0,
    });
    assertEquals(cliAudit.body.data?.mismatches, []);
    assertEquals(portalAudit.body.data, cliAudit.body.data);
    assertEquals(mcpAudit.data, cliAudit.body.data);

    // ── the exposed entry carries the approval it rests on ───────────────
    const face = cliAudit.body.data?.publicFace ?? [];
    assertEquals(face.length, 1);
    assertEquals({
      id: face[0].id,
      name: face[0].name,
      version: face[0].version,
      channels: face[0].channels,
      entry: face[0].entry,
    }, {
      id: "docs-web",
      name: "Docs Web",
      version: "1.0.0",
      channels: ["web"],
      entry: {
        kind: "url",
        value: "https://docs.example.test/portals/docs-writer",
      },
    });
    assertEquals(face[0].approvedBy, {
      id: "human:security-auditor",
      kind: "human",
    });
    assert(
      typeof face[0].approvedAt === "string" && face[0].approvedAt.length > 0,
      "an exposed entry must name when its decision was made",
    );
    assert(
      !face.some((entry) => entry.id === "docs-writer" || entry.id === "docs-draft"),
      "only the approved surface is exposed",
    );

    // ── the maintainer reads the same boundary ───────────────────────────
    const cliMaintainer = await cliBoundary(catalog, identities, maintainer);
    const portalMaintainer = await portalBoundary(portalUrl, maintainerSession);
    const mcpMaintainer = await mcpBoundary(mcpUrl, maintainerSession);

    assertEquals(cliMaintainer.code, 0, JSON.stringify(cliMaintainer.body));
    assertEquals(cliMaintainer.body.data?.publicFace, cliAudit.body.data?.publicFace);
    assertEquals(cliMaintainer.body.data?.mismatches, []);
    assertEquals(cliMaintainer.body.data?.counts.public_face, 1);
    assertEquals(portalMaintainer.body.data, cliMaintainer.body.data);
    assertEquals(mcpMaintainer.data, cliMaintainer.body.data);

    // ── the sweep counts exactly what each role's own read counts ────────
    const auditorSees = await catalogList(catalog, identities, audit);
    const maintainerSees = await catalogList(catalog, identities, maintainer);
    assertEquals(cliAudit.body.data?.counts.visible, auditorSees.length);
    assertEquals(cliMaintainer.body.data?.counts.visible, maintainerSees.length);
    assertEquals(auditorSees.slice().sort(), ["docs-web", "docs-writer"]);
    assert(
      !auditorSees.includes("docs-draft"),
      "an unaudited draft is not part of the audit role's sweep",
    );
    assertEquals(cliMaintainer.body.data?.counts.visible, 3);
    assert(
      !(cliMaintainer.body.data?.publicFace ?? []).some((entry) => entry.id === "docs-draft"),
      "a draft is not part of the public face, not even for its maintainer",
    );

    // ── reader and anonymous are refused by every entrance ───────────────
    const readerCli = await cliBoundary(
      catalog,
      identities,
      actor("reader", "human:reader", "human"),
    );
    assertEquals(readerCli.code, 1);
    assertEquals(readerCli.body.error?.code, "FORBIDDEN");
    assertEquals((await portalBoundary(portalUrl, readerSession)).status, 403);
    assertEquals(
      (await portalBoundary(portalUrl, readerSession)).body.error?.code,
      "FORBIDDEN",
    );
    assertEquals(
      (await mcpBoundary(mcpUrl, readerSession)).error?.code,
      "FORBIDDEN",
    );

    const anonymousCli = await cliBoundary(catalog, identities, []);
    assertEquals(anonymousCli.code, 1);
    assertEquals(anonymousCli.body.error?.code, "FORBIDDEN");
    assertEquals((await portalBoundary(portalUrl, null)).status, 403);
    assertEquals((await mcpBoundary(mcpUrl, null)).error?.code, "FORBIDDEN");

    // ── sweeping the boundary is read-only ──────────────────────────────
    const before = await Deno.readFile(catalog);
    const trailBefore = await approvalsTrail(catalog, identities, audit);
    await catalogList(catalog, identities, audit);
    assertEquals(
      await approvalsTrail(catalog, identities, audit),
      trailBefore,
      "the sweep must not append a decision to the trail",
    );
    assertEquals(
      await Deno.readFile(catalog),
      before,
      "the sweep must not rewrite the catalog",
    );
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});

Deno.test("E2E: a record that disagrees with its trail is reported everywhere", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-boundary-drift-" });
  const { catalog, identities, sessions } = await seedBoundary(dir);
  const audit = actor("auditor", "human:security-auditor", "human");
  const { portal, mcp } = await bootBoth(catalog, identities, sessions);

  try {
    const portalUrl = portal.body.data.url;
    const mcpUrl = mcp.body.data.url;
    const auditorSession = sessionFor("human:security-auditor")!;

    // ── bytes that claim public with nothing approving them ─────────────
    await forgeRecord(catalog, "docs-writer", {
      visibility: "public",
      governanceState: "approved_public",
    });

    const cliClaim = await cliBoundary(catalog, identities, audit);
    const portalClaim = await portalBoundary(portalUrl, auditorSession);
    const mcpClaim = await mcpBoundary(mcpUrl, auditorSession);

    assertEquals(cliClaim.code, 0, JSON.stringify(cliClaim.body));
    assertEquals(cliClaim.body.data?.counts, {
      visible: 2,
      public_face: 1,
      claimed_public: 2,
      approved: 1,
      mismatched: 1,
    });
    assertEquals(cliClaim.body.data?.mismatches, [{
      id: "docs-writer",
      name: "Docs Writer",
      claimed: { visibility: "public", governanceState: "approved_public" },
      served: { visibility: "internal", governanceState: "internal" },
      reachable: false,
      decision: null,
      mismatch: "claimed_public_without_approval",
    }]);
    assertEquals(portalClaim.body.data, cliClaim.body.data);
    assertEquals(mcpClaim.data, cliClaim.body.data);
    assertEquals(
      cliClaim.body.data?.publicFace.map((entry) => entry.id),
      ["docs-web"],
    );

    // The read path never served the forged claim, so the drift is real.
    const anonymousRead = await runCli([
      "catalog",
      "get",
      "--catalog",
      catalog,
      "--identities",
      identities,
      "--id",
      "docs-writer",
    ]);
    assertEquals(anonymousRead.code, 1);
    assertEquals(
      (anonymousRead.stdout as Envelope<unknown>).error?.code,
      "NOT_FOUND",
    );
    const auditorRead = await runCli([
      "catalog",
      "get",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...audit,
      "--id",
      "docs-writer",
    ]);
    assertEquals(auditorRead.code, 0, JSON.stringify(auditorRead.stdout));
    assertEquals(
      (auditorRead.stdout as Envelope<{ visibility: string }>).data?.visibility,
      "internal",
    );

    // ── an approving trail whose record is no longer exposed ────────────
    await forgeRecord(catalog, "docs-writer", {
      visibility: "internal",
      governanceState: "internal",
    });
    await forgeRecord(catalog, "docs-web", {
      visibility: "internal",
      governanceState: "internal",
    });

    const cliReverse = await cliBoundary(catalog, identities, audit);
    const portalReverse = await portalBoundary(portalUrl, auditorSession);
    const mcpReverse = await mcpBoundary(mcpUrl, auditorSession);

    assertEquals(cliReverse.body.data?.counts, {
      visible: 2,
      public_face: 0,
      claimed_public: 0,
      approved: 1,
      mismatched: 1,
    });
    assertEquals(cliReverse.body.data?.publicFace, []);
    assertEquals(cliReverse.body.data?.mismatches, [{
      id: "docs-web",
      name: "Docs Web",
      claimed: { visibility: "internal", governanceState: "internal" },
      served: { visibility: "internal", governanceState: "internal" },
      reachable: false,
      decision: "approved",
      mismatch: "approved_without_public_record",
    }]);
    assertEquals(portalReverse.body.data, cliReverse.body.data);
    assertEquals(mcpReverse.data, cliReverse.body.data);

    // ── a withdrawn trail leaves nothing to reconcile ───────────────────
    // Put the exposure back first: withdrawal is a decision about a surface the
    // trail still approves, and it must settle the drift it was reporting.
    await forgeRecord(catalog, "docs-web", {
      visibility: "public",
      governanceState: "approved_public",
    });
    const withdrawn = await runCli([
      "catalog",
      "withdraw",
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...audit,
      "--id",
      "docs-web",
    ]);
    assertEquals(withdrawn.code, 0, withdrawn.raw || withdrawn.stderr);

    const cliSettled = await cliBoundary(catalog, identities, audit);
    const portalSettled = await portalBoundary(portalUrl, auditorSession);
    const mcpSettled = await mcpBoundary(mcpUrl, auditorSession);

    assertEquals(cliSettled.body.data?.counts, {
      visible: 2,
      public_face: 0,
      claimed_public: 0,
      approved: 0,
      mismatched: 0,
    });
    assertEquals(cliSettled.body.data?.publicFace, []);
    assertEquals(cliSettled.body.data?.mismatches, []);
    assertEquals(portalSettled.body.data, cliSettled.body.data);
    assertEquals(mcpSettled.data, cliSettled.body.data);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});
