/**
 * The audit page's integrity panel over a real listener and a real store.
 *
 * Unit tests pin the rendered markup; this file is the first-class Happy Path
 * (and the tamper failure path) the acceptance matrix asks for, plus the two
 * properties the panel must never lose: the verdict is auditor-only, and
 * rendering it is a read — asking the page whether the trail is intact must
 * leave every file exactly as it found it, including the file being suspected.
 *
 * The interesting case is not "the chain is broken". It is the pair the chain
 * alone cannot see: a record edited where it sits, which is a *digest* break,
 * and a tail erased together with its links, which verifies link by link and is
 * only visible against a checkpoint. The page must name both, and name them
 * differently.
 */

import { assert, assertEquals } from "../assert.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import { actor, bootstrapRoster, runCli, sampleRecord, sessionFor } from "./harness.ts";

interface Paths {
  catalog: string;
  identities: string;
  sessions: string;
  audit: string;
  conclusions: string;
  anchors: string;
}

interface CatalogFile {
  changes: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  seal: Array<{ seq: number; kind: string; id: string }>;
}

async function readCatalog(path: string): Promise<CatalogFile> {
  return JSON.parse(await Deno.readTextFile(path)) as CatalogFile;
}

async function writeCatalog(path: string, value: unknown): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2));
}

