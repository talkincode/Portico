/**
 * The seal: an append-only digest chain over the records a store appends.
 *
 * Every governance record in Portico is append-only *by construction* — there
 * is no command that updates or deletes one — but each one lives in a JSON
 * file that a process holding write access, or anyone with a shell, can edit.
 * "Append-only" therefore described the API and said nothing about the bytes.
 * The seal closes that gap without changing what is stored: when a store
 * appends a record it also appends a link that covers that record and points
 * at the link before it, so an edit, a removal or a reordering inside the
 * sealed history stops verifying and names the record that broke it.
 *
 * What this proves, and what it does not, is the reason the verdict carries
 * more than a boolean:
 *
 * - Covered records are pinned. Changing a field, deleting a record or cutting
 *   a link out of the middle is reported by name and position.
 * - A record the chain never covered is *unsealed*, not trusted: the verdict
 *   lists it, so a record inserted behind the store's back, or written before
 *   sealing existed at all, is visible instead of silently blessed.
 * - Truncation of the tail cannot be seen from inside the file — the remaining
 *   chain is still perfectly intact. Detecting it needs the tip digest to have
 *   been recorded somewhere else, which is why every verdict reports one.
 *
 * Chains are bound to a pillar so a seal cannot be replayed into another file,
 * and every digest is computed over a canonical form so that re-serializing a
 * record with different key order does not read as tampering.
 */

/** Files whose appends are sealed. One chain per pillar. */
export type SealPillar = "catalog" | "identity" | "gateway" | "conclusions";

export const SEAL_PILLARS: readonly SealPillar[] = [
  "catalog",
  "identity",
  "gateway",
  "conclusions",
];

/** One link: the record it covers, and the link it follows. */
export interface SealEntry {
  /** 1-based position in the chain. */
  seq: number;
  /** Record kind inside its pillar (`change`, `approval`, `grant`, ...). */
  kind: string;
  /** Record id inside its pillar. */
  id: string;
  /** Digest over `prev`, `kind`, `id` and the canonical record. */
  digest: string;
  /** Previous entry's digest, or this pillar's genesis digest at `seq` 1. */
  prev: string;
}

export interface SealBreak {
  seq: number;
  kind: string;
  id: string;
  /** `chain` = link cut or reordered, `digest` = record altered, `missing` = record gone. */
  reason: "chain" | "digest" | "missing";
}

export interface SealVerdict {
  pillar: SealPillar;
  /** The sealed history is intact; `unsealed` records are out of its reach. */
  ok: boolean;
  /** Records this chain covers. */
  sealed: number;
  /** Records present in the store that no link covers, in store order. */
  unsealed: string[];
  /** First break found, in chain order. */
  break?: SealBreak;
  /** Digest of the last link (or the genesis, for a chain with no links). */
  tip: string;
}

/** A copy of a chain, safe to hand to a caller that must not mutate the store's. */
export function cloneSeal(chain: readonly SealEntry[]): SealEntry[] {
  return chain.map((entry) => ({ ...entry }));
}

/** A record to verify: the kind and id the chain names, plus the record itself. */
export interface SealedRecord {
  kind: string;
  id: string;
  record: unknown;
}

/**
 * Deterministic JSON: object keys sorted, no whitespace, `undefined` dropped.
 *
 * Key order is not content. Storage round-trips and additions like the seal
 * itself rewrite objects with whatever order the writer happened to use, so a
 * digest taken over `JSON.stringify` would report tampering for a record that
 * was merely re-serialized.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${
    fields.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")
  }}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The digest a pillar's first link points back to. */
export function sealGenesis(pillar: SealPillar): Promise<string> {
  return sha256Hex(`portico-seal:${pillar}`);
}

async function linkDigest(
  prev: string,
  kind: string,
  id: string,
  record: unknown,
): Promise<string> {
  return await sha256Hex(`${prev}\n${kind}\n${id}\n${canonicalJson(record)}`);
}

/** Appends the link that covers `record`. Returns a new chain. */
export async function sealRecord(
  chain: readonly SealEntry[],
  pillar: SealPillar,
  kind: string,
  id: string,
  record: unknown,
): Promise<SealEntry[]> {
  const last = chain[chain.length - 1];
  const prev = last ? last.digest : await sealGenesis(pillar);
  const digest = await linkDigest(prev, kind, id, record);
  return [...chain, { seq: chain.length + 1, kind, id, digest, prev }];
}

function recordKey(kind: string, id: string): string {
  return `${kind}\u0000${id}`;
}

/**
 * Recomputes the chain against the records the store currently holds.
 *
 * Reports the *first* break in chain order and keeps walking, so the tip is
 * always the digest the caller can compare against an outside record of it.
 */
export async function verifySeal(
  pillar: SealPillar,
  chain: readonly SealEntry[],
  records: readonly SealedRecord[],
): Promise<SealVerdict> {
  const present = new Map(records.map((item) => [recordKey(item.kind, item.id), item.record]));
  const covered = new Set<string>();
  let prev = await sealGenesis(pillar);
  let firstBreak: SealBreak | undefined;

  for (const entry of chain) {
    const key = recordKey(entry.kind, entry.id);
    covered.add(key);
    if (!firstBreak) {
      if (entry.prev !== prev) {
        firstBreak = { seq: entry.seq, kind: entry.kind, id: entry.id, reason: "chain" };
      } else if (!present.has(key)) {
        firstBreak = { seq: entry.seq, kind: entry.kind, id: entry.id, reason: "missing" };
      } else {
        const expected = await linkDigest(prev, entry.kind, entry.id, present.get(key));
        if (expected !== entry.digest) {
          firstBreak = { seq: entry.seq, kind: entry.kind, id: entry.id, reason: "digest" };
        }
      }
    }
    prev = entry.digest;
  }

  const unsealed = records
    .filter((item) => !covered.has(recordKey(item.kind, item.id)))
    .map((item) => item.id);

  const verdict: SealVerdict = {
    pillar,
    ok: firstBreak === undefined,
    sealed: covered.size,
    unsealed,
    tip: prev,
  };
  if (firstBreak) verdict.break = firstBreak;
  return verdict;
}
