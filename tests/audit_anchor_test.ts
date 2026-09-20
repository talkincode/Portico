import { assertEquals, assertRejectsCode } from "./assert.ts";
import { sealGenesis, sealRecord } from "../src/audit/seal.ts";
import type { SealEntry, SealPillar } from "../src/audit/seal.ts";
import {
  compareAnchor,
  compareAnchors,
  FileAnchorStore,
  MemoryAnchorStore,
} from "../src/audit/anchors.ts";
import type { SealAnchor } from "../src/audit/anchors.ts";

/**
 * The seal proves an edit, a removal or a reordering inside a chain. It cannot
 * prove that the whole chain was not rewritten: re-deriving every link from
 * rewritten records produces a chain that verifies perfectly, and cutting the
 * tail leaves the remaining links intact by construction. The only thing that
 * separates "written" from "rewritten" is a copy of the tip taken *before*,
 * in the hands of someone who would notice it changed.
 *
 * An anchor is that copy, kept where the sealed stores cannot reach it:
 * append-only checkpoints of every pillar's tip, written by a human auditor.
 * These tests pin the comparison — an untouched prefix stays `intact` while
 * the chain grows, and the three ways to erase the anchored prefix each get
 * their own name instead of a shared "not found".
 */

const RECORDS = [
  { kind: "grant", id: "grt-1", record: { id: "grt-1", subjectId: "human:reader" } },
  { kind: "grant", id: "grt-2", record: { id: "grt-2", subjectId: "agent:docs-bot" } },
  { kind: "revoke", id: "rvk-1", record: { id: "rvk-1", subjectId: "human:reader" } },
];

async function seal(pillar: SealPillar, count = RECORDS.length): Promise<SealEntry[]> {
  let chain: SealEntry[] = [];
  for (const item of RECORDS.slice(0, count)) {
    chain = await sealRecord(chain, pillar, item.kind, item.id, item.record);
  }
  return chain;
}

function anchorAt(
  pillar: SealPillar,
  chain: readonly SealEntry[],
  at = "2026-09-21T00:00:00.000Z",
): SealAnchor {
  return {
    id: `anc-${at}-0`,
    at,
    auditorId: "human:security-auditor",
    links: [{ pillar, seq: chain.length, tip: connector(chain, pillar) }],
  };
}

/** The tip a chain reports: its last digest, or the genesis when it is empty. */
function connector(chain: readonly SealEntry[], pillar: SealPillar): string {
  if (chain.length === 0) {
    throw new Error(`test anchor needs a non-empty ${pillar} chain`);
  }
  return chain[chain.length - 1].digest;
}

Deno.test("an anchor taken over an untouched chain reads intact at the position it pinned", async () => {
  const chain = await seal("identity");
  const comparison = compareAnchor("identity", chain, anchorAt("identity", chain));
  assertEquals(comparison?.state, "intact");
  assertEquals(comparison?.seq, 3);
  assertEquals(comparison?.tip, chain[2].digest);
  assertEquals(comparison?.links, 3);
  assertEquals(comparison?.foundAt, 3);
});

Deno.test("appending after an anchor keeps the anchored prefix intact", async () => {
  const anchored = await seal("catalog", 3);
  const anchor = anchorAt("catalog", anchored);
  // Three more records land after the checkpoint: normal governance traffic.
  let grown = anchored;
  for (const item of RECORDS) {
    grown = await sealRecord(grown, "catalog", item.kind, item.id, { ...item.record, later: true });
  }
  const comparison = compareAnchor("catalog", grown, anchor);
  assertEquals(comparison?.state, "intact");
  assertEquals(comparison?.seq, 3);
  assertEquals(comparison?.links, 6);
});

Deno.test("a rewritten chain is reported as rewritten, not as missing links", async () => {
  const anchored = await seal("catalog");
  const anchor = anchorAt("catalog", anchored);
  // Same length, different bytes: whoever rewrote it re-derived every link.
  let rewritten: SealEntry[] = [];
  for (const item of ["other-1", "other-2", "other-3"]) {
    rewritten = await sealRecord(rewritten, "catalog", "change", item, { id: item });
  }
  const comparison = compareAnchor("catalog", rewritten, anchor);
  assertEquals(comparison?.state, "rewritten");
  assertEquals(comparison?.seq, 3);
  assertEquals(comparison?.links, 3);
});

