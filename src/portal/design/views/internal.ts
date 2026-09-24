/**
 * Internal view templates.
 *
 * Renders the catalog the way an operator reads it: a navigation rail, a record
 * list, and a reader pane. Every page here is behind the internal trust
 * boundary, so it may show `draft`, `pending_public`, maintainers, and audit
 * detail that the public surface must never receive.
 */

import { reviewHref } from "../../review-entry.ts";
import type {
  Actor,
  AgentSurface,
  ApprovalRecord,
  Channel,
  GovernanceState,
  PublicDecision,
} from "../../../catalog/types.ts";
import {
  type AnchorState,
  AS_OF_MAX_LENGTH,
  AUDIT_KINDS,
  type AuditQuery,
  SEAL_PILLARS,
  type SealBreak,
  type SealedPillar,
  type SealPillar,
  type SealReport,
  type StandingConclusion,
} from "../../../audit/mod.ts";
import type { AuditEvent } from "../../../audit/types.ts";
import {
  boundaryNote,
  channelChips,
  channelDescription,
  channelGlyph,
  countBadge,
  dl,
  emptyState,
  entryKindChip,
  entryValue,
  esc,
  maintainerChain,
  readingMinutes,
  relativeAge,
  stat,
  stateChip,
} from "../components.ts";
import { renderShell, themeSwitch } from "../page.ts";
import { CHANNEL_LABEL, STATE_LABEL } from "../tokens.ts";
import type { ReviewEntry } from "../../review-entry.ts";
import type { PageTheme } from "./types.ts";

/** Everything a view needs that is not catalog data. */
export interface ViewContext {
  actor: Actor;
  /** Current request path including query, used by the theme switch. */
  path: string;
  theme: PageTheme;
  /** Catalog counts for the rail; computed from what the actor can see. */
  counts: CountSummary;
  /** The Review entrance this deployment serves; absent means same-origin. */
  reviewEntry?: ReviewEntry;
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
        <form method="post" action="/logout" class="int-logout"><button type="submit">登出</button></form>
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
export type InternalScreen =
  | "content"
  | "catalog"
  | "pending"
  | "approvals"
  | "audit"
  | "surface";

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
    {
      id: "pending",
      href: "/internal?state=pending_public",
      label: "待审",
      count: ctx.counts.byState.pending_public,
    },
    { id: "approvals", href: "/internal/approvals", label: "审批" },
  ];
  // The audit trail is not merely hidden by CSS for a non-auditor: it is absent
  // from the response, so the HTML never leaks that a trail exists.
  if (ctx.actor.kind === "human" && ctx.actor.role === "auditor") {
    items.push({ id: "audit", href: "/internal/audit", label: "审计" });
  }
  const discovery = `<a class="tk-tab" href="/">发现</a>`;
  return discovery +
    items.map((item) =>
      `<a class="tk-tab" href="${item.href}"${
        item.id === screen || (screen === "surface" && item.id === "content")
          ? ' aria-current="true"'
          : ""
      }>${esc(item.label)}${item.count === undefined ? "" : countBadge(item.count)}</a>`
    ).join("");
}

function renderRail(ctx: ViewContext, screen: InternalScreen): string {
  const { byState, total } = ctx.counts;
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
      item("·", STATE_LABEL[state], `/internal?state=${state}`, { count: byState[state] })
    ).join("");

  return `      <nav class="int-rail tk-rail" aria-label="治理导航">
${
    group(
      "工作台",
      item("▤", "全部内容", "/internal", { active: contentActive, count: total }) +
        item("▣", "审批记录", "/internal/approvals", { active: screen === "approvals" }),
    )
  }
${group("治理状态", states)}${
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
  /** `?id=` selection. Absent selects the newest visible record. */
  selectedId?: string;
  /** Governance-status filter from the rail. Unknown values show every record. */
  state?: GovernanceState;
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

  const state = input.state;
  const filtered = state
    ? surfaces.filter((surface) => surface.governanceState === state)
    : surfaces;
  const ordered = [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const lead = ordered.find((surface) => surface.id === input.selectedId) ?? ordered[0];
  if (!lead) {
    return renderInternalPage({
      ctx,
      screen: "content",
      panes: "two",
      title: "内容",
      body: `      <main class="int-page">
        ${emptyState("没有匹配的登记记录。", "换一个治理状态，或当前身份没有可见范围。")}
      </main>`,
    });
  }

  return renderInternalPage({
    ctx,
    screen: "content",
    panes: "three",
    title: "内容",
    body: `      <section class="int-list" aria-label="记录列表">
        <div class="int-list__head">
          <h2 class="int-list__title">${state ? esc(STATE_LABEL[state]) : "全部内容"}</h2>
          <span class="int-list__sort">按更新时间 ↓</span>
        </div>
        <div class="int-list__items">
