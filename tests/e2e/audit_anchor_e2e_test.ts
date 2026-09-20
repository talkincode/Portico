import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { SEAL_PILLARS, sealRecord } from "../../src/audit/seal.ts";
import type { SealEntry } from "../../src/audit/seal.ts";
import { actor, bootstrapRoster, ROOT, runCli, sampleRecord, sessionFor } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * Anchoring is one contract on three entrances as well: CLI `audit anchor` /
 * `audit anchors`, Portal `GET /api/seal-anchors` and MCP
 * `portico_seal_anchors` must show the same checkpoints, and `audit verify`
 * must read them on every entrance.
 *
 * The point of the slice is the pair of erasures the seal alone cannot see: a
 * chain rewritten end to end still verifies link by link, and a chain with its
 * tail cut is a shorter but perfectly valid chain. Against a checkpoint taken
 * earlier both become visible, and they get distinct names.
 *
 * Two properties matter beyond the happy path. Taking a checkpoint is a write,
 * so it is auditor-only and the two HTTP entrances must not be able to reach
 * it; and comparing must stay read-only — asking whether the trail was rewritten
 * must never touch the trail.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface SealAnchorLink {
  pillar: string;
  seq: number;
  tip: string;
}

interface SealAnchor {
  id: string;
  at: string;
  auditorId: string;
  links: SealAnchorLink[];
}

interface AnchorComparison {
  state: string;
  seq: number;
  tip: string;
  links: number;
  foundAt?: number;
}

interface SealedPillar {
  pillar: string;
  ok: boolean;
  sealed: number;
  links: number;
  tip: string;
  anchor?: AnchorComparison;
}

interface SealReport {
  ok: boolean;
  anchored: number;
  pillars: SealedPillar[];
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

async function mcpCall(
  url: string,
  name: string,
  session: string | null,
): Promise<Envelope<unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: {} },
    }),
  });
  return envelope<unknown>(await response.json() as JsonRpcBody);
}

async function portalAnchors(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<SealAnchor[]> }> {
  const response = await fetch(`${url}/api/seal-anchors`, { headers: authHeaders(session) });
  return { status: response.status, body: await response.json() as Envelope<SealAnchor[]> };
}

async function portalVerify(
  url: string,
  session: string | null,
): Promise<{ status: number; body: Envelope<SealReport> }> {
  const response = await fetch(`${url}/api/audit-verify`, { headers: authHeaders(session) });
  return { status: response.status, body: await response.json() as Envelope<SealReport> };
}

interface AuditPaths {
  catalog: string;
  identities: string;
  audit: string;
  conclusions: string;
  anchors: string;
}

async function cliVerify(
  paths: AuditPaths,
  as: string[] = [],
): Promise<{ code: number; body: Envelope<SealReport> }> {
  const result = await runCli([
    "audit",
    "verify",
    "--catalog",
    paths.catalog,
    "--identities",
    paths.identities,
    "--audit",
    paths.audit,
    "--conclusions",
    paths.conclusions,
    "--anchors",
    paths.anchors,
    ...as,
  ]);
  return { code: result.code, body: result.stdout as Envelope<SealReport> };
}

async function cliAnchor(
  paths: AuditPaths,
  as: string[],
): Promise<{ code: number; body: Envelope<SealAnchor> }> {
  const result = await runCli([
    "audit",
    "anchor",
    "--catalog",
    paths.catalog,
    "--identities",
    paths.identities,
    "--audit",
    paths.audit,
    "--conclusions",
    paths.conclusions,
    "--anchors",
    paths.anchors,
    ...as,
  ]);
  return { code: result.code, body: result.stdout as Envelope<SealAnchor> };
}

function pillar(report: SealReport | undefined, name: string): SealedPillar {
  const found = (report?.pillars ?? []).find((item) => item.pillar === name);
  if (!found) throw new Error(`report must cover the ${name} pillar`);
  return found;
}

/** Every sealed file, so a read-only claim can be checked byte for byte. */
async function byteSnapshot(paths: AuditPaths): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const [name, path] of Object.entries(paths)) {
    snapshot[name] = await Deno.readTextFile(path).catch(() => "<absent>");
  }
  return snapshot;
}

