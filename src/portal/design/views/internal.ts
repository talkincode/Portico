/**
 * Internal view templates.
 *
 * Renders the catalog the way an operator reads it: a navigation rail, a record
 * list, and a reader pane. Every page here is behind the internal trust
 * boundary, so it may show `draft`, `pending_public`, maintainers, and audit
 * detail that the public surface must never receive.
 */

import type { Actor, AgentSurface, Channel, GovernanceState } from "../../../catalog/types.ts";
import type { AuditEvent } from "../../../audit/types.ts";
import {
  boundaryNote,
  channelChips,
  channelDescription,
  channelGlyph,
  countBadge,
  dl,
  emptyState,
  entryValue,
  esc,
  maintainerChain,
  readingMinutes,
  relativeAge,
  stateChip,
} from "../components.ts";
import { renderShell, themeSwitch } from "../page.ts";
import { CHANNEL_LABEL, STATE_LABEL } from "../tokens.ts";
import type { PageTheme } from "./types.ts";

/** Everything a view needs that is not catalog data. */
export interface ViewContext {
  actor: Actor;
  /** Current request path including query, used by the theme switch. */
  path: string;
  theme: PageTheme;
  /** Catalog counts for the rail; computed from what the actor can see. */
  counts: CountSummary;
}

export interface CountSummary {
  total: number;
  byState: Record<GovernanceState, number>;
  byChannel: Record<Channel, number>;
}

export function summarize(surfaces: readonly AgentSurface[]): CountSummary {
  const byState: Record<GovernanceState, number> = {
    draft: 0,
    internal: 0,
    pending_public: 0,
    approved_public: 0,
    rejected: 0,
  };
  const byChannel: Record<Channel, number> = { cli: 0, mcp: 0, web: 0 };
  for (const surface of surfaces) {
    byState[surface.governanceState] += 1;
    for (const channel of surface.channels) byChannel[channel] += 1;
  }
  return { total: surfaces.length, byState, byChannel };
}

const ROLE_LABEL: Record<string, string> = {
  reader: "只读",
  maintainer: "维护者",
  auditor: "人类审计者",
  anonymous: "匿名",
};

function identityBlock(actor: Actor): string {
  const role = ROLE_LABEL[actor.role] ?? actor.role;
  const initial = actor.kind === "agent" ? "A" : "H";
  return `<div class="int-identity" title="${esc(actor.id)}">
        <span class="int-byline__avatar">${esc(initial)}</span>
        <span class="int-identity__role">${esc(role)}</span>
        <span class="int-identity__id">${esc(actor.id)}</span>
      </div>`;
}

