/**
 * Anchors: checkpoints of the sealed tips, so a chain that was rewritten
 * wholesale or cut at the tail cannot pass as the original one.
 *
 * The seal (`./seal.ts`) proves what happened *inside* a chain — an edit, a
 * removal, a splice each stop verifying and name the record — and it has one
 * documented edge, because a chain is self-contained. Whoever holds write
 * access can re-derive every link over rewritten records and the result
 * verifies perfectly; whoever cuts the tail leaves a shorter chain that is
 * still intact. Nothing inside those bytes separates the original from the
 * rewrite, so `audit verify` reports each pillar's tip and leaves the
 * comparison to the auditor reading it.
 *
 * An anchor moves that comparison into the system. A human auditor takes a
 * checkpoint that records every pillar's tip and position, and every later
 * verify asks whether the anchored link is still the link at that position.
 * Appending is normal governance traffic and stays `intact`, so a checkpoint
 * does not expire; the three ways to erase an anchored prefix get their own
 * names — `truncated` (fewer links than were pinned), `rewritten` (the pinned
 * link is gone) and `moved` (the pinned link survives at another position, so
 * whatever sits in front of it changed).
 *
 * Where the checkpoint is kept decides what it can do, and that limit belongs
 * in the open as much as the seal's own. An anchor is taken through the same
 * CLI, by the same user, on the same disk as the pillars, so anyone who can
 * rewrite a chain can also delete the checkpoint that would expose them: what
 * the anchor buys is that the rewrite must now touch a second file, and that
 * the checkpoint is small, ordered and meant to be copied out. Quoted outside
 * Portico — in a report, an operations log — a chain that no longer matches it
 * becomes a finding instead of an invisible rewrite. The store is append-only
 * for the same reason the pillars are: nothing here is ever corrected in
 * place, so a checkpoint that has been taken stays readable as evidence that
 * the tip used to be that value.
 */

import { type Actor, assertActor, CatalogError, ErrorCode } from "../catalog/mod.ts";
import { serialize, writeJsonFile } from "../fs.ts";
import type { SealEntry, SealPillar } from "./seal.ts";

/**
 * How the chain stands against a checkpoint. `intact` covers both "unchanged"
 * and "appended to", because those are the same claim: the anchored prefix is
 * still there. There is deliberately no state for "no checkpoint covers this
 * pillar" — that is the *absence* of a comparison, reported separately, so an
 * unanchored pillar cannot be read as a verified one.
 */
export const ANCHOR_STATES = ["intact", "moved", "truncated", "rewritten"] as const;

export type AnchorState = (typeof ANCHOR_STATES)[number];

/** One pillar's tip, and the position in the chain it sat at. */
export interface SealAnchorLink {
  pillar: SealPillar;
  /** Number of links the chain had; the anchored tip is the link at this position. */
  seq: number;
  tip: string;
}

/** One checkpoint: all pillars at one instant, so tips are compared as a set. */
export interface SealAnchor {
  id: string;
  at: string;
  /** The human auditor who took the checkpoint. */
  auditorId: string;
  links: SealAnchorLink[];
}

export interface AnchorComparison {
  state: AnchorState;
  /** Checkpoint this reading came from. */
  id: string;
  at: string;
  /** Position the checkpoint pinned. */
  seq: number;
  /** The tip the checkpoint recorded. */
  tip: string;
  /** Links in the chain now. */
  links: number;
  /** Where the anchored link sits now, when it still exists. */
  foundAt?: number;
}

export interface AnchorStore {
  /** Append-only. Implementations must refuse a duplicate id, never replace. */
  append(anchor: SealAnchor): Promise<void>;
  /** Every checkpoint, in the order it was taken. */
  list(): Promise<SealAnchor[]>;
}

function cloneAnchor(anchor: SealAnchor): SealAnchor {
  return {
    id: anchor.id,
    at: anchor.at,
    auditorId: anchor.auditorId,
    links: anchor.links.map((link) => ({ ...link })),
  };
}

export class MemoryAnchorStore implements AnchorStore {
  #anchors: SealAnchor[] = [];

  append(anchor: SealAnchor): Promise<void> {
    if (this.#anchors.some((item) => item.id === anchor.id)) {
      return Promise.reject(
        new CatalogError(ErrorCode.ALREADY_EXISTS, `anchor '${anchor.id}' already exists`),
      );
    }
    this.#anchors.push(cloneAnchor(anchor));
    return Promise.resolve();
  }

  list(): Promise<SealAnchor[]> {
    return Promise.resolve(this.#anchors.map(cloneAnchor));
  }
}

interface AnchorFile {
  anchors: SealAnchor[];
}

export class FileAnchorStore implements AnchorStore {
  constructor(private readonly path: string) {}