Deno.test("E2E: a checkpoint exposes a rewritten chain and a cut tail on all three entrances", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-audit-anchor-e2e-" });
  const dataDir = `${dir}/data`;
  const paths: AuditPaths = {
    catalog: `${dataDir}/catalog.json`,
    identities: `${dataDir}/identities.json`,
    audit: `${dataDir}/gateway-audit.json`,
    conclusions: `${dataDir}/conclusions.json`,
    anchors: `${dataDir}/seal-anchors.json`,
  };
  await bootstrapRoster(paths.identities);

  const writerFile = `${dir}/writer.json`;
  await Deno.writeTextFile(writerFile, JSON.stringify(sampleRecord()));
  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      paths.catalog,
      "--identities",
      paths.identities,
      ...actor("maintainer"),
      "--input",
      writerFile,
    ])).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "publish",
      "--catalog",
      paths.catalog,
      "--identities",
      paths.identities,
      ...actor("maintainer"),
      "--id",
      "docs-writer",
      "--visibility",
      "public",
    ])).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "approve",
      "--catalog",
      paths.catalog,
      "--identities",
      paths.identities,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-writer",
    ])).code,
    0,
  );
  assertEquals(
    (await runCli([
      "audit",
      "conclude",
      "--conclusions",
      paths.conclusions,
      "--catalog",
      paths.catalog,
      "--identities",
      paths.identities,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-writer",
      "--scope",
      "public_boundary",
      "--verdict",
      "cleared",
    ])).code,
    0,
  );

  const env = {
    PORTICO_CATALOG_PATH: paths.catalog,
    PORTICO_IDENTITIES_PATH: paths.identities,
    PORTICO_SESSIONS_PATH: paths.identities.replace(/identities\.json$/, "sessions.json"),
    PORTICO_GATEWAY_AUDIT_PATH: paths.audit,
    PORTICO_CONCLUSIONS_PATH: paths.conclusions,
    PORTICO_SEAL_ANCHORS_PATH: paths.anchors,
  };
  const portal = await bootEntrypoint<{ url: string }>(PORTAL, env, PORTAL_PERMS);
  const mcp = await bootEntrypoint<{ url: string }>(MCP, env, MCP_PERMS);
  const portalUrl = portal.body.data.url;
  const mcpUrl = mcp.body.data.url;
  const auditorSession = sessionFor("human:security-auditor")!;
  const auditorAuth = actor("auditor", "human:security-auditor", "human");
  const readerSession = sessionFor("human:reader")!;
  const readerAuth = actor("reader", "human:reader", "human");

  try {
    // 1. Nothing is pinned yet, so nothing is verified: the report must say
    //    that out loud instead of letting an unanchored pillar look checked.
    const before = await cliVerify(paths, auditorAuth);
    assertEquals(before.code, 0);
    assertEquals(before.body.data?.anchored, 0);
    assertEquals(before.body.data?.ok, true);
    assertEquals(pillar(before.body.data, "catalog").anchor, undefined);

    // 2. The auditor pins a checkpoint. It covers every pillar that has a
    //    chain, and it is refused for a non-auditor before anything is written.
    const refused = await cliAnchor(paths, readerAuth);
    assertEquals(refused.code, 1);
    assertEquals(refused.body.error?.code, "FORBIDDEN");
    await assertAbsent(paths.anchors, "a refused checkpoint must not create the anchor file");

    const pinned = await cliAnchor(paths, auditorAuth);
    assertEquals(pinned.code, 0, JSON.stringify(pinned.body));
    const anchor = pinned.body.data!;
    assertEquals(anchor.auditorId, "human:security-auditor");
    // Every pillar is covered, including the one whose file does not exist yet:
    // pinning "nothing has happened here" is what would later expose a whole
    // chain fabricated from scratch instead of a rewrite of an existing one.
    assertEquals(
      anchor.links.map((link) => link.pillar).sort(),
      [...SEAL_PILLARS].sort(),
    );
    const gatewayLink = anchor.links.find((link) => link.pillar === "gateway");
    assertEquals(gatewayLink?.seq, 0);
    for (const link of anchor.links) {
      assert(link.tip.length > 0, `${link.pillar} must pin a tip`);
    }
    assert(
      anchor.links.some((link) => link.seq > 0),
      "a chain that exists must pin a position, not only a digest",
    );

    // 3. Intact: all three entrances compare against the same checkpoint.
    const cliIntact = await cliVerify(paths, auditorAuth);
    assertEquals(cliIntact.body.data?.anchored, anchor.links.length);
    assertEquals(cliIntact.body.data?.ok, true);
    assertEquals(pillar(cliIntact.body.data, "catalog").anchor?.state, "intact");

    const portalIntact = await portalVerify(portalUrl, auditorSession);
    assertEquals(portalIntact.status, 200);
    assertEquals(portalIntact.body.data?.anchored, anchor.links.length);
    assertEquals(pillar(portalIntact.body.data, "catalog").anchor?.state, "intact");

    const mcpIntact = await mcpCall(mcpUrl, "portico_audit_verify", auditorSession) as Envelope<
      SealReport
    >;
    assertEquals(mcpIntact.data?.anchored, anchor.links.length);
    assertEquals(pillar(mcpIntact.data, "catalog").anchor?.state, "intact");

    // 4. The checkpoints themselves are readable on all three entrances, and
    //    only by an auditor.
    const cliList = await runCli([
      "audit",
      "anchors",
      "--anchors",
      paths.anchors,
      "--catalog",
      paths.catalog,
      "--identities",
      paths.identities,
      ...auditorAuth,
    ]);
    assertEquals(cliList.code, 0);
    assertEquals((cliList.stdout as Envelope<SealAnchor[]>).data?.length, 1);
    assertEquals((cliList.stdout as Envelope<SealAnchor[]>).data?.[0].id, anchor.id);

    const portalList = await portalAnchors(portalUrl, auditorSession);
    assertEquals(portalList.status, 200);
    assertEquals(portalList.body.data?.length, 1);
    assertEquals(portalList.body.data?.[0].id, anchor.id);

    const mcpList = await mcpCall(mcpUrl, "portico_seal_anchors", auditorSession) as Envelope<
      SealAnchor[]
    >;
    assertEquals(mcpList.data?.length, 1);
    assertEquals(mcpList.data?.[0].id, anchor.id);

    const portalRefused = await portalAnchors(portalUrl, readerSession);
    assertEquals(portalRefused.status, 403);
    assertEquals(portalRefused.body.error?.code, "FORBIDDEN");
    const mcpRefused = await mcpCall(mcpUrl, "portico_seal_anchors", null);
    assertEquals(mcpRefused.error?.code, "FORBIDDEN");
    // The Portal compares but never pins: a checkpoint is a CLI write.
    const portalWrite = await fetch(`${portalUrl}/api/seal-anchors`, {
      method: "POST",
      headers: authHeaders(auditorSession),
    });
    assertEquals(portalWrite.status, 405);

    // 5. Comparing changes nothing. Every sealed file and the checkpoint file
    //    are byte-identical after all of the above.
    const before2 = await byteSnapshot(paths);
    await cliVerify(paths, auditorAuth);
    await portalVerify(portalUrl, auditorSession);
    await mcpCall(mcpUrl, "portico_audit_verify", auditorSession);
    await portalAnchors(portalUrl, auditorSession);
    assertEquals(await byteSnapshot(paths), before2);

    // 6. A history rewritten end to end re-derives every link *from the
    //    rewritten records*, so the seal alone still says ok: the chain is
    //    internally perfect. Here the timeline is moved — every record gets a
    //    new timestamp — which is exactly the erasure a chain cannot see and a
    //    checkpoint can.
    interface CatalogFile {
      changes: Array<Record<string, unknown> & { id: string; at: string }>;
      approvals: Array<Record<string, unknown> & { id: string; reviewedAt: string }>;
      seal: SealEntry[];
      [key: string]: unknown;
    }
    const file = JSON.parse(await Deno.readTextFile(paths.catalog)) as CatalogFile;
    const original = file.seal;
    const written = original.length;
    assert(written > 1, "the fixture must seal more than one catalog record");
    const originalChanges = file.changes;
    const originalApprovals = file.approvals;

    const shifts = new Map<string, Record<string, unknown>>();
    file.changes = file.changes.map((record, index) => {
      const shifted = { ...record, at: `2020-01-0${(index % 9) + 1}T00:00:00.000Z` };
      shifts.set(`change\u0000${record.id}`, shifted);
      return shifted;
    });
    file.approvals = file.approvals.map((record, index) => {
      const shifted = { ...record, reviewedAt: `2020-02-0${(index % 9) + 1}T00:00:00.000Z` };
      shifts.set(`approval\u0000${record.id}`, shifted);
      return shifted;
    });

    let rewritten: SealEntry[] = [];
    for (const entry of original) {
      const shifted = shifts.get(`${entry.kind}\u0000${entry.id}`);
      assert(shifted, `the rewritten file must still carry ${entry.kind} '${entry.id}'`);
      rewritten = await sealRecord(rewritten, "catalog", entry.kind, entry.id, shifted);
    }
    file.seal = rewritten;
    await Deno.writeTextFile(paths.catalog, JSON.stringify(file, null, 2));

    const cliRewritten = await cliVerify(paths, auditorAuth);
    assertEquals(cliRewritten.body.data?.ok, false);
    const rewrittenPillar = pillar(cliRewritten.body.data, "catalog");
    assertEquals(rewrittenPillar.ok, true, "the seal itself still finds every link consistent");
    assertEquals(rewrittenPillar.anchor?.state, "rewritten");
    assertEquals(rewrittenPillar.anchor?.seq, anchorLinkSeq(anchor, "catalog"));
    assertEquals(rewrittenPillar.links, written);

    const portalRewritten = await portalVerify(portalUrl, auditorSession);
    assertEquals(portalRewritten.body.data?.ok, false);
    assertEquals(pillar(portalRewritten.body.data, "catalog").anchor?.state, "rewritten");

    // 7. Cutting the tail leaves intact links behind: a different erasure, and
    //    therefore a different name.
    file.seal = rewritten.slice(0, written - 1);
    await Deno.writeTextFile(paths.catalog, JSON.stringify(file, null, 2));

    const cliTruncated = await cliVerify(paths, auditorAuth);
    const truncatedPillar = pillar(cliTruncated.body.data, "catalog");
    assertEquals(truncatedPillar.anchor?.state, "truncated");
    assertEquals(truncatedPillar.ok, true, "the remaining links are intact by construction");
    assertEquals(truncatedPillar.links, written - 1);

    // 8. Putting the original records and chain back makes the same checkpoint
    //    read intact again: it pins the history itself, not a file's mtime, so
    //    a tampered copy swapped out is recognised. A second checkpoint then
    //    joins the first instead of replacing it — the evidence of the rewrite
    //    above is never overwritten.
    file.changes = originalChanges;
    file.approvals = originalApprovals;
    file.seal = original;
    await Deno.writeTextFile(paths.catalog, JSON.stringify(file, null, 2));
    const cliRestored = await cliVerify(paths, auditorAuth);
    assertEquals(cliRestored.body.data?.ok, true);
    assertEquals(pillar(cliRestored.body.data, "catalog").anchor?.state, "intact");
    assertEquals(pillar(cliRestored.body.data, "catalog").links, written);

    const second = await cliAnchor(paths, auditorAuth);
    assertEquals(second.code, 0, JSON.stringify(second.body));
    assert(second.body.data!.id !== anchor.id, "a second checkpoint gets its own id");

    const afterSecond = await cliVerify(paths, auditorAuth);
    assertEquals(afterSecond.body.data?.ok, true);
    assertEquals(afterSecond.body.data?.anchored, anchor.links.length);

    const portalRestored = await portalAnchors(portalUrl, auditorSession);
    assertEquals(portalRestored.body.data?.length, 2);
    assertEquals(portalRestored.body.data?.[0].id, anchor.id);
    assertEquals(portalRestored.body.data?.[1].id, second.body.data!.id);
  } finally {
    await portal.stop();
    await mcp.stop();
  }
});

function anchorLinkSeq(anchor: SealAnchor, pillarName: string): number {
  const link = anchor.links.find((item) => item.pillar === pillarName);
  if (!link) throw new Error(`the anchor must cover the ${pillarName} pillar`);
  return link.seq;
}

async function assertAbsent(path: string, message: string): Promise<void> {
  let exists = true;
  try {
    await Deno.stat(path);
  } catch {
    exists = false;
  }
  assert(!exists, message);
}