/** Deterministic decorative thumbnail; no remote asset, no user-controlled CSS. */
function thumb(surface: AgentSurface, size: "sm" | "lg" = "sm"): string {
  const pattern = hashCode(surface.id) % 3;
  const glyph = channelGlyph(surface.channels[0] ?? "web");
  const cls = size === "lg" ? "int-thumb int-thumb--lg" : "int-thumb";
  return `<span class="${cls}" data-pattern="${pattern}" data-glyph="${
    esc(glyph)
  }" aria-hidden="true"></span>`;
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Which rail entry is the current page. */
export type InternalScreen = "content" | "catalog" | "audit" | "surface";

interface ShellParts {
  ctx: ViewContext;
  screen: InternalScreen;
  /** Three-pane layout (list + reader) or a single wide page. */
  panes: "two" | "three";
  body: string;
  title: string;
  filter?: string;
}

function renderInternalPage(parts: ShellParts): string {
  const { ctx } = parts;
  const body = `    <header class="int-top">
      <a class="tk-brand" href="/internal">
        <span class="tk-brand__mark">Portico</span>
        <span class="tk-brand__sub">内部</span>
      </a>
      <nav class="int-top__nav tk-tabs" aria-label="主要区域">
        ${internalTabs(ctx, parts.screen)}
      </nav>
      <div class="int-top__tools">
        <span class="tk-search" aria-hidden="true">
          <span>⌕</span><span>搜索记录或身份</span>
          <kbd class="tk-search__key">/</kbd>
        </span>
        ${themeSwitch(ctx.theme, ctx.path)}
        ${identityBlock(ctx.actor)}
      </div>
    </header>
    <div class="int-body" data-panes="${parts.panes}">
${renderRail(ctx, parts.screen)}
${parts.body}
    </div>`;

  return renderShell({
    title: parts.title,
    tone: "internal",
    theme: ctx.theme,
    path: ctx.path,
    body,
    bodyAttrs: ` data-screen="${parts.screen}"`,
  });
}

function internalTabs(ctx: ViewContext, screen: InternalScreen): string {
  const items: Array<{ id: InternalScreen; href: string; label: string; count?: number }> = [
    { id: "content", href: "/internal", label: "内容" },
    { id: "catalog", href: "/internal/c", label: "目录", count: ctx.counts.total },
  ];
  // The audit trail is not merely hidden by CSS for a non-auditor: it is absent
  // from the response, so the HTML never leaks that a trail exists.
  if (ctx.actor.kind === "human" && ctx.actor.role === "auditor") {
    items.push({ id: "audit", href: "/internal/audit", label: "审计" });
  }
  return items.map((item) =>
    `<a class="tk-tab" href="${item.href}"${
      item.id === screen || (screen === "surface" && item.id === "content")
        ? ' aria-current="true"'
        : ""
    }>${esc(item.label)}${item.count === undefined ? "" : countBadge(item.count)}</a>`
  ).join("");
}

function renderRail(ctx: ViewContext, screen: InternalScreen): string {
  const { byState, byChannel, total } = ctx.counts;
  const contentActive = screen === "content" || screen === "surface";
  const group = (heading: string, entries: string) =>
    `<div class="tk-rail__group"><p class="tk-rail__heading">${esc(heading)}</p>${entries}</div>`;
  const item = (
    glyph: string,
    label: string,
    href: string,
    opts: { active?: boolean; count?: number } = {},
  ) =>
    `<a class="tk-navitem" href="${href}"${opts.active ? ' aria-current="page"' : ""}>
        <span class="tk-navitem__glyph" aria-hidden="true">${esc(glyph)}</span>
        <span>${esc(label)}</span>
        ${opts.count === undefined ? "" : `<span class="tk-navitem__count">${opts.count}</span>`}
      </a>`;

  const states = (Object.keys(STATE_LABEL) as GovernanceState[])
    .map((state) =>
      item("·", STATE_LABEL[state], `/internal/c?state=${state}`, { count: byState[state] })
    ).join("");

  const channels = (Object.keys(CHANNEL_LABEL) as Channel[])
    .map((channel) =>
      item(channelGlyph(channel), CHANNEL_LABEL[channel], `/internal/c?channel=${channel}`, {
        count: byChannel[channel],
      })
    ).join("");

  return `      <nav class="int-rail tk-rail" aria-label="治理导航">
${group("工作台", item("▤", "全部内容", "/internal", { active: contentActive, count: total }))}
${group("治理状态", states)}
${group("渠道", channels)}${
    ctx.actor.kind === "human" && ctx.actor.role === "auditor"
      ? `\n${
        group("审计", item("◎", "审计时间线", "/internal/audit", { active: screen === "audit" }))
      }`
      : ""
  }
        <div class="int-rail__spacer"></div>
        <div class="int-rail__mark">
          <span class="tk-brand"><span class="tk-brand__dot"></span><span class="tk-brand__mark">Portico</span></span>
          <p>Agent 不在这里运行。这里只登记、发布、发现、授权和访问。</p>
        </div>
        <div class="int-rail__foot">
          <p class="int-rail__note"><strong>可见 ${total}</strong> 条 · 待审 ${byState.pending_public} 条<br>公开必须经独立审批。</p>
        </div>
      </nav>`;
}

/* ── screen 1: 全部内容 (list + reader) ─────────────────────────────────── */

export interface ContentViewInput {
  ctx: ViewContext;
  /** All surfaces the actor can see. */
  surfaces: AgentSurface[];
  /** Audit events when the actor is an auditor; otherwise undefined. */
  recentEvents?: AuditEvent[];
}

export function renderContentView(input: ContentViewInput): string {
  const { ctx, surfaces } = input;
  if (surfaces.length === 0) {
    return renderInternalPage({
      ctx,
      screen: "content",
      panes: "two",
      title: "内容",
      body: `      <main class="int-page">
        ${emptyState("没有可见的登记记录。", "目录为空，或当前身份没有可见范围。")}
      </main>`,
    });
  }

  const ordered = [...surfaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [lead] = ordered;

  return renderInternalPage({
    ctx,
    screen: "content",
    panes: "three",
    title: "内容",
    body: `      <section class="int-list" aria-label="记录列表">
        <div class="int-list__head">
          <h2 class="int-list__title">全部内容</h2>
          <span class="int-list__sort">按更新时间 ↓</span>
        </div>
        <div class="int-list__items">
${ordered.map((surface) => renderRow(surface, surface.id === lead.id)).join("\n")}
        </div>
      </section>
${renderReader(lead, input.recentEvents)}`,
  });
}

function renderRow(surface: AgentSurface, current: boolean): string {
  return `          <a class="int-row" href="/internal/s/${esc(surface.id)}"${
    current ? ' aria-current="true"' : ""
  }>
            ${thumb(surface)}
            <span class="tk-grow">
              <span class="int-row__title tk-clamp-2">${esc(surface.name)}</span>
              <span class="int-row__abs tk-clamp-2">${esc(surface.description)}</span>
              <span class="int-row__foot">
                ${stateChip(surface.governanceState, { compact: true })}
                ${channelChips(surface.channels)}
              </span>
            </span>
          </a>`;
}

function renderReader(
  surface: AgentSurface,
  recentEvents?: AuditEvent[],
): string {
  const publicReachable = surface.governanceState === "approved_public";
  const timeline = (recentEvents ?? []).filter((event) => event.subjectId === surface.id).slice(
    0,
    6,
  );

  return `      <main class="int-reader">
        <nav class="int-crumb" aria-label="面包屑">
          <a href="/internal">内容</a>
          <span class="int-crumb__sep">›</span>
          <a href="/internal/c">目录</a>
          <span class="int-crumb__sep">›</span>
          <span>${esc(surface.id)}</span>
        </nav>
        <article class="int-doc">
          <div class="int-doc__kicker">
            ${stateChip(surface.governanceState)}
            ${channelChips(surface.channels)}
            <span class="tk-chip tk-chip--plain">v${esc(surface.version)}</span>
          </div>
          <h1 class="int-doc__title">${esc(surface.name)}</h1>
          <p class="int-doc__lede">${esc(surface.description)}</p>

          <div class="int-byline">
            <span class="int-byline__who">
              <span class="int-byline__avatar" aria-hidden="true">${
    surface.maintainers[0]?.kind === "agent" ? "A" : "H"
  }</span>
              ${esc(maintainerChain(surface))}
            </span>
            <span class="tk-meta">${esc(relativeAge(surface.updatedAt))} 更新 · ${
    readingMinutes(surface.description)
  } 分钟阅读 · <span class="tk-id">${esc(surface.id)}</span></span>
            <span class="int-actions">
              <a class="tk-btn tk-btn--quiet" href="/api/catalog/${esc(surface.id)}">JSON</a>
              <a class="tk-btn tk-btn--quiet" href="/internal/c">目录</a>
            </span>
          </div>

          ${
    publicReachable
      ? `<p class="tk-note"><span class="tk-note__glyph">●</span><span>已通过独立审批，公开面可达。<a class="tk-link" href="/public/s/${
        esc(surface.id)
      }">查看公开发布页</a></span></p>`
      : `<p class="tk-note"><span class="tk-note__glyph">○</span><span>${
        boundaryNoteFor(surface)
      }</span></p>`
  }

          <section class="int-section">
            <h2 class="int-section__title"><span class="int-section__index">01</span>登记事实</h2>
            <dl class="tk-dl">
              ${dl("治理状态", stateChip(surface.governanceState))}
              ${dl("可见性", esc(surface.visibility === "public" ? "公开" : "内部"))}
              ${dl("渠道", channelChips(surface.channels))}
              ${dl("版本", `<span class="tk-num">${esc(surface.version)}</span>`)}
              ${dl("入口", entryValue(surface.entry, { linkable: publicReachable }))}
              ${dl("维护者", esc(maintainerChain(surface)) || "—")}
              ${
    dl("登记时间", `<span class="tk-num">${esc(surface.createdAt.slice(0, 10))}</span>`)
  }
              ${
    dl("更新时间", `<span class="tk-num">${esc(surface.updatedAt.slice(0, 10))}</span>`)
  }
            </dl>
          </section>

          <section class="int-section">
            <h2 class="int-section__title"><span class="int-section__index">02</span>治理路径</h2>
            <div class="int-pipe">
              <div class="int-pipe__step"><p class="int-pipe__name">登记</p><p class="int-pipe__note">维护者写入目录</p></div>
              <span class="int-pipe__arrow" aria-hidden="true">→</span>
              <div class="int-pipe__step"><p class="int-pipe__name">${
    surface.governanceState === "draft" ? "草稿" : "内部发布"
  }</p><p class="int-pipe__note">只读及以上可见</p></div>
              <span class="int-pipe__arrow" aria-hidden="true">→</span>
              <div class="int-pipe__step"><p class="int-pipe__name">公开候选</p><p class="int-pipe__note">对匿名仍不可达</p></div>
              <span class="int-pipe__arrow" aria-hidden="true">→</span>
              <div class="int-pipe__step"><p class="int-pipe__name">独立审批</p><p class="int-pipe__note">提交者不能自批</p></div>
            </div>
          </section>

          <section class="int-section">
            <h2 class="int-section__title"><span class="int-section__index">03</span>渠道说明</h2>
            <div class="int-section__body">
              ${
    surface.channels.map((channel) =>
      `<p><strong>${esc(CHANNEL_LABEL[channel])}</strong> — ${esc(channelDescription(channel))}</p>`
    ).join("\n              ")
  }
            </div>
          </section>

          ${
    timeline.length === 0 ? "" : `<section class="int-section">
            <h2 class="int-section__title"><span class="int-section__index">04</span>近期轨迹</h2>
            <ol class="tk-timeline">
${timeline.map(renderTimelineItem).join("\n")}
            </ol>
          </section>`
  }
        </article>
      </main>`;
}

function boundaryNoteFor(surface: AgentSurface): string {
  if (surface.governanceState === "pending_public") {
    return "已提交公开候选，等待独立人类审计者审批。对匿名与组织外主体不可见、不可达。";
  }
  if (surface.governanceState === "rejected") {
    return "公开候选被拒绝。公开面保持不可达；需修改后重新提交并重新审批。";
  }
  if (surface.governanceState === "draft") {
    return "草稿仅维护者可见，尚未进入内部目录。";
  }
  return "内部记录。公开入口不存在，任何渠道都不会对外暴露该引用。";
}

function renderTimelineItem(event: AuditEvent): string {
  return `              <li class="tk-timeline__item" data-kind="${esc(event.kind)}">
                <p class="int-audit__summary">${esc(event.summary)}</p>
                <p class="int-audit__meta"><span>${esc(event.action)}</span><span>${
    esc(event.actor.id)
  }</span><span>${esc(event.at.slice(0, 16).replace("T", " "))}</span></p>
              </li>`;
}

/* ── screen 2: 目录 (catalogue table) ───────────────────────────────────── */

export interface CatalogViewInput {
  ctx: ViewContext;
  surfaces: AgentSurface[];
  /** Active filters, echoed back so the page is linkable and honest. */
  filter?: { state?: string; channel?: string };
}

export function renderCatalogView(input: CatalogViewInput): string {
  const { ctx, surfaces } = input;
  const filters = input.filter ?? {};
  const matched = surfaces.filter((surface) => {
    if (filters.state && surface.governanceState !== filters.state) return false;
    if (filters.channel && !surface.channels.includes(filters.channel as Channel)) return false;
    return true;
  });

  const tabs = [
    { label: "全部", href: "/internal/c", active: !filters.state && !filters.channel },
    ...(Object.keys(STATE_LABEL) as GovernanceState[]).map((state) => ({
      label: STATE_LABEL[state],
      href: `/internal/c?state=${state}`,
      active: filters.state === state,
    })),
    ...(Object.keys(CHANNEL_LABEL) as Channel[]).map((channel) => ({
      label: CHANNEL_LABEL[channel],
      href: `/internal/c?channel=${channel}`,
      active: filters.channel === channel,
    })),
  ];

  const body = `      <main class="int-page">
        <div class="int-page__head">
          <h1 class="int-page__title">目录</h1>
          <p class="int-page__sub">目录是唯一事实来源。Portal、CLI 与 MCP Gateway 消费同一条记录。</p>
        </div>
        <div class="tk-stats">
          ${statBlock(String(ctx.counts.total), "当前可见")}${
    statBlock(String(ctx.counts.byState.pending_public), "待审公开")
  }${statBlock(String(ctx.counts.byState.approved_public), "已公开")}${
    statBlock(String(ctx.counts.byState.draft), "草稿")
  }
        </div>
        <div class="int-filters tk-tabs" role="group" aria-label="筛选">
          ${
    tabs.map((tab) =>
      `<a class="tk-tab" href="${tab.href}"${tab.active ? ' aria-current="true"' : ""}>${
        esc(tab.label)
      }</a>`
    ).join("")
  }
        </div>
        ${
    matched.length === 0
      ? emptyState("没有匹配的记录。", "换一个筛选条件，或先登记一条目录。")
      : `<div class="tk-panel">
          <table class="tk-table">
            <thead>
              <tr>
                <th>名称</th><th>状态</th><th>渠道</th><th>入口</th><th>版本</th><th>更新</th>
              </tr>
            </thead>
            <tbody>
${matched.map(renderCatalogRow).join("\n")}
            </tbody>
          </table>
        </div>`
  }
      </main>`;

  return renderInternalPage({
    ctx,
    screen: "catalog",
    panes: "two",
    title: "目录",
    filter: filters.state ?? filters.channel,
    body,
  });
}

function statBlock(value: string, label: string): string {
  return `<div class="tk-stat"><span class="tk-stat__value">${
    esc(value)
  }</span><span class="tk-stat__label">${esc(label)}</span></div>`;
}

function renderCatalogRow(surface: AgentSurface): string {
  const publicReachable = surface.governanceState === "approved_public";
  return `              <tr>
                <td>
                  <a class="tk-label" href="/internal/s/${esc(surface.id)}">${esc(surface.name)}</a>
                  <div class="tk-id">${esc(surface.id)}</div>
                </td>
                <td>${stateChip(surface.governanceState, { compact: true })}</td>
                <td>${channelChips(surface.channels)}</td>
                <td>${entryValue(surface.entry, { linkable: publicReachable })}</td>
                <td class="tk-num">${esc(surface.version)}</td>
                <td class="tk-meta">${esc(surface.updatedAt.slice(0, 10))}</td>
              </tr>`;
}

/* ── screen 3: 审计 (audit timeline, auditors only) ─────────────────────── */

export interface AuditViewInput {
  ctx: ViewContext;
  events: AuditEvent[];
}

export function renderAuditView(input: AuditViewInput): string {
  const { ctx, events } = input;
  const grouped = events.slice(0, 200);

  const body = `      <main class="int-page">
        <div class="int-page__head">
          <h1 class="int-page__title">审计时间线</h1>
          <p class="int-page__sub">目录变更、身份授权与撤回、凭证作废、公开审批与网关访问。只读，可追加，不可改写。</p>
        </div>
        <div class="int-filters">
          ${boundaryNote("审计结论与维护轨迹分开存储；维护者身份不能覆盖或删除。")}
        </div>
        ${
    grouped.length === 0
      ? emptyState("没有审计事件。", "尚未发生可追溯的治理动作。")
      : `<ol class="tk-timeline">
${grouped.map(renderAuditEvent).join("\n")}
        </ol>`
  }
      </main>`;

  return renderInternalPage({
    ctx,
    screen: "audit",
    panes: "two",
    title: "审计",
    body,
  });
}

const KIND_LABEL: Record<string, string> = {
  catalog: "目录",
  grant: "授权",
  revoke: "撤回身份",
  credential: "凭证",
  approval: "公开审批",
  gateway: "网关访问",
};

function renderAuditEvent(event: AuditEvent): string {
  return `          <li class="tk-timeline__item" data-kind="${esc(event.kind)}">
            <div class="int-audit__event">
              <p class="int-audit__summary">${esc(event.summary)}</p>
              <p class="int-audit__meta">
                <span class="tk-chip tk-chip--plain">${
    esc(KIND_LABEL[event.kind] ?? event.kind)
  }</span>
                <span>${esc(event.action)}</span>
                <span>${esc(event.actor.id)}${
    event.actor.role ? ` · ${esc(event.actor.role)}` : ""
  }</span>
                <span>${esc(event.at.slice(0, 19).replace("T", " "))}</span>
                <span>${esc(event.subjectId)}</span>
              </p>
            </div>
          </li>`;
}

/* ── screen 4: a single record page ─────────────────────────────────────── */

export interface SurfaceViewInput {
  ctx: ViewContext;
  surface: AgentSurface;
  events: AuditEvent[];
}

export function renderSurfaceView(input: SurfaceViewInput): string {
  return renderInternalPage({
    ctx: input.ctx,
    screen: "surface",
    panes: "two",
    title: input.surface.name,
    body: renderReader(input.surface, input.events),
  });
}
