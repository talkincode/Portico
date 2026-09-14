import type { AgentSurface } from "../catalog/mod.ts";

export interface DashboardView {
  counts: {
    visible: number;
    draft: number;
    internal: number;
    pending_public: number;
    approved_public: number;
    rejected: number;
  };
  surfaces: AgentSurface[];
}

const SHELL_CSS = `
      :root {
        --ink: #1c1410;
        --paper: #efe4cc;
        --panel: #241910;
        --brass: #c4a46a;
        --card: #fbf3e3;
        --muted: #6f6254;
        --rule: rgba(196, 164, 106, 0.45);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(1200px 420px at 8% -10%, rgba(196,164,106,0.18), transparent 55%),
          var(--paper);
        color: var(--ink);
        font-family: "Iowan Old Style", Palatino, "Palatino Linotype", "Times New Roman", serif;
      }
      .mast {
        background: var(--panel);
        color: var(--paper);
        padding: 2rem 1.5rem 1.6rem;
        border-bottom: 3px solid var(--brass);
      }
      .mast .eyebrow {
        margin: 0;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        font-size: 0.72rem;
        color: var(--brass);
      }
      .mast h1 {
        margin: 0.45rem 0 0.35rem;
        font-size: clamp(2rem, 5vw, 3.1rem);
        font-weight: 500;
        letter-spacing: 0.02em;
      }
      .lede { margin: 0; max-width: 36rem; color: rgba(239, 228, 204, 0.78); }
      .wrap { width: min(72rem, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0 3rem; }
      .counts {
        display: flex; flex-wrap: wrap; gap: 0.65rem;
        margin: 0 0 1.5rem; padding: 0; list-style: none;
      }
      .counts li {
        border: 1px solid var(--rule);
        background: rgba(251, 243, 227, 0.7);
        border-radius: 999px;
        padding: 0.35rem 0.8rem;
        font-size: 0.85rem;
      }
      .counts strong { font-variant-numeric: tabular-nums; }
      .directory {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(17.5rem, 1fr));
        gap: 1.1rem;
      }
      .plate {
        background: var(--card);
        border: 1px solid var(--rule);
        box-shadow: 0 10px 28px rgba(28, 20, 16, 0.08);
        padding: 1.15rem 1.15rem 1rem;
        display: flex;
        flex-direction: column;
        min-height: 12.5rem;
      }
      .kicker {
        margin: 0 0 0.45rem;
        font-size: 0.72rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--brass);
      }
      .plate h2 { margin: 0 0 0.45rem; font-size: 1.45rem; font-weight: 600; }
      .plate h2 a { color: inherit; text-decoration: none; }
      .plate h2 a:hover { border-bottom: 1px solid var(--brass); }
      .desc { margin: 0 0 1rem; color: var(--muted); flex: 1; }
      .meta { margin: 0; font-size: 0.9rem; color: var(--muted); }
      .entry {
        margin-top: 0.75rem;
        color: var(--ink);
        font-size: 0.92rem;
      }
      .empty { opacity: 0.75; }
      .back { color: var(--brass); text-decoration: none; font-size: 0.9rem; }
      .back:hover { text-decoration: underline; }
      .stamp { margin-top: 1.25rem; color: var(--muted); font-size: 0.85rem; }
      code { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 0.86em; }
`;

export function renderDiscoveryPage(view: DashboardView): string {
  const cards = view.surfaces.map((surface) => renderCard(surface)).join("");
  const empty = view.surfaces.length === 0
    ? `<p class="empty">目录是空的。通过审批的入口会出现在这里。</p>`
    : "";

  return renderShell({
    title: "Portico",
    lede: "推开门廊。Agent 在别处运行；这里只登记、发现、授权和访问。",
    counts: view.counts,
    body: `${empty}${view.surfaces.length === 0 ? "" : `<div class="directory">${cards}</div>`}`,
  });
}

export function renderSurfacePage(surface: AgentSurface): string {
  const entry = renderEntry(surface.entry.kind, surface.entry.value);
  return renderShell({
    title: surface.name,
    lede: surface.description,
    counts: null,
    body: `
      <p><a class="back" href="/">← 返回目录</a></p>
      <p class="kicker">${escapeHtml(surface.channels.join(" · "))} · ${
      escapeHtml(surface.governanceState)
    }</p>
      <h2>${escapeHtml(surface.name)}</h2>
      <p class="desc">${escapeHtml(surface.description)}</p>
      <p class="meta">版本 ${escapeHtml(surface.version)} · <code>${
      escapeHtml(surface.id)
    }</code></p>
      <p class="entry">${entry}</p>
      <p class="stamp">${escapeHtml(surface.visibility)}</p>
    `,
  });
}

export function renderNotFoundPage(): string {
  return renderShell({
    title: "Portico",
    lede: "没有这个入口，或你无权看见。",
    counts: null,
    body: `<p><a class="back" href="/">← 返回目录</a></p><p class="empty">未找到。</p>`,
  });
}

export function dashboardFrom(surfaces: AgentSurface[]): DashboardView {
  const counts = {
    visible: surfaces.length,
    draft: 0,
    internal: 0,
    pending_public: 0,
    approved_public: 0,
    rejected: 0,
  };
  for (const surface of surfaces) {
    if (surface.governanceState === "draft") counts.draft += 1;
    else if (surface.governanceState === "internal") counts.internal += 1;
    else if (surface.governanceState === "pending_public") counts.pending_public += 1;
    else if (surface.governanceState === "approved_public") counts.approved_public += 1;
    else if (surface.governanceState === "rejected") counts.rejected += 1;
  }
  const ordered = [...surfaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { counts, surfaces: ordered };
}

function renderShell(input: {
  title: string;
  lede: string;
  counts: DashboardView["counts"] | null;
  body: string;
}): string {
  const counts = input.counts
    ? `<ul class="counts">
      <li>目录 <strong>${input.counts.visible}</strong></li>
      <li>内部 <strong>${input.counts.internal}</strong></li>
      <li>待审 <strong>${input.counts.pending_public}</strong></li>
      <li>已公开 <strong>${input.counts.approved_public}</strong></li>
    </ul>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)} · Portico</title>
    <style>${SHELL_CSS}
    </style>
  </head>
  <body>
    <header class="mast">
      <p class="eyebrow">Portico</p>
      <h1>${escapeHtml(input.title === "Portico" ? "门廊目录" : input.title)}</h1>
      <p class="lede">${escapeHtml(input.lede)}</p>
    </header>
    <main class="wrap">
      ${counts}
      ${input.body}
    </main>
  </body>
</html>
`;
}

function renderCard(surface: AgentSurface): string {
  const href = `/s/${encodeURIComponent(surface.id)}`;
  return `
        <article class="plate">
          <p class="kicker">${escapeHtml(surface.channels.join(" · "))} · ${
    escapeHtml(surface.governanceState)
  }</p>
          <h2><a href="${escapeHtml(href)}">${escapeHtml(surface.name)}</a></h2>
          <p class="desc">${escapeHtml(surface.description)}</p>
          <p class="meta">v${escapeHtml(surface.version)}</p>
          <p class="entry">${renderEntry(surface.entry.kind, surface.entry.value)}</p>
        </article>`;
}

function renderEntry(kind: string, value: string): string {
  const safe = escapeHtml(value);
  if (kind === "url" && isDirectHttpHref(value)) {
    return `<a href="${safe}" rel="noopener noreferrer">打开入口</a>`;
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

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