Deno.test("cutting the tail is reported as truncated, distinct from a rewrite", async () => {
  const anchored = await seal("identity");
  const anchor = anchorAt("identity", anchored);
  const truncated = anchored.slice(0, 1);
  const comparison = compareAnchor("identity", truncated, anchor);
  assertEquals(comparison?.state, "truncated");
  assertEquals(comparison?.seq, 3);
  assertEquals(comparison?.links, 1);
});

Deno.test("an anchored link that moved is reported with where it sits now", async () => {
  const anchored = await seal("gateway");
  const anchor = anchorAt("gateway", anchored);
  // The anchored tip still exists, but a link was spliced in front of it, so
  // the history it pins is no longer at the position it pinned.
  const inserted = await sealRecord([], "gateway", "record", "late", { id: "late" });
  const moved = [...inserted, ...anchored];
  const comparison = compareAnchor("gateway", moved, anchor);
  assertEquals(comparison?.state, "moved");
  assertEquals(comparison?.seq, 3);
  assertEquals(comparison?.foundAt, 4);
});

Deno.test("a pillar the anchor does not cover has nothing to compare against", async () => {
  const chain = await seal("conclusions");
  const anchor = anchorAt("identity", await seal("identity"));
  assertEquals(compareAnchor("conclusions", chain, anchor), undefined);
  assertEquals(compareAnchor("conclusions", chain, undefined), undefined);
});

Deno.test("an anchor taken over an empty chain does not fail a later chain", async () => {
  const anchor: SealAnchor = {
    id: "anc-empty",
    at: "2026-09-21T00:00:00.000Z",
    auditorId: "human:security-auditor",
    links: [{ pillar: "identity", seq: 0, tip: await sealGenesis("identity") }],
  };
  const comparison = compareAnchor("identity", await seal("identity"), anchor);
  assertEquals(comparison?.state, "intact");
  assertEquals(comparison?.links, 3);
});

Deno.test("comparing a chain against every anchor reports the worst finding", async () => {
  const chain = await seal("identity");
  const older = anchorAt("identity", chain, "2026-09-21T00:00:00.000Z");
  // A newer checkpoint taken after a rewrite: it pins a position the chain
  // still has, holding a link the chain no longer has, while the older one
  // still matches.
  const newer: SealAnchor = {
    id: "anc-rewritten",
    at: "2026-09-21T01:00:00.000Z",
    auditorId: "human:security-auditor",
    links: [{ pillar: "identity", seq: 3, tip: "deadbeef" }],
  };
  const comparison = compareAnchors("identity", chain, [older, newer]);
  assertEquals(comparison?.state, "rewritten");
  assertEquals(comparison?.id, "anc-rewritten");
  // With no finding anywhere, the newest checkpoint is the one reported: it
  // pins the longest prefix, so it is the strongest claim being made.
  const clean = compareAnchors("identity", chain, [
    older,
    { ...newer, links: [{ pillar: "identity", seq: 2, tip: chain[1].digest }] },
  ]);
  assertEquals(clean?.state, "intact");
  assertEquals(clean?.id, "anc-rewritten");
});

Deno.test("the anchor store appends checkpoints and never replaces one", async () => {
  const store = new MemoryAnchorStore();
  const first = anchorAt("identity", await seal("identity"), "2026-09-21T00:00:00.000Z");
  await store.append(first);
  await store.append({ ...first, id: "anc-second", at: "2026-09-21T02:00:00.000Z" });
  assertEquals((await store.list()).map((item) => item.id), [first.id, "anc-second"]);
  await assertRejectsCode(() => store.append(first), "ALREADY_EXISTS");
  assertEquals((await store.list()).length, 2);
});

Deno.test("the file anchor store round-trips and starts empty when absent", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/seal-anchors.json`;
  const store = new FileAnchorStore(path);
  assertEquals(await store.list(), []);

  const anchor = anchorAt("identity", await seal("identity"));
  await store.append(anchor);
  const reopened = new FileAnchorStore(path);
  assertEquals(await reopened.list(), [anchor]);
  await assertRejectsCode(() => reopened.append(anchor), "ALREADY_EXISTS");
  assertEquals((await reopened.list()).length, 1);
  await Deno.remove(dir, { recursive: true });
});
