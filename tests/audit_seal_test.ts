import { assert, assertEquals } from "./assert.ts";
import { canonicalJson, sealGenesis, sealRecord, verifySeal } from "../src/audit/seal.ts";

/**
 * The audit trail is append-only by construction: no command updates or
 * deletes a record, so the history an auditor reads is the history the system
 * wrote. That claim says nothing about the bytes on disk, though — every one
 * of these records lives in a JSON file that a process with write access (or
 * anyone with a shell) can edit, and until now nothing could tell an edited
 * trail from an untouched one.
 *
 * These tests pin the seal: each append links the record it covers to the
 * record sealed before it, so an edit, a removal or a reordering inside the
 * sealed history stops verifying and names the record that broke it.
 */

const RECORDS = [
  {
    kind: "grant",
    id: "grt-1",
    record: { id: "grt-1", subjectId: "human:reader", role: "reader" },
  },
  {
    kind: "grant",
    id: "grt-2",
    record: { id: "grt-2", subjectId: "agent:docs-bot", role: "maintainer" },
  },
  {
    kind: "revoke",
    id: "rvk-1",
    record: { id: "rvk-1", subjectId: "human:reader", role: "reader" },
  },
];

type Pillar = "catalog" | "identity" | "gateway" | "conclusions";

async function sealAll(pillar: Pillar) {
  let chain = [] as Awaited<ReturnType<typeof sealRecord>>;
  for (const item of RECORDS) {
    chain = await sealRecord(chain, pillar, item.kind, item.id, item.record);
  }
  return chain;
}

Deno.test("seal canonical form does not depend on key order", () => {
  const left = canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } });
  const right = canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 });
  assertEquals(left, right);
  assertEquals(left, '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
});

Deno.test("seal chain links every record to the one sealed before it", async () => {
  const chain = await sealAll("identity");
  assertEquals(chain.map((entry) => entry.seq), [1, 2, 3]);
  assertEquals(chain.map((entry) => entry.id), ["grt-1", "grt-2", "rvk-1"]);
  assertEquals(chain.map((entry) => entry.kind), ["grant", "grant", "revoke"]);
  assertEquals(chain[0].prev, await sealGenesis("identity"));
  assertEquals(chain[1].prev, chain[0].digest);
  assertEquals(chain[2].prev, chain[1].digest);
  assert(chain[0].digest !== chain[1].digest, "different records must not share a digest");
});

Deno.test("seal digest covers the record it names", async () => {
  const chain = await sealAll("identity");
  const [first] = chain;
  const altered = await sealRecord([], "identity", first.kind, first.id, {
    ...RECORDS[0].record,
    role: "auditor",
  });
  assert(
    altered[0].digest !== first.digest,
    "changing a sealed field must change the digest that covers it",
  );
});

Deno.test("seal chain is bound to its own pillar", async () => {
  const identity = await sealAll("identity");
  const gateway = await sealAll("gateway");
  assert(
    identity[0].prev !== gateway[0].prev,
    "each pillar starts from its own genesis, so a chain cannot be replayed in another file",
  );
  assert(identity[2].digest !== gateway[2].digest);
});

Deno.test("verify accepts an intact chain and reports the tip", async () => {
  const chain = await sealAll("identity");
  const verdict = await verifySeal("identity", chain, RECORDS);
  assertEquals(verdict.ok, true);
  assertEquals(verdict.sealed, 3);
  assertEquals(verdict.unsealed, []);
  assertEquals(verdict.break, undefined);
  assertEquals(verdict.tip, chain[2].digest);
});

Deno.test("verify names the sealed record that was altered", async () => {
  const chain = await sealAll("identity");
  const tampered = RECORDS.map((item) =>
    item.id === "grt-2" ? { ...item, record: { ...item.record, role: "auditor" } } : item
  );
  const verdict = await verifySeal("identity", chain, tampered);
  assertEquals(verdict.ok, false);
  assertEquals(verdict.break?.reason, "digest");
  assertEquals(verdict.break?.id, "grt-2");
  assertEquals(verdict.break?.seq, 2);
  assertEquals(verdict.unsealed, []);
});

Deno.test("verify names a sealed record the store no longer has", async () => {
  const chain = await sealAll("identity");
  const verdict = await verifySeal(
    "identity",
    chain,
    RECORDS.filter((item) => item.id !== "grt-2"),
  );
  assertEquals(verdict.ok, false);
  assertEquals(verdict.break?.reason, "missing");
  assertEquals(verdict.break?.id, "grt-2");
  assertEquals(verdict.break?.seq, 2);
});

Deno.test("verify fails when the chain stops linking", async () => {
  const chain = await sealAll("identity");
  const [first, , third] = chain;
  const verdict = await verifySeal("identity", [first, third], RECORDS);
  assertEquals(verdict.ok, false);
  assertEquals(verdict.break?.reason, "chain");
  assertEquals(verdict.break?.seq, 3);
  assertEquals(verdict.tip, third.digest);
});

Deno.test("verify reports records the chain never covered", async () => {
  const chain = await sealAll("identity");
  const forged = {
    kind: "grant",
    id: "grt-9",
    record: { id: "grt-9", subjectId: "agent:rogue", role: "auditor" },
  };
  const verdict = await verifySeal("identity", chain, [...RECORDS, forged]);
  assertEquals(verdict.sealed, 3);
  assertEquals(verdict.unsealed, ["grt-9"]);
  assertEquals(verdict.tip, chain[2].digest);
});

Deno.test("verify accepts an empty trail and names what is unsealed", async () => {
  const empty = await verifySeal("identity", [], []);
  assertEquals(empty.ok, true);
  assertEquals(empty.sealed, 0);
  assertEquals(empty.tip, await sealGenesis("identity"));

  const legacy = await verifySeal("identity", [], RECORDS);
  assertEquals(legacy.ok, true);
  assertEquals(legacy.sealed, 0);
  assertEquals(legacy.unsealed, ["grt-1", "grt-2", "rvk-1"]);
});
