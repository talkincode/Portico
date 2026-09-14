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

export function renderDiscoveryPage(view: DashboardView): string {
  const rows = view.surfaces.map((surface) => `
        <tr>
          <td>${escapeHtml(surface.name)}</td>
          <td><code>${escapeHtml(surface.id)}</code></td>
          <td>${escapeHtml(surface.governanceState)}</td>
          <td>${escapeHtml(surface.visibility)}</td>
          <td>${escapeHtml(surface.channels.join(", "))}</td>
          <td>${escapeHtml(surface.version)}</td>
          <td>${renderEntry(surface.entry.kind, surface.entry.value)}</td>
        </tr>`).join("");

  const empty = view.surfaces.length === 0 ? `<p class="empty">没有可见的 Agent 表面。</p>` : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Portico</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0 auto; max-width: 56rem; padding: 1.5rem; }
      h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
      .lede { color: CanvasText; opacity: 0.75; margin: 0 0 1.5rem; }
      .counts { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0 0 1.5rem; padding: 0; list-style: none; }
      .counts li { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 0.5rem; padding: 0.5rem 0.75rem; }
      .counts strong { display: block; font-size: 1.25rem; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 0.5rem 0.4rem; border-bottom: 1px solid color-mix(in srgb, CanvasText 15%, transparent); }
      .empty { opacity: 0.75; }
    </style>
  </head>
  <body>
    <h1>Portico</h1>
    <p class="lede">Agent 不在这里运行。这里只发布、发现、授权和访问。</p>
    <ul class="counts">
      <li><span>可见</span><strong>${view.counts.visible}</strong></li>
      <li><span>内部</span><strong>${view.counts.internal}</strong></li>
      <li><span>待审公开</span><strong>${view.counts.pending_public}</strong></li>
      <li><span>已公开</span><strong>${view.counts.approved_public}</strong></li>
    </ul>
    ${empty}
    ${
    view.surfaces.length === 0 ? "" : `<table>
      <thead>
        <tr>
          <th>名称</th>
          <th>身份</th>
          <th>治理状态</th>
          <th>可见性</th>
          <th>渠道</th>
          <th>版本</th>
          <th>入口</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>`
  }
  </body>
</html>
`;
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

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