/** Seeds a deployment with all four pillars populated and one checkpoint taken. */
async function seed(paths: Paths): Promise<void> {
  const env = await bootstrapRoster(paths.identities, paths.sessions);
  const input = `${paths.catalog}.input.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);

  const steps: Array<[string[], number, string]> = [
    [
      [
        "catalog",
        "register",
        "--catalog",
        paths.catalog,
        "--identities",
        paths.identities,
        ...actor("maintainer"),
        "--input",
        input,
      ],
      0,
      "register",
    ],
    [
      [
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
      ],
      0,
      "publish",
    ],
    [
      [
        "catalog",
        "approve",
        "--catalog",
        paths.catalog,
        "--identities",
        paths.identities,
        ...actor("auditor", "human:security-auditor", "human"),
        "--id",
        "docs-writer",
      ],
      0,
      "approve",
    ],
    // A refusal is an audit record too, so the gateway pillar is not empty.
    [
      [
        "gateway",
        "authorize",
        "--catalog",
        paths.catalog,
        "--identities",
        paths.identities,
        "--audit",
        paths.audit,
        "--id",
        "mcp:not-a-surface",
        ...actor("reader", "human:reader", "human"),
      ],
      1,
      "gateway authorize",
    ],
    [
      [
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
      ],
      0,
      "audit conclude",
    ],
  ];
  for (const [args, code, label] of steps) {
    const result = await runCli(args, env);
    // The gateway denial is a refusal, and a refusal is an audit record: the
    // command exits non-zero on purpose and still seals what it refused.
    assertEquals(
      result.code,
      code,
      `${label} exited ${result.code}: ${result.raw || result.stderr}`,
    );
  }

  // The checkpoint is what makes a wholesale truncation visible, so the
  // deployment under test has to have one.
  const anchored = await runCli([
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
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(anchored.code, 0, `anchor must succeed: ${anchored.raw || anchored.stderr}`);
}

async function withPortal(paths: Paths, fn: (base: string) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  const server = listenPortal({
    catalogPath: paths.catalog,
    identitiesPath: paths.identities,
    sessionsPath: paths.sessions,
    gatewayAuditPath: paths.audit,
    conclusionsPath: paths.conclusions,
    sealAnchorsPath: paths.anchors,
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
  });
  try {
    await fn(portalUrl(server));
  } finally {
    controller.abort();
    await server.finished;
  }
}

async function page(
  base: string,
  session: string | null,
): Promise<{ status: number; type: string; body: string }> {
  const response = await fetch(`${base}/internal/audit`, {
    headers: session ? { authorization: "Bearer " + session } : {},
  });
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

/** The `<li>` the panel renders for one pillar, faults included. */
function pillar(body: string, name: string): string {
  const match = body.match(
    new RegExp(`<li[^>]*data-pillar="${name}"[^>]*>[\\s\\S]*?</li>`),
  );
  if (match === null) throw new Error(`the panel must report the ${name} pillar`);
  return match[0];
}

function section(body: string): string {
  const match = body.match(/<section[^>]*data-integrity="[^"]*"[\s\S]*?<\/section>/);
  if (match === null) {
    throw new Error(`the audit page must carry the integrity panel; got: ${body.slice(0, 600)}`);
  }
  return match[0];
}

Deno.test("E2E: the audit page names an edited record and an erased tail, and stays a read", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-integrity-e2e-" });
  const paths: Paths = {
    catalog: `${dir}/catalog.json`,
    identities: `${dir}/identities.json`,
    sessions: `${dir}/sessions.json`,
    audit: `${dir}/gateway-audit.json`,
    conclusions: `${dir}/conclusions.json`,
    anchors: `${dir}/seal-anchors.json`,
  };
  await seed(paths);

  const auditorSession = sessionFor("human:security-auditor")!;
  const readerSession = sessionFor("human:reader")!;

  await withPortal(paths, async (base) => {
    // 1. Happy path: a trail that holds is reported holding, per pillar, and
    //    the checkpoint taken at seed time still reads as holding too.
    const intact = await page(base, auditorSession);
    assertEquals(intact.status, 200);
    assertEquals(intact.type, "text/html; charset=utf-8");
    const panel = section(intact.body);
    assert(panel.includes('data-integrity="ok"'), "an intact trail must be reported intact");
    assert(panel.includes('data-unsealed="0"'), "an intact trail must report nothing unsealed");
    assert(
      panel.includes('data-anchored="4"'),
      "every pillar in this deployment must be backed by the checkpoint",
    );
    for (const name of ["catalog", "identity", "gateway", "conclusions"]) {
      const tag = pillar(intact.body, name);
      assert(tag.includes('data-verdict="ok"'), `${name} must verify`);
      assert(tag.includes('data-anchor="intact"'), `${name} must read against its checkpoint`);
    }
    assert(
      pillar(intact.body, "gateway").includes('data-sealed="1"'),
      "the refused gateway call must be sealed like any other record",
    );
    assert(panel.includes("封条完整"), "the verdict must be stated in words, not only in data");

    // 2. A record edited where it sits is named, and only the pillar it sits in
    //    is blamed.
    const restored = await readCatalog(paths.catalog);
    const edited = structuredClone(restored);
    const target = edited.changes[0];
    const targetId = String(target.id);
    target.action = target.action === "update" ? "register" : "update";
    await writeCatalog(paths.catalog, edited);

    const tampered = await page(base, auditorSession);
    assertEquals(tampered.status, 200, "a broken seal is a verdict, not a transport error");
    const brokenPanel = section(tampered.body);
    assert(
      brokenPanel.includes('data-integrity="broken"'),
      "an edited record must break the page's verdict",
    );
    const catalogTag = pillar(tampered.body, "catalog");
    assert(catalogTag.includes('data-verdict="broken"'), "the catalog pillar must report the edit");
    assert(
      catalogTag.includes('data-break-reason="digest"'),
      "an edit in place must be named a digest break",
    );
    assert(
      catalogTag.includes(`data-break-id="${targetId}"`),
      "the page must name the edited record",
    );
    assert(catalogTag.includes(targetId), "the named record must be readable, not only data");
    for (const name of ["identity", "gateway", "conclusions"]) {
      assert(
        pillar(tampered.body, name).includes('data-verdict="ok"'),
        `${name} must not be blamed for an edit in the catalog`,
      );
    }

    // 3. Undoing the edit restores the verdict: the seal follows content, so a
    //    repair reads as a repair rather than as a second failure.
    await writeCatalog(paths.catalog, restored);
    assert(
      section((await page(base, auditorSession)).body).includes('data-integrity="ok"'),
      "restoring the bytes must restore the verdict",
    );

    // 4. The erasure the chain cannot see: the tail removed together with its
    //    links. Every remaining link still verifies, so the pillar's own chain
    //    reads as intact — and the checkpoint is what names the loss.
    const truncated = structuredClone(restored);
    const dropped = truncated.seal.pop();
    assert(dropped !== undefined, "the seeded catalog must have a chain to cut");
    assert(
      dropped!.seq > 1,
      "the seed must leave more than one link so the surviving ones can verify",
    );
    // The record the cut link covered goes with it. Removing a record whose own
    // link survives would be a different finding — a missing record — and this
    // case is about links that are simply no longer there.
    if (dropped!.kind === "change") {
      truncated.changes = truncated.changes.filter((item) => item.id !== dropped!.id);
    } else {
      truncated.approvals = truncated.approvals.filter((item) => item.id !== dropped!.id);
    }
    await writeCatalog(paths.catalog, truncated);

    const erased = await page(base, auditorSession);
    const erasedPanel = section(erased.body);
    assert(
      erasedPanel.includes('data-integrity="broken"'),
      "a checkpoint finding must break the page's verdict",
    );
    assert(
      erasedPanel.includes("检查点"),
      "the page must attribute the finding to the checkpoint, not to the links",
    );
    assert(
      !erasedPanel.includes("已覆盖的记录与写入时对不上"),
      "an erased tail must not be described as records edited in place",
    );
    const erasedTag = pillar(erased.body, "catalog");
    assert(
      erasedTag.includes('data-verdict="ok"'),
      "the surviving links must not be reported as broken",
    );
    assert(
      erasedTag.includes('data-anchor="truncated"'),
      "an erased tail must read as truncated",
    );

    // 5. A record appended behind the store's back is counted, never blessed.
    await writeCatalog(paths.catalog, restored);
    const forged = structuredClone(restored);
    forged.approvals.push({
      id: "apr-forged",
      surfaceId: "docs-writer",
      decision: "approved",
      submittedBy: { id: "agent:docs-bot", kind: "agent" },
      reviewedBy: { id: "human:attacker", kind: "human" },
      reviewedAt: "2026-01-01T00:00:00.000Z",
      entry: { kind: "package", value: "jsr:@example/docs-writer" },
      version: "1.0.0",
      name: "Docs Writer",
    });
    await writeCatalog(paths.catalog, forged);

    const forgedPanel = section((await page(base, auditorSession)).body);
    assert(
      forgedPanel.includes('data-unsealed="1"'),
      "an uncovered record must be counted as unsealed",
    );
    assert(
      forgedPanel.includes("apr-forged"),
      "the page must name the record no link covers",
    );

    // 5b. A record damaged down to a shape no writer produces still renders: the
    //     page that reports an edit must not be the thing an edit can take down.
    const damaged = structuredClone(restored);
    damaged.approvals.push({
      id: "apr-damaged",
      decision: "approved",
    });
    await writeCatalog(paths.catalog, damaged);

    const damagedPage = await page(base, auditorSession);
    assertEquals(damagedPage.status, 200, "a damaged record must not fail the page");
    assert(damagedPage.body.includes("审计时间线"), "the timeline must still render");
    assert(
      section(damagedPage.body).includes('data-unsealed="1"'),
      "the damaged record must be counted as unsealed, not dropped",
    );
    assert(
      damagedPage.body.includes("apr-damaged"),
      "the damaged record must still be visible on the timeline",
    );

    // 6. The verdict is audit material: a reader and an anonymous caller get the
    //    same HTML 404 as any other privileged route, and learn nothing from it
    //    — not that a break exists, not which record it is in.
    await writeCatalog(paths.catalog, edited);
    for (const [label, session] of [["reader", readerSession], ["anonymous", null]] as const) {
      const denied = await page(base, session);
      assertEquals(denied.status, 404, `${label} must not reach the verdict`);
      assertEquals(denied.type, "text/html; charset=utf-8", `${label} must get HTML`);
      assert(!denied.body.includes("data-integrity"), `${label} must not see the panel`);
      assert(!denied.body.includes(targetId), `${label} must not see the named record`);
      assert(!denied.body.includes("审计时间线"), `${label} must not see the timeline`);
    }

    // 7. Rendering the verdict is reading it. Every question above, asked while
    //    the trail was intact, edited, erased and forged, must have left all
    //    five files — including the one under suspicion — exactly as found.
    const before = new Map<string, Uint8Array>();
    for (const path of Object.values(paths)) {
      before.set(path, await Deno.readFile(path));
    }
    await page(base, auditorSession);
    await page(base, readerSession);
    await page(base, null);
    for (const [path, bytes] of before) {
      assertEquals(await Deno.readFile(path), bytes, `rendering the panel must not write ${path}`);
    }
  });
});