${ordered.map((surface) => renderRow(surface, surface.id === lead.id, state)).join("\n")}
        </div>
      </section>
${renderReader(lead, ctx, input.recentEvents)}`,
  });
}

function renderRow(surface: AgentSurface, current: boolean, state?: GovernanceState): string {
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  params.set("id", surface.id);
  return `          <a class="int-row" href="/internal?${params.toString()}"${
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
  ctx: ViewContext,
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
              ${governanceActions(ctx, surface)}
              <a class="tk-btn tk-btn--quiet" href="/api/catalog/${esc(surface.id)}">JSON</a>
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

function governanceActions(ctx: ViewContext, surface: AgentSurface): string {
  // The write goes to the Review process, never to this one: the Portal holds no
  // catalog write permission, and these forms are only the browser door to it.
  // A deployment that serves no Review entrance must therefore render no
  // control — an approve button posting into a 404 is a control that lies about
  // what this deployment can do, and `PORTICO_REVIEW_ORIGIN=off` names exactly
  // that deployment (the rule lives in `src/portal/review-entry.ts`).
  const entry = reviewHref(ctx.reviewEntry, true);
  if (entry === undefined) return "";
  const actor = ctx.actor;
  const forms: string[] = [];
  const note =
    `<input class="int-action__note" name="note" maxlength="500" placeholder="备注（可选）" aria-label="备注">`;
  const hidden = `<input type="hidden" name="id" value="${esc(surface.id)}">`;
  const auditor = actor.kind === "human" && actor.role === "auditor";
  const submittedBy = surface.publicSubmission?.submittedBy.id;
  if (auditor && surface.governanceState === "pending_public" && actor.id !== submittedBy) {
    forms.push(
      `<form method="post" action="${
        esc(entry)
      }/approve">${hidden}${note}<button class="tk-btn" type="submit">通过</button></form>`,
      `<form method="post" action="${
        esc(entry)
      }/reject">${hidden}${note}<button class="tk-btn tk-btn--quiet" type="submit">驳回</button></form>`,
    );
  }
  if (auditor && surface.governanceState === "approved_public") {
    forms.push(
      `<form method="post" action="${
        esc(entry)
      }/withdraw">${hidden}${note}<button class="tk-btn tk-btn--quiet" type="submit">撤回</button></form>`,
    );
  }
  const removable = surface.governanceState === "draft" ||
    surface.governanceState === "internal" ||
    surface.governanceState === "rejected";
  if (removable && (actor.role === "maintainer" || auditor)) {
    forms.push(
      `<form method="post" action="${
        esc(entry)
      }/remove">${hidden}<button class="tk-btn tk-btn--quiet" type="submit">删除</button></form>`,
    );
  }
  if (forms.length === 0) return "";
  return `<span class="int-actionbar">${forms.join("")}</span>`;
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

  const body = `      <main class="int-page">
        <div class="int-page__head">
          <h1 class="int-page__title">目录</h1>
          <p class="int-page__sub">目录是唯一事实来源。Portal、CLI 与 MCP Gateway 消费同一条记录。</p>
        </div>
        <div class="tk-stats">
          ${statBlock(String(ctx.counts.total), "当前可见")}${
    statBlock(
      String(ctx.counts.byState.pending_public),
      "待审公开",
      "/internal?state=pending_public",
    )
  }${statBlock(String(ctx.counts.byState.approved_public), "已公开")}${
    statBlock(String(ctx.counts.byState.draft), "草稿")
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

function statBlock(value: string, label: string, href?: string): string {
  const inner = `<span class="tk-stat__value">${esc(value)}</span><span class="tk-stat__label">${
    esc(label)
  }</span>`;
  if (href) return `<a class="tk-stat" href="${esc(href)}">${inner}</a>`;
  return `<div class="tk-stat">${inner}</div>`;
}

const DECISION_LABEL: Record<PublicDecision, string> = {
  approved: "通过",
  rejected: "驳回",
  withdrawn: "撤回",
};

export interface PendingViewInput {
  ctx: ViewContext;
  /** All visible `pending_public` records. Channel filtering happens in the view so tab counts stay unfiltered. */
  surfaces: readonly AgentSurface[];
  /** Read-only channel filter from `?channel=`. Unknown values are ignored. */
  channel?: Channel | null;
}

export function renderPendingView(input: PendingViewInput): string {
  const { ctx, surfaces } = input;
  const channel = input.channel ?? null;
  const byChannel: Record<Channel, number> = { cli: 0, mcp: 0, web: 0 };
  for (const surface of surfaces) {
    for (const item of surface.channels) byChannel[item] += 1;
  }
  const matched = surfaces.filter((surface) => !channel || surface.channels.includes(channel));
  const ordered = [...matched].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const tabs = [
    { label: "全部", href: "/internal/pending", active: channel === null, count: surfaces.length },
    ...(Object.keys(CHANNEL_LABEL) as Channel[]).map((item) => ({
      label: CHANNEL_LABEL[item],
      href: `/internal/pending?channel=${item}`,
      active: channel === item,
      count: byChannel[item],
    })),
  ];
  const empty = channel
    ? emptyState("没有匹配的待审公开。", "换一个渠道筛选，或先把该渠道的内部记录提交为公开候选。")
    : emptyState(
      "当前没有待审公开。",
      "维护者把内部或草稿提交为公开候选后会出现在这里。匿名始终看不到这些记录。",
    );
  const body = `      <main class="int-page">
        <div class="int-page__head">
          <h1 class="int-page__title">待审队列</h1>
          <p class="int-page__sub">已提交公开、尚未独立审批的候选。与目录 <code>pending_public</code> 同一批可见记录。可按渠道（cli / mcp / web）只读筛选，筛选 tab 显示该渠道待审计数；入口标明种类（url / package / mcp_endpoint），引用以转义文本展示，不可点击。只读，不能从 Portal 批准或驳回。已作出的决定在 <a class="tk-link" href="/internal/approvals">审批记录</a>。</p>
        </div>
        ${
    boundaryNote("Portal 不能批准或驳回。公开边界上的决定在审批记录里，待审候选只出现在这里。")
  }
        <div class="int-filters tk-tabs" role="group" aria-label="筛选">
          ${
    tabs.map((tab) =>
      `<a class="tk-tab" href="${tab.href}"${tab.active ? ' aria-current="true"' : ""}>${
        esc(tab.label)
      }${countBadge(tab.count)}</a>`
    ).join("")
  }
        </div>
        ${
    ordered.length === 0 ? empty : `<div class="tk-panel">
          <table class="tk-table">
            <thead>
              <tr>
                <th>名称</th><th>状态</th><th>提交者</th><th>提交时间</th><th>渠道</th><th>种类</th><th>入口</th><th>版本</th>
              </tr>
            </thead>
            <tbody>
${ordered.map(renderPendingRow).join("\n")}
            </tbody>
          </table>
        </div>`
  }
      </main>`;

  return renderInternalPage({
    ctx,
    screen: "pending",
    panes: "two",
    title: "待审队列",
    body,
  });
}

function renderPendingRow(surface: AgentSurface): string {
  const submittedBy = surface.publicSubmission?.submittedBy.id ?? "—";
  const submittedAt = surface.publicSubmission?.submittedAt.slice(0, 19).replace("T", " ") ??
    "—";
  return `              <tr data-state="${esc(surface.governanceState)}">
                <td>
                  <a class="tk-label" href="/internal?id=${esc(surface.id)}">${
    esc(surface.name)
  }</a>
                  <div class="tk-id">${esc(surface.id)}</div>
                </td>
                <td>${stateChip(surface.governanceState, { compact: true })}</td>
                <td class="tk-meta">${esc(submittedBy)}</td>
                <td class="tk-meta">${esc(submittedAt)}</td>
                <td>${channelChips(surface.channels)}</td>
                <td>${entryKindChip(surface.entry.kind)}</td>
                <td>${entryValue(surface.entry, { linkable: false })}</td>
                <td class="tk-num">${esc(surface.version)}</td>
              </tr>`;
}

export interface ApprovalsViewInput {
  ctx: ViewContext;
  records: readonly ApprovalRecord[];
}

export function renderApprovalsView(input: ApprovalsViewInput): string {
  const { ctx, records } = input;
  const body = `      <main class="int-page">
        <div class="int-page__head">
          <h1 class="int-page__title">审批记录</h1>
          <p class="int-page__sub">通过、驳回与撤回的只读历史。与 CLI catalog approvals、Portal GET /api/approvals、MCP portico_approvals 同一批记录。日常通过、驳回、撤回和删除在内容详情上，按当前身份显示。备注不能事后修改。</p>
        </div>
        ${boundaryNote("这里只回放已经作出的决定。待审候选不出现在这份轨迹里。")}
        ${
    records.length === 0
      ? emptyState(
        "还没有公开边界上的审批记录。",
        "待审公开不会出现在这里。批准、驳回或撤回之后才会追加。",
      )
      : `<div class="tk-panel">
          <table class="tk-table">
            <thead>
              <tr>
                <th>名称</th><th>决定</th><th>备注</th><th>审计者</th><th>时间</th><th>版本</th>
              </tr>
            </thead>
            <tbody>
${records.map(renderApprovalRow).join("\n")}
            </tbody>
          </table>
        </div>`
  }
      </main>`;

  return renderInternalPage({
    ctx,
    screen: "approvals",
    panes: "two",
    title: "审批记录",
    body,
  });
}

function renderApprovalRow(record: ApprovalRecord): string {
  const note = record.note ? esc(record.note) : "—";
  return `              <tr data-decision="${esc(record.decision)}">
                <td>
                  <a class="tk-label" href="/internal?id=${esc(record.surfaceId)}">${
    esc(record.name)
  }</a>
                  <div class="tk-id">${esc(record.surfaceId)}</div>
                </td>
                <td><span class="tk-chip tk-chip--plain">${
    esc(DECISION_LABEL[record.decision] ?? record.decision)
  }</span></td>
                <td>${note}</td>
                <td class="tk-meta">${esc(record.reviewedBy.id)}</td>
                <td class="tk-meta">${esc(record.reviewedAt.slice(0, 19).replace("T", " "))}</td>
                <td class="tk-num">${esc(record.version)}</td>
              </tr>`;
}

function renderCatalogRow(surface: AgentSurface): string {
  const publicReachable = surface.governanceState === "approved_public";
  return `              <tr>
                <td>
                  <a class="tk-label" href="/internal?id=${esc(surface.id)}">${
    esc(surface.name)
  }</a>
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

const PILLAR_LABEL: Record<SealPillar, string> = {
  catalog: "目录",
  identity: "身份",
  gateway: "网关",
  conclusions: "审计结论",
};

const ANCHOR_LABEL: Record<AnchorState, string> = {
  intact: "检查点仍完好",
  moved: "该支柱的 tip 换了位置",
  truncated: "链条短于检查点，疑似截断",
  rewritten: "同一位置的内容被换过，疑似重写",
};

/** The same four readings, short enough for a chip. */
const ANCHOR_SHORT: Record<AnchorState, string> = {
  intact: "检查点相合",
  moved: "检查点漂移",
  truncated: "尾部被截断",
  rewritten: "内容被替换",
};

const BREAK_LABEL: Record<SealBreak["reason"], string> = {
  digest: "记录被改写",
  missing: "记录被删除",
  chain: "环节被剪断",
};

/**
 * What the seal proved, rendered next to the records it covers.
 *
 * The page below this panel asserts that the trail is append-only and cannot be
 * rewritten. That sentence is a claim about bytes, and until now nothing on the
 * page carried its evidence — an edited `catalog.json` rendered as an ordinary
 * timeline. This panel states the verdict and, when there is one, names the
 * record that broke it, using the same numbers the CLI and MCP entrances report.
 *
 * Three honest silences it keeps, all of them inherited from the seal itself: a
 * record no link covers is counted as `未封` rather than blessed; a pillar whose
 * tip no checkpoint pins is reported as having no way to be compared; and a
 * pillar this deployment does not configure is reported as not checked, because
 * showing it as verified would be the same silence in a new place.
 *
 * The page can also be read through a cutoff, which the verdicts and the trail
 * follow. This panel does not and cannot: a check re-reads the files as they
 * stand, and nothing stored holds their past. So it declares its own window
 * (`data-window="current"`, the same declaration the machine payload carries)
 * and, on a page that is sliced, says out loud that the cutoff did not reach
 * it — an `ok` read beside a historical trail would otherwise pass for the
 * verdict of that instant.
 */
function renderIntegrityPanel(report: SealReport, asOf?: string): string {
  const checked = new Map(report.pillars.map((verdict) => [verdict.pillar, verdict]));
  const unchecked = SEAL_PILLARS.filter((pillar) => !checked.has(pillar));
  const sealed = report.pillars.reduce((total, verdict) => total + verdict.sealed, 0);
  const unanchored = report.pillars.length - report.anchored;

  // `report.ok` folds two different findings together: a link chain that no
  // longer matches its records, and a checkpoint that no longer matches the
  // chain. They are named separately, because "the records were edited" and
  // "the tail is gone" call for different reactions.
  const broken = report.pillars.filter((verdict) => !verdict.ok);
  const moved = report.pillars.filter(
    (verdict) => verdict.anchor !== undefined && verdict.anchor.state !== "intact",
  );
  const facts: string[] = [];
  if (report.ok) {
    facts.push("封条完整：已覆盖的记录与写入时对得上");
  } else if (broken.length > 0 && moved.length > 0) {
    facts.push("封条校验失败：链条与检查点都与写入时对不上");
  } else if (broken.length > 0) {
    facts.push("封条校验失败：已覆盖的记录与写入时对不上");
  } else {
    facts.push("封条校验失败：检查点显示链条已被替换或截断");
  }
  if (report.unsealed > 0) facts.push(`${report.unsealed} 条记录没有任何环节覆盖`);
  if (unanchored > 0) facts.push(`${unanchored} 个支柱的 tip 没有检查点可比对`);
  if (unchecked.length > 0) {
    facts.push(`${unchecked.length} 个支柱未纳入本次校验`);
  }

  const pillars = SEAL_PILLARS.map((pillar) => {
    const verdict = checked.get(pillar);
    const anchor = verdict?.anchor;
    const meta = verdict
      ? [
        `${verdict.sealed} 条已封`,
        verdict.unsealed.length > 0 ? `${verdict.unsealed.length} 条未封` : undefined,
        anchor ? ANCHOR_LABEL[anchor.state] : "无检查点",
        anchor ? `检查点取自 ${relativeAge(anchor.at)}` : undefined,
      ].filter((part): part is string => part !== undefined).join(" · ")
      : "本次部署未读取这一支柱";

    return `            <li class="int-integrity__pillar" data-pillar="${
      esc(pillar)
    }" data-verdict="${verdict ? (verdict.ok ? "ok" : "broken") : "unchecked"}"${
      verdict ? ` data-sealed="${verdict.sealed}" data-unsealed="${verdict.unsealed.length}"` : ""
    }${anchor ? ` data-anchor="${esc(anchor.state)}"` : verdict ? ` data-anchor="none"` : ""}>
              <p class="int-integrity__pillar-head">
                <span class="int-integrity__pillar-name">${esc(PILLAR_LABEL[pillar])}</span>
                <span class="tk-chip tk-chip--plain">${
      verdict === undefined
        ? "未校验"
        : !verdict.ok
        ? "已断"
        : anchor && anchor.state !== "intact"
        ? ANCHOR_SHORT[anchor.state]
        : "封条完整"
    }</span>
              </p>
              <p class="int-integrity__pillar-meta">${esc(meta)}</p>${
      renderIntegrityFaults(verdict)
    }
            </li>`;
  }).join("\n");

  return `<section class="int-integrity" data-integrity="${
    report.ok ? "ok" : "broken"
  }" data-window="current" data-sealed="${sealed}" data-unsealed="${report.unsealed}" data-anchored="${report.anchored}" data-pillars="${SEAL_PILLARS.length}">
          <div class="int-integrity__head">
            <h2 class="int-integrity__title">封条校验</h2>
            <p class="int-integrity__verdict">${esc(facts.join("；"))}</p>
          </div>
          ${
    asOf
      ? `<p class="int-integrity__scope">读取窗口不作用于这一面板：封条校验没有历史模式，它读的始终是当前文件。截至 <time datetime="${
        esc(
          asOf,
        )
      }">${
        esc(asOf)
      }</time> 的窗口只作用于「当时判定」与下方时间线，不能把这个判决读成那一刻的封条状态。</p>`
      : ""
  }
          <div class="int-integrity__stats">
            ${stat(sealed, "已封记录")}
            ${stat(report.unsealed, "未封记录")}
            ${stat(`${report.anchored}/${SEAL_PILLARS.length}`, "已锚定支柱")}
          </div>
          ${
    boundaryNote(
      "校验只读：只报告事实，不改写记录。封条只证明相邻环节自洽，整链重写与尾部截断要靠检查点发现。",
    )
  }
          <ol class="int-integrity__pillars">
${pillars}
          </ol>
        </section>`;
}

