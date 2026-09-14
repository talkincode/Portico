import type { AgentSurface, Channel } from "../catalog/mod.ts";
import type { DashboardView } from "../catalog/dashboard.ts";

export type { DashboardView };

export type ThemeMode = "light" | "dark" | "system";
export type ChannelFilter = Channel | null;

export interface MagazinePick {
  id: string;
  name: string;
  description: string;
  governanceState: string;
  channels: string[];
  version: string;
}

export interface MagazinePageInput {
  theme: ThemeMode;
  channel: ChannelFilter;
  view: DashboardView;
  selected?: AgentSurface;
  picks?: MagazinePick[];
  path?: string;
}

const TITLE_FONT =
  'Songti SC, "Noto Serif SC", "Source Han Serif", Palatino, "Palatino Linotype", serif';

const MAGAZINE_CSS = `
      :root {
        --accent: #4A9EFF;
        --bg: #F4F5F7;
        --text: #16181A;
        --muted: #5C6370;
        --panel: #FFFFFF;
        --rule: #E4E6EA;
        --title-font: ${TITLE_FONT};
        color-scheme: light;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0B0D0F;
          --text: #F2F4F6;
          --muted: #8A9099;
          --panel: #121417;
          --rule: #24282C;
          color-scheme: dark;
        }
      }
      [data-theme="light"] {
        --accent: #4A9EFF;
        --bg: #F4F5F7;
        --text: #16181A;
        --muted: #5C6370;
        --panel: #FFFFFF;
        --rule: #E4E6EA;
        color-scheme: light;
      }
      [data-theme="dark"] {
        --accent: #4A9EFF;
        --bg: #0B0D0F;
        --text: #F2F4F6;
        --muted: #8A9099;
        --panel: #121417;
        --rule: #24282C;
        color-scheme: dark;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: var(--bg); color: var(--text); }
      body {
        min-height: 100vh;
        font-family: Palatino, "Palatino Linotype", "Songti SC", serif;
        letter-spacing: 0.01em;
      }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
      .topbar {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 0.9rem 1.5rem;
        border-bottom: 1px solid var(--rule);
      }
      .brand {
        font-family: var(--title-font);
        font-size: 0.82rem;
        letter-spacing: 0.28em;
        color: var(--text);
        text-decoration: none;
      }
      .brand:hover { text-decoration: none; color: var(--accent); }
      .nav { display: flex; gap: 1.1rem; font-size: 0.92rem; }
      .nav a { color: var(--text); }
      .nav a.active { color: var(--accent); }
      .nav [aria-disabled="true"] { color: var(--muted); cursor: not-allowed; }
      .themes { margin-left: auto; display: flex; gap: 0.75rem; font-size: 0.8rem; }
      .themes a { color: var(--muted); }
      .frame {
        width: min(72rem, calc(100% - 2.5rem));
        margin: 0 auto;
        padding: 1.75rem 0 3rem;
      }
      .home {
        display: grid;
        grid-template-columns: minmax(0, 1.7fr) minmax(16rem, 0.72fr);
        gap: 2.25rem;
      }
      .reading {
        display: grid;
        grid-template-columns: minmax(16rem, 0.72fr) minmax(0, 1.5fr);
        gap: 2.25rem;
      }
      h1, h2, .hero-title {
        font-family: var(--title-font);
        font-weight: 600;
        letter-spacing: 0;
      }
      .hero {
        padding-bottom: 1.4rem;
        margin-bottom: 1.4rem;
        border-bottom: 1px solid var(--rule);
      }
      .hero-title { font-size: clamp(2rem, 4vw, 3.1rem); margin: 0 0 0.6rem; line-height: 1.15; }
      .hero-title a { color: var(--text); }
      .kicker {
        margin: 0 0 0.45rem;
        color: var(--muted);
        font-size: 0.75rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      .card {
        padding: 1.05rem 0;
        border-bottom: 1px solid var(--rule);
      }
      .card h2 { margin: 0 0 0.35rem; font-size: 1.35rem; }
      .card h2 a { color: var(--text); }
      .desc { margin: 0 0 0.45rem; color: var(--muted); }
      .byline, .meta { margin: 0; color: var(--muted); font-size: 0.88rem; }
      .entry { margin: 0.45rem 0 0; font-size: 0.92rem; }
      .sidebar { border-left: 1px solid var(--rule); padding-left: 1.4rem; }
      .topics { list-style: none; margin: 0 0 1.5rem; padding: 0; }
      .topics li { margin: 0 0 0.45rem; }
      .topics a { color: var(--text); }
      .topics a.active { color: var(--accent); }
      .picks article { padding: 0.8rem 0; border-top: 1px solid var(--rule); }
      .picks h2 { margin: 0 0 0.3rem; font-size: 1.05rem; }
      .empty { color: var(--muted); }
      .badge { color: var(--accent); }
      .detail h1 { margin: 0 0 0.7rem; font-size: 2.2rem; }
      .list-compact .card { padding: 0.7rem 0; }
      .list-compact h2 { font-size: 1.05rem; }
      code { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 0.86em; }
      @media (max-width: 800px) {
        .home, .reading { grid-template-columns: 1fr; }
        .sidebar { border-left: 0; padding-left: 0; border-top: 1px solid var(--rule); padding-top: 1.2rem; }
      }
`;