  append(anchor: SealAnchor): Promise<void> {
    return serialize(this.path, () => this.#appendImpl(anchor));
  }

  async #appendImpl(anchor: SealAnchor): Promise<void> {
    const file = await this.#load();
    if (file.anchors.some((item) => item.id === anchor.id)) {
      throw new CatalogError(ErrorCode.ALREADY_EXISTS, `anchor '${anchor.id}' already exists`);
    }
    file.anchors.push(cloneAnchor(anchor));
    await writeJsonFile(this.path, { anchors: file.anchors });
  }

  async list(): Promise<SealAnchor[]> {
    return (await this.#load()).anchors.map(cloneAnchor);
  }

  async #load(): Promise<AnchorFile> {
    try {
      const parsed = JSON.parse(await Deno.readTextFile(this.path)) as Partial<AnchorFile>;
      if (!parsed || !Array.isArray(parsed.anchors)) {
        throw new Error(`anchor file is corrupt: ${this.path}`);
      }
      return { anchors: parsed.anchors.map(cloneAnchor) };
    } catch (error) {
      // An absent file is an empty store, not a failure: a deployment that has
      // never taken a checkpoint is the normal first state, and it must be
      // distinguishable from a checkpoint that went missing only by the
      // comparison being absent.
      if (error instanceof Deno.errors.NotFound) return { anchors: [] };
      throw error;
    }
  }
}

/**
 * Reads one chain against one checkpoint.
 *
 * Returns nothing when the checkpoint does not cover this pillar, so an
 * anchor taken before a pillar existed cannot report on it.
 */
export function compareAnchor(
  pillar: SealPillar,
  chain: readonly SealEntry[],
  anchor?: SealAnchor,
): AnchorComparison | undefined {
  const link = anchor?.links.find((item) => item.pillar === pillar);
  if (!anchor || !link) return undefined;

  const comparison: AnchorComparison = {
    state: "intact",
    id: anchor.id,
    at: anchor.at,
    seq: link.seq,
    tip: link.tip,
    links: chain.length,
  };
  // A checkpoint over an empty chain pinned nothing, so every later chain is
  // an append to it rather than a replacement.
  if (link.seq === 0) return comparison;

  const found = chain.findIndex((entry) => entry.digest === link.tip);
  if (found === -1) {
    // Shorter than what was pinned means the tail is gone; the same length or
    // longer means the links that were there are gone instead.
    comparison.state = chain.length < link.seq ? "truncated" : "rewritten";
    return comparison;
  }
  comparison.foundAt = found + 1;
  if (comparison.foundAt !== link.seq) comparison.state = "moved";
  return comparison;
}

const SEVERITY: Record<AnchorState, number> = {
  intact: 0,
  moved: 1,
  truncated: 2,
  rewritten: 3,
};

/**
 * Reads one chain against every checkpoint that covers it.
 *
 * Any checkpoint with a finding is a finding: an older checkpoint still
 * matching does not excuse a newer one being erased. Among readings of equal
 * severity the newest wins, because it pins the longest prefix and is
 * therefore the strongest claim the store was making.
 */
export function compareAnchors(
  pillar: SealPillar,
  chain: readonly SealEntry[],
  anchors: readonly SealAnchor[],
): AnchorComparison | undefined {
  let chosen: AnchorComparison | undefined;
  for (const anchor of anchors) {
    const comparison = compareAnchor(pillar, chain, anchor);
    if (!comparison) continue;
    if (!chosen || SEVERITY[comparison.state] >= SEVERITY[chosen.state]) chosen = comparison;
  }
  return chosen;
}

function stamp(at: string): string {
  return at.replaceAll(/[^0-9]/g, "");
}

/**
 * Millisecond timestamps are not fine enough to keep ids unique: two
 * checkpoints taken inside one millisecond would collide, and the store
 * refuses a duplicate id outright rather than replacing a checkpoint. The
 * sequence keeps ids unique within the process.
 */
let idSequence = 0;

function nextSequence(): string {
  idSequence += 1;
  return idSequence.toString(36);
}

export function anchorId(at: string): string {
  return `anc-${stamp(at)}-${nextSequence()}`;
}

/** Builds the checkpoint payload from tips the caller has already read. */
export function buildAnchor(
  actor: Actor,
  tips: readonly { pillar: SealPillar; seq: number; tip: string }[],
  at = new Date().toISOString(),
): SealAnchor {
  assertActor(actor);
  return {
    id: anchorId(at),
    at,
    auditorId: actor.id,
    links: tips.map((item) => ({ pillar: item.pillar, seq: item.seq, tip: item.tip })),
  };
}