/** The named record and the uncovered records, if the pillar has either. */
function renderIntegrityFaults(verdict: SealedPillar | undefined): string {
  if (!verdict) return "";
  const lines: string[] = [];
  const broken = verdict.break;
  if (broken) {
    lines.push(
      `<p class="int-integrity__break" data-break-seq="${broken.seq}" data-break-kind="${
        esc(broken.kind)
      }" data-break-id="${esc(broken.id)}" data-break-reason="${
        esc(broken.reason)
      }">第 ${broken.seq} 条${esc(BREAK_LABEL[broken.reason])}：${esc(broken.kind)} · ${
        esc(broken.id)
      }</p>`,
    );
  }
  if (verdict.unsealed.length > 0) {
    lines.push(
      `<p class="int-integrity__unsealed">没有环节覆盖：${
        verdict.unsealed.map((id) => esc(id)).join("、")
      }</p>`,
    );
  }
  if (lines.length === 0) return "";
  return `\n              ${lines.join("\n              ")}`;
}

/** The human auditor's question, short enough for one row. */
const SCOPE_LABEL: Record<string, string> = {
  public_boundary: "公开边界",
  entry_target: "入口指向",
  permission_change: "权限变化",
  secret_leakage: "密钥泄漏",
  gateway_scope: "网关越权",
  runtime_l0: "运行时边界",
};