export function parseTheme(raw: string | null): ThemeMode {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function parseChannel(raw: string | null): ChannelFilter {
  if (raw === "web" || raw === "cli" || raw === "mcp") return raw;
  return null;
}

export function renderMagazinePage(input: MagazinePageInput): string {
  const picks = input.picks ?? [];
  const selected = input.selected;
  const path = input.path ?? (selected ? `/s/${encodeURIComponent(selected.id)}` : "/");
  const hero = selected
    ? undefined
    : input.view.surfaces.find((item) => item.governanceState === "approved_public");
  const main = selected
    ? renderReading(input.view.surfaces, selected, input.theme, input.channel)
    : renderHome(input.view.surfaces, hero, input.theme, input.channel);
  const side = selected ? "" : renderSidebar(picks, input.theme, input.channel, path);
  const frameClass = selected ? "frame reading" : "frame home";
  return renderChrome({
    theme: input.theme,
    channel: input.channel,
    path,
    title: selected ? selected.name : "Portico",
    body: `<div class="${frameClass}">${main}${side}</div>`,
  });
}

export function renderNotFoundPage(theme: ThemeMode = "system"): string {
  return renderChrome({
    theme,
    channel: null,
    path: "/",
    title: "Portico",
    body: `<div class="frame"><p class="empty">没有这个入口，或你无权看见。</p></div>`,
  });
}

export function renderDiscoveryPage(view: DashboardView): string {
  return renderMagazinePage({ theme: "system", channel: null, view, picks: [] });
}

// `dashboardFrom` now lives in `../catalog/dashboard.ts`: it is derived purely
// from catalog records and the MCP entrance consumes it too.

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderChrome(input: {
  theme: ThemeMode;
  channel: ChannelFilter;
  path: string;
  title: string;
  body: string;
}): string {
  const themeAttr = input.theme === "system" ? "" : ` data-theme="${input.theme}"`;
  const contentHref = withQuery("/", input.theme, null);
  const topicHref = withQuery("/", input.theme, input.channel ?? "web");
  const contentActive = input.channel === null && !input.path.startsWith("/s/") ? " active" : "";
  const topicActive = input.channel !== null ? " active" : "";
  return `<!DOCTYPE html>
<html lang="zh-CN"${themeAttr}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)} · Portico</title>
    <style>${MAGAZINE_CSS}
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="${escapeHtml(contentHref)}">PORTICO</a>
      <nav class="nav">
        <a class="${contentActive.trim()}" href="${escapeHtml(contentHref)}">内容</a>
        <a class="${topicActive.trim()}" href="${escapeHtml(topicHref)}">专题</a>
        <span aria-disabled="true">收藏</span>
      </nav>
      <p class="themes">
        <a href="${escapeHtml(withQuery(input.path, "light", input.channel))}">日</a>
        <a href="${escapeHtml(withQuery(input.path, "dark", input.channel))}">夜</a>
        <a href="${escapeHtml(withQuery(input.path, "system", input.channel))}">自动</a>
      </p>
    </header>
    ${input.body}
  </body>
</html>
`;
}

function renderHome(
  surfaces: AgentSurface[],
  hero: AgentSurface | undefined,
  theme: ThemeMode,
  channel: ChannelFilter,
): string {
  const empty = surfaces.length === 0 ? `<p class="empty">没有可见的 Agent 表面。</p>` : "";
  const heroHtml = hero ? renderHero(hero, theme, channel) : "";
  const cards = surfaces.map((surface) => renderCard(surface, theme, channel)).join("");
  return `<main>
      ${heroHtml}
      <section class="stream">${empty}${cards}</section>
    </main>`;
}

function renderReading(
  surfaces: AgentSurface[],
  selected: AgentSurface,
  theme: ThemeMode,
  channel: ChannelFilter,
): string {
  const cards = surfaces.map((surface) =>
    renderCard(surface, theme, channel, { compact: true, currentId: selected.id })
  ).join("");
  return `
    <section class="list-compact">
      ${renderTopics(theme, channel, `/s/${encodeURIComponent(selected.id)}`)}
      ${cards || `<p class="empty">没有可见的 Agent 表面。</p>`}
    </section>
    <article class="detail" data-surface="${escapeHtml(selected.id)}" data-governance="${
    escapeHtml(selected.governanceState)
  }">
      <p class="kicker">${escapeHtml(channelLabel(selected.channels))} · ${
    governanceLabel(selected.governanceState)
  }</p>
      <h1>${escapeHtml(selected.name)}</h1>
      <p class="desc">${escapeHtml(selected.description)}</p>
      <p class="meta">版本 ${escapeHtml(selected.version)} · <code>${
    escapeHtml(selected.id)
  }</code></p>
      <p class="byline">${escapeHtml(byline(selected))}</p>
      <p class="entry">${renderEntry(selected.entry.kind, selected.entry.value)}</p>
    </article>`;
}

function renderSidebar(
  picks: MagazinePick[],
  theme: ThemeMode,
  channel: ChannelFilter,
  path: string,
): string {
  const pickHtml = picks.map((pick) => {
    const href = withQuery(`/s/${encodeURIComponent(pick.id)}`, theme, channel);
    return `        <article data-kind="catalog_card" data-id="${
      escapeHtml(pick.id)
    }" data-governance="${escapeHtml(pick.governanceState)}">
          <h2><a href="${escapeHtml(href)}">${escapeHtml(pick.name)}</a></h2>
          <p class="desc">${escapeHtml(pick.description)}</p>
          <p class="meta">${governanceLabel(pick.governanceState)} · ${escapeHtml(pick.version)}</p>
        </article>`;
  }).join("");
  return `<aside class="sidebar">
      ${renderTopics(theme, channel, path)}
      <section class="picks">
        <p class="kicker">编辑精选</p>
        ${pickHtml || `<p class="empty">暂无精选。</p>`}
      </section>
    </aside>`;
}

function renderTopics(theme: ThemeMode, channel: ChannelFilter, path: string): string {
  const items: Array<{ id: ChannelFilter; label: string }> = [
    { id: null, label: "全部" },
    { id: "web", label: "Web" },
    { id: "cli", label: "CLI" },
    { id: "mcp", label: "MCP" },
  ];
  const links = items.map((item) => {
    const href = withQuery(path.startsWith("/s/") ? path : "/", theme, item.id);
    const active = channel === item.id ? " active" : "";
    return `<li><a class="${active.trim()}" href="${escapeHtml(href)}">${item.label}</a></li>`;
  }).join("");
  return `<nav class="topics"><p class="kicker">专题</p><ul>${links}</ul></nav>`;
}

function renderHero(surface: AgentSurface, theme: ThemeMode, channel: ChannelFilter): string {
  const href = withQuery(`/s/${encodeURIComponent(surface.id)}`, theme, channel);
  return `<section class="hero" data-hero data-id="${escapeHtml(surface.id)}" data-governance="${
    escapeHtml(surface.governanceState)
  }">
        <p class="kicker">精选 · ${governanceLabel(surface.governanceState)}</p>
        <h1 class="hero-title"><a href="${escapeHtml(href)}">${escapeHtml(surface.name)}</a></h1>
        <p class="desc">${escapeHtml(surface.description)}</p>
      </section>`;
}

function renderCard(
  surface: AgentSurface,
  theme: ThemeMode,
  channel: ChannelFilter,
  opts: { compact?: boolean; currentId?: string } = {},
): string {
  const href = withQuery(`/s/${encodeURIComponent(surface.id)}`, theme, channel);
  const entry = opts.compact
    ? ""
    : `<p class="entry">${renderEntry(surface.entry.kind, surface.entry.value)}</p>`;
  const current = opts.currentId === surface.id ? " current" : "";
  return `
        <article class="card${current}" data-id="${escapeHtml(surface.id)}" data-governance="${
    escapeHtml(surface.governanceState)
  }" data-channels="${escapeHtml(surface.channels.join(","))}">
          <p class="kicker">${escapeHtml(channelLabel(surface.channels))} · ${
    governanceLabel(surface.governanceState)
  }</p>
          <h2><a href="${escapeHtml(href)}">${escapeHtml(surface.name)}</a></h2>
          ${opts.compact ? "" : `<p class="desc">${escapeHtml(surface.description)}</p>`}
          ${opts.compact ? "" : `<p class="byline">${escapeHtml(byline(surface))}</p>`}
          ${entry}
        </article>`;
}

function governanceLabel(state: string): string {
  if (state === "approved_public") return `<span class="badge">已公开</span> · 人工审核`;
  if (state === "pending_public") return "待审";
  if (state === "internal") return "内部";
  if (state === "draft") return "草稿";
  if (state === "rejected") return "已拒";
  return escapeHtml(state);
}

function channelLabel(channels: string[]): string {
  return channels.map((item) => item.toUpperCase()).join(" · ");
}

function byline(surface: AgentSurface): string {
  const lead = surface.maintainers[0];
  return lead ? lead.id : "";
}

function renderEntry(kind: string, value: string): string {
  const safe = escapeHtml(value);
  if (kind === "url" && isDirectHttpHref(value)) {
    return `<a href="${safe}" rel="noopener noreferrer">${safe}</a>`;
  }
  return `<code>${escapeHtml(kind)}: ${safe}</code>`;
}

function isDirectHttpHref(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function queryOf(theme: ThemeMode, channel: ChannelFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (theme !== "system") params.set("theme", theme);
  if (channel) params.set("channel", channel);
  return params;
}

function withQuery(path: string, theme: ThemeMode, channel: ChannelFilter): string {
  const query = queryOf(theme, channel).toString();
  return query ? `${path}?${query}` : path;
}
