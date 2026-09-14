/**
 * Shared design primitives.
 *
 * Both surfaces render the same governance vocabulary — a chip always means the
 * same thing whether it appears in the internal console or on the public page.
 * Only density and voice differ, and those live in the surface templates.
 */

import type { AgentSurface, Channel, EntryRef, GovernanceState } from "../../catalog/types.ts";
import { CHANNEL_LABEL, CHANNEL_NOTE, type Mode, STATE_LABEL, stateAttr } from "./tokens.ts";

/** Escape untrusted text for HTML text and attribute positions. */
export function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Governance-state chip. The single source of truth for "what state is this". */
export function stateChip(state: GovernanceState, opts: { compact?: boolean } = {}): string {
  const pending = state === "pending_public";
  const classes = ["tk-chip", "tk-chip--state"];
  if (pending) classes.push("tk-chip--pending");
  const label = opts.compact && state === "approved_public" ? "公开" : STATE_LABEL[state];
  return `<span class="${classes.join(" ")}" data-state="${stateAttr(state)}">${esc(label)}</span>`;
}

/** Channel chip, e.g. `CLI` / `MCP` / `Web`. */
export function channelChip(channel: Channel): string {
  return `<span class="tk-chip tk-chip--channel" data-channel="${esc(channel)}">${
    esc(CHANNEL_LABEL[channel])
  }</span>`;
}

export function channelChips(channels: readonly Channel[]): string {
  return [...channels].sort().map(channelChip).join("");
}

/** `<dt>/<dd>` pair for a definition list. */
export function dl(label: string, value: string): string {
  return `<dt>${esc(label)}</dt><dd>${value}</dd>`;
}

/**
 * Render an authorized entry for display.
 *
 * Only an approved `http(s)` URL becomes a link, and only when the surface is
 * actually public — an internal record must not hand out a clickable target.
 * Package coordinates are shown as inert code: Portico never turns a registry
 * coordinate into a download.
 */
export function entryValue(entry: EntryRef, opts: { linkable: boolean }): string {
  if (entry.kind === "url" && opts.linkable && isHttpUrl(entry.value)) {
    const safe = esc(entry.value);
    return `<a class="tk-link" href="${safe}" rel="noopener noreferrer nofollow">${safe}</a>`;
  }
  if (entry.kind === "package") {
    return `<code class="tk-code">${esc(entry.value)}</code>`;
  }
  return `<span class="tk-code">${esc(entry.value)}</span>`;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** `2026-09-14T…` → `2026-09-14`. Internal surfaces use this. */
export function displayDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toISOString().slice(0, 10);
}

/** `2026-09-14T…` → `2026/09/14`. Editorial surfaces use this. */
export function displaySlashDate(iso: string): string {
  return displayDate(iso).replaceAll("-", "/");
}

/** Compact relative age for list metadata: `3 天前`, `刚刚`, `2026-01-02`. */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return displayDate(iso);
}

/** Reading-time estimate from description length; editorial metadata only. */
export function readingMinutes(description: string): number {
  return Math.max(1, Math.round(description.trim().length / 220));
}

export interface MaintainerLabel {
  id: string;
  kind: string;
}

/** `agent:docs-bot` → `docs-bot`, plus the actor kind for attribution. */
export function maintainerLabel(maintainer: MaintainerLabel): string {
  const short = maintainer.id.includes(":")
    ? maintainer.id.split(":").slice(1).join(":")
    : maintainer.id;
  return `${short} · ${maintainer.kind === "agent" ? "Agent" : "人类"}`;
}

export function maintainerChain(surface: AgentSurface): string {
  if (surface.maintainers.length === 0) return "未登记维护者";
  return surface.maintainers.map(maintainerLabel).join("、");
}

/**
 * Public visibility gate.
 *
 * `CatalogService.list` deliberately shows internal and pending records to any
 * reader or maintainer. The public surface must be stricter than that: it
 * renders only what crossed the approval boundary, so an internal session can
 * never turn the editorial page into a leak of unapproved entries.
 */
export function publicOnly(surfaces: readonly AgentSurface[]): AgentSurface[] {
  return surfaces
    .filter((s) => s.visibility === "public" && s.governanceState === "approved_public")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Bucket surfaces by first channel, in a stable CLI → MCP → Web order. */
export function byChannel(
  surfaces: readonly AgentSurface[],
): Array<{ channel: Channel; items: AgentSurface[] }> {
  const order: Channel[] = ["cli", "mcp", "web"];
  return order
    .map((channel) => ({
      channel,
      items: surfaces.filter((s) => s.channels.includes(channel)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Human sentence for a channel section: never a bare abbreviation. */
export function channelDescription(channel: Channel): string {
  return CHANNEL_NOTE[channel];
}

/** Empty-state block. */
export function emptyState(title: string, hint?: string): string {
  return `<div class="tk-empty">
      <p class="tk-empty__title">${esc(title)}</p>
      ${hint ? `<p>${esc(hint)}</p>` : ""}
    </div>`;
}

/** A boundary reminder, used wherever a page could be mistaken for a runtime. */
export function boundaryNote(text: string): string {
  return `<p class="tk-note tk-note--boundary"><span class="tk-note__glyph">◦</span><span>${
    esc(text)
  }</span></p>`;
}

/** Monospace stat block. */
export function stat(value: string | number, label: string): string {
  return `<div class="tk-stat"><span class="tk-stat__value">${
    esc(String(value))
  }</span><span class="tk-stat__label">${esc(label)}</span></div>`;
}

/** `+N` style counter chip for a filter tab. */
export function countBadge(value: number): string {
  return `<span class="tk-tab__count">${value}</span>`;
}

/**
 * Inline SVG-free channel glyph. Monospace ASCII keeps the CSP tight (no
 * `img-src` beyond `data:`) and keeps the console feeling like an instrument.
 */
export function channelGlyph(channel: Channel): string {
  if (channel === "cli") return "▚";
  if (channel === "mcp") return "◆";
  return "◈";
}

export type { Mode };