/**
 * What the human audit says *now* about each subject it has reviewed.
 *
 * The timeline below is append-only, which is the right shape for evidence and
 * the wrong shape for an answer: "is this still flagged?" is the last line of a
 * list that keeps growing. This panel computes that answer from the same trail
 * the CLI `audit standings` and the MCP tool return, so the portal cannot hold a
 * second opinion. It adds no way to write one.
 *
 * Three silences it keeps. Only reviewed subjects appear, so an empty panel
 * means no verdict was recorded, never "everything passed". A cleared subject
 * that was flagged before keeps its flag count, so "found and fixed" does not
 * read like "never flagged". And a cleared subject without an audit note is
 * still shown as having no note, because the note is the auditor's, not ours.
 *
 * With a cutoff the same panel answers the same question about another instant,
 * and says so: a historical verdict that does not announce its window reads
 * exactly like the current one, which is how a reconstruction gets mistaken for
 * a status. The window is printed above the rows and carried on the section, so
 * it survives being copied out of the page.
 */
function renderStandingsPanel(
  standings: readonly StandingConclusion[],
  asOf?: string,
): string {
  const flagged = standings.filter((item) => item.verdict === "flagged");
  const rows = standings.map((item) => {
    const cleared = item.verdict === "cleared";
    const meta = [
      `本次判定 ${relativeAge(item.at)}`,
      item.count > 1 ? `共 ${item.count} 条结论` : "仅有这一条结论",
      item.flagged > 0 ? `其中 ${item.flagged} 次标记` : undefined,
      item.previousVerdict === "flagged" ? `上一条判定为标记，后来被清除` : undefined,
    ].filter((part): part is string => part !== undefined).join(" · ");
    return `            <li class="int-standings__row" data-subject="${
      esc(item.subjectId)
    }" data-scope="${esc(item.scope)}" data-verdict="${
      esc(item.verdict)
    }" data-count="${item.count}" data-flagged="${item.flagged}"${
      item.gate ? ` data-gate="${esc(item.gate)}"` : ""
    }>
              <p class="int-standings__head">
                <span class="int-standings__subject">${esc(item.subjectId)}</span>
                <span class="tk-chip tk-chip--plain">${
      esc(SCOPE_LABEL[item.scope] ?? item.scope)
    }</span>
                <span class="tk-chip tk-chip--${cleared ? "plain" : "accent"}">${
      cleared ? "已清除" : "仍标记"
    }</span>
              </p>
              <p class="int-standings__meta">${esc(meta)}</p>
              <p class="int-standings__note">${
      item.note ? esc(item.note) : "这一条结论没有留下说明"
    }</p>
              <p class="int-standings__source">${esc(item.conclusionId)} · 由 ${
      esc(item.auditorId)
    } 判定</p>
            </li>`;
  }).join("\n");

  return `<section class="int-standings" data-standings="${standings.length}" data-window="as-of" data-flagged="${flagged.length}"${
    asOf ? ` data-asof="${esc(asOf)}"` : ""
  }>
          <div class="int-standings__intro">
            <h2 class="int-standings__title">${asOf ? "当时判定" : "当前判定"}</h2>
            <p class="int-standings__sub">${
    asOf
      ? "人类安全审计对每个已审主体留下的最新结论，只算窗口内的结论。只列出审过的对象；列表为空表示该时刻还没有任何判定，不是「全部通过」。"
      : "人类安全审计对每个已审主体留下的最新结论。只列出审过的对象；列表为空表示还没有留下判定，不是「全部通过」。"
  }</p>
            ${
    asOf
      ? `<p class="int-standings__window">读取窗口：截至 <time datetime="${esc(asOf)}">${
        esc(asOf)
      }</time>。这是按当时的结论重建的判定，之后发生的结论不在窗口内，也不代表今天的判定。</p>`
      : ""
  }
          </div>
          ${
    boundaryNote(
      asOf
        ? "只读回溯：窗口内的判定由审计结论派生，门户不能替人类写下、改写或删除任何一条结论。"
        : "只读视图：判定由审计结论派生，门户不能替人类写下或改写任何一条结论。",
    )
  }
          ${
    standings.length === 0
      ? asOf
        ? emptyState("该时刻没有审计结论。", `截至 ${asOf} 还没有人类审计者对任何主体作出判定。`)
        : emptyState("没有审计结论。", "还没有人类审计者对本部署的任何主体作出判定。")
      : `<ol class="int-standings__rows">
${rows}
          </ol>`
  }
        </section>`;
}

