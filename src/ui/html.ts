import type { DashboardView } from "../catalog/dashboard.ts";
import type {
  ApprovalStatusView,
  AuditSnippetView,
  CatalogCardView,
  CatalogDetailView,
  PermissionHintView,
  ResolvedComponent,
  ResolvedPage,
} from "./types.ts";

export function renderComposedPage(view: DashboardView, page: ResolvedPage): string {
  const blocks = page.components.map(renderComponent).join("\n");
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
      .lede { opacity: 0.75; margin: 0 0 1.5rem; }
      .counts { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0 0 1.5rem; padding: 0; list-style: none; }
      .counts li { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 0.5rem; padding: 0.5rem 0.75rem; }
      .counts strong { display: block; font-size: 1.25rem; }
      .component { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 0.75rem; padding: 1rem; margin: 0 0 1rem; }
      .component h2 { margin: 0 0 0.35rem; font-size: 1.1rem; }
      .meta { opacity: 0.75; font-size: 0.9rem; }
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
    <section class="components">
${blocks || `      <p class="empty">没有可见的门户组件。</p>`}
    </section>
  </body>
</html>
`;
}

function renderComponent(component: ResolvedComponent): string {
  if (component.kind === "catalog_card") return renderCard(component);
  if (component.kind === "catalog_detail") return renderDetail(component);
  if (component.kind === "permission_hint") return renderHint(component);
  if (component.kind === "approval_status") return renderApproval(component);
  return renderAudit(component);
}

function renderCard(component: CatalogCardView): string {
  return `      <article class="component" data-kind="catalog_card" data-id="${
    escapeHtml(component.id)
  }">
        <h2>${escapeHtml(component.name)}</h2>
        <p>${escapeHtml(component.description)}</p>
        <p class="meta"><code>${escapeHtml(component.id)}</code> · ${
    escapeHtml(component.governanceState)
  } · ${escapeHtml(component.version)}</p>
      </article>`;
}

function renderDetail(component: CatalogDetailView): string {
  return `      <article class="component" data-kind="catalog_detail" data-id="${
    escapeHtml(component.id)
  }">
        <h2>${escapeHtml(component.name)}</h2>
        <p>${escapeHtml(component.description)}</p>
        <p class="meta">${escapeHtml(component.governanceState)} · ${
    escapeHtml(component.entry.kind)
  } · ${escapeHtml(component.entry.value)}</p>
      </article>`;
}

function renderHint(component: PermissionHintView): string {
  return `      <aside class="component" data-kind="permission_hint">当前身份：${
    escapeHtml(component.role)
  }。维护=${component.canMaintain} 审计=${component.canAudit} 批准公开=${component.canApprovePublic}</aside>`;
}

function renderApproval(component: ApprovalStatusView): string {
  return `      <article class="component" data-kind="approval_status" data-id="${
    escapeHtml(component.id)
  }">
        <h2>审批状态</h2>
        <p class="meta">${escapeHtml(component.id)} · ${
    escapeHtml(component.governanceState)
  } · 公开可达=${component.public}</p>
      </article>`;
}

function renderAudit(component: AuditSnippetView): string {
  const items = component.events.map((event) => `          <li>${escapeHtml(event.summary)}</li>`)
    .join("\n");
  return `      <article class="component" data-kind="audit_snippet">
        <h2>审计片段</h2>
        <ul>
${items}
        </ul>
      </article>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