export interface AuditViewInput {
  ctx: ViewContext;
  events: AuditEvent[];
  query?: AuditQuery;
  /**
   * The seal verdict for the trail being rendered. Required, not optional: this
   * page asserts the trail cannot be rewritten, and an assertion without its
   * evidence is exactly the silence the seal exists to remove.
   */
  integrity: SealReport;
  /**
   * The standing verdict for every subject this deployment's auditor has
   * concluded on. Required for the same reason as `integrity`: a page whose
   * subject is the human audit must say what the human audit currently finds,
   * and an omitted panel would read as "nothing is flagged".
   */
  standings: readonly StandingConclusion[];
}

/**
 * The audit page carries the trail filter in its query string, so dropping the
 * cutoff here is what "read the same thing without the window" means: the link
 * back to the present must not quietly drop the reader's other filters too.
 */
function currentWindowHref(query: AuditQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.kind) params.set("kind", query.kind);
  if (query.action) params.set("action", query.action);
  if (query.subject) params.set("subject", query.subject);
  const rest = params.toString();
  return rest ? `/internal/audit?${rest}` : "/internal/audit";
}

export function renderAuditView(input: AuditViewInput): string {
  const { ctx, events } = input;
  const query = input.query ?? {};
  const grouped = events.slice(0, 200);
  const kindOptions = [
    `<option value=""${query.kind ? "" : " selected"}>全部种类</option>`,
    ...AUDIT_KINDS.map((kind) =>
      `<option value="${esc(kind)}"${query.kind === kind ? " selected" : ""}>${
        esc(KIND_LABEL[kind] ?? kind)
      }</option>`
    ),
  ].join("");

  const body = `      <main class="int-page">
        <div class="int-page__head">
          <h1 class="int-page__title">审计时间线</h1>
          <p class="int-page__sub">目录变更、身份授权与撤回、凭证作废、公开审批与网关访问。只读，可追加，不可改写。</p>
        </div>
        ${renderIntegrityPanel(input.integrity, query.asOf)}
        ${renderStandingsPanel(input.standings, query.asOf)}
        <div class="int-filters">
          ${boundaryNote("审计结论与维护轨迹分开存储；维护者身份不能覆盖或删除。")}
          <form method="get" action="/internal/audit" role="search">
            <input type="search" name="q" value="${
    esc(query.q ?? "")
  }" maxlength="120" placeholder="按摘要、主体或动作过滤" aria-label="过滤审计时间线">
            <select name="kind" aria-label="事件种类">${kindOptions}</select>
            <input type="text" name="asOf" value="${
    esc(query.asOf ?? "")
  }" maxlength="${AS_OF_MAX_LENGTH}" placeholder="2026-09-21T12:00:00Z" aria-label="读取窗口的截止时刻，必须带时区">
            <button type="submit">过滤</button>
            ${
    query.asOf
      ? `<a class="int-filters__reset" href="${esc(currentWindowHref(query))}">回到当前窗口</a>`
      : ""
  }
          </form>
          <p class="int-filters__hint">截止时刻必须带时区（例如 2026-09-21T12:00:00Z）；留空表示读到当前。只接受真实存在的时刻，「2026-02-30」这类日期会被拒绝，而不是被挪到另一天。</p>
        </div>
        ${
    grouped.length === 0
      ? query.asOf
        ? emptyState(
          "该时刻没有审计事件。",
          `截至 ${query.asOf} 还没有发生可追溯的治理动作。`,
        )
        : emptyState("没有审计事件。", "尚未发生可追溯的治理动作。")
      : `<ol class="tk-timeline" data-window="as-of"${
        query.asOf ? ` data-asof="${esc(query.asOf)}"` : ""
      }>
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
    body: renderReader(input.surface, input.ctx, input.events),
  });
}
