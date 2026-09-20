/**
 * Public view templates.
 *
 * This is the surface an outside reader sees, so it is deliberately the most
 * conservative code in the portal: it may render only `approved_public`
 * records, only as a link an `http(s)` entry that already passed approval, and
 * never as anything a maintainer authored directly. The editorial framing is
 * generated from catalog facts — there is no body field a maintainer could
 * write into, because a writable body would make this a CMS.
 */

import type { Actor, AgentSurface, Channel } from "../../../catalog/types.ts";
import {
  boundaryNote,
  byChannel,
  channelChip,
  channelDescription,
  channelGlyph,
  displaySlashDate,
  dl,
  emptyState,
  entryValue,
  esc,
  maintainerChain,
  publicOnly,
  readingMinutes,
  stateChip,
} from "../components.ts";
import { renderShell, themeSwitch } from "../page.ts";
import { CHANNEL_LABEL, CHANNEL_NOTE } from "../tokens.ts";
import type { PageTheme } from "./types.ts";

export interface PublicContext {
  actor: Actor;
  path: string;
  theme: PageTheme;
  /** Query string of the current page, preserved by the theme switch. */
  query?: string;
}

interface PublicShellInput {
  ctx: PublicContext;
  title: string;
  /** Nav highlight. */
  section: "recommend" | "topics" | "reports";
  body: string;
  bodyAttrs?: string;
}

function renderPublicPage(input: PublicShellInput): string {
  const { ctx } = input;
  const body = `    <header class="pub-masthead">
      <div class="tk-shell pub-masthead__inner">
        <a class="tk-brand" href="/public">
          <span class="tk-brand__dot"></span>
          <span class="tk-brand__mark">Portico</span>
        </a>
        <nav class="pub-nav" aria-label="公开发布">
          <a class="pub-nav__link" href="/">发现</a>
          <a class="pub-nav__link" href="/public"${
    input.section === "recommend" ? ' aria-current="page"' : ""
  }>推荐</a>
          <a class="pub-nav__link" href="/public/t/cli"${
    input.section === "topics" ? ' aria-current="page"' : ""
  }>专题</a>
          <a class="pub-nav__link" href="/public/t/mcp"${
    input.section === "reports" ? ' aria-current="page"' : ""
  }>报告</a>
        </nav>
        <div class="pub-masthead__tools">
          ${ctx.actor.role === "anonymous"
    ? `<a class="pub-nav__link" href="/review/login">审核登录</a>`
    : `<a class="pub-nav__link" href="/review">去审核</a>`}
          <span class="tk-search" aria-hidden="true">
            <span>⌕</span><span>搜索文章、专题或关键词</span>
            <kbd class="tk-search__key">/</kbd>
          </span>
          ${themeSwitch(ctx.theme, ctx.path)}
        </div>
      </div>
    </header>
    <div class="pub-notice">
      <div class="tk-shell pub-notice__inner">
        <span class="pub-notice__dot" aria-hidden="true"></span>
        <span>本页只呈现已通过独立审批的公开登记。未审批对象不进此页。</span>
      </div>
    </div>
${input.body}`;

  return renderShell({
    title: input.title,
    tone: "public",
    theme: ctx.theme,
    path: ctx.path,
    body,
    bodyAttrs: input.bodyAttrs ?? "",
  });
}

function footer(): string {
  return `    <footer class="tk-footer">
      <div class="tk-shell">
        <p><strong>Portico</strong> · Agent 门户与治理层。Agent 不在这里运行；这里只登记、发布、发现、授权和访问。</p>
        <p style="margin-top:6px">公开面只展示已通过独立审批的登记。撤回或拒绝后，入口在这里立即消失。</p>
      </div>
    </footer>`;
}

/** Deterministic generated art; no remote asset can enter the CSP. */
function art(surface: AgentSurface, opts: { size?: "sm"; caption?: string } = {}): string {
  const pattern = hash(surface.id) % 4;
  const glyph = channelGlyph(surface.channels[0] ?? "web");
  const cls = opts.size === "sm" ? "pub-art pub-art--sm" : "pub-art";
  return `<div class="${cls}" data-pattern="${pattern}" aria-hidden="true">
        <span class="pub-art__glyph">${esc(glyph)}</span>
        ${opts.caption ? `<span class="pub-art__caption">${esc(opts.caption)}</span>` : ""}
      </div>`;
}

function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) result = (result * 31 + value.charCodeAt(i)) >>> 0;
  return result;
}

/* ── public index ───────────────────────────────────────────────────────── */

export interface PublicIndexInput {
  ctx: PublicContext;
  /** Surfaces visible to the actor; filtered here to the public boundary. */
  surfaces: AgentSurface[];
}

export function renderPublicIndex(input: PublicIndexInput): string {
  const visible = publicOnly(input.surfaces);
  const groups = byChannel(visible);
  const [lead] = visible;

  const body = `    <main class="tk-shell">
      <section class="pub-band">
        <p class="tk-eyebrow pub-band__eyebrow">Portico · 公开登记</p>
        <h1 class="pub-band__title">已通过审批的 Agent 表面</h1>
        <p class="pub-band__lede">这里发布的是组织的 Agent 治理目录中已跨越公开边界的部分：可发现、可授权的渠道入口，以及它们背后是谁在维护。</p>
        <div class="pub-band__rule"></div>
      </section>
      ${
    visible.length === 0
      ? emptyState("公开发布尚无内容。", "内部记录必须经独立审批后才会出现在这里。")
      : `${renderLead(lead, visible)}
      <div class="pub-well">
        <div class="pub-main">
${groups.map((group) => renderGroup(group.channel, group.items, lead.id)).join("\n")}
        </div>
        ${renderIndexRail(visible, groups)}
      </div>`
  }
    </main>
${footer()}`;

  return renderPublicPage({
    ctx: input.ctx,
    title: "推荐",
    section: "recommend",
    body,
    bodyAttrs: ' data-page="index"',
  });
}

function renderLead(lead: AgentSurface, visible: AgentSurface[]): string {
  return `      <section class="pub-lead">
        <div>
          <div class="pub-lead__kicker">
            <span class="tk-kicker">${
    esc(lead.channels.map((c) => CHANNEL_LABEL[c]).join(" · "))
  }</span>
            ${stateChip(lead.governanceState, { compact: true })}
          </div>
          <h2 class="pub-lead__title"><a href="/public/s/${esc(lead.id)}">${esc(lead.name)}</a></h2>
          <p class="pub-lead__abs">${esc(lead.description)}</p>
          <p class="pub-lead__meta">
            <span>${esc(maintainerChain(lead))}</span>
            <span>·</span>
            <span>${esc(displaySlashDate(lead.updatedAt))}</span>
            <span>·</span>
            <span>v${esc(lead.version)}</span>
            <span>·</span>
            <span>约 ${readingMinutes(lead.description)} 分钟</span>
          </p>
        </div>
        <div class="pub-lead__art">${
    art(lead, { caption: `已公开 ${visible.length} 项登记` })
  }</div>
      </section>`;
}

function renderGroup(
  channel: Channel,
  items: AgentSurface[],
  leadId: string,
): string {
  const stories = items.filter((item) => item.id !== leadId);
  if (stories.length === 0) return "";
  return `          <section class="pub-group">
            <div class="pub-group__head">
              <h2 class="pub-group__title">${esc(CHANNEL_LABEL[channel])}</h2>
              <span class="pub-group__note">${
    esc(CHANNEL_NOTE[channel])
  } · ${stories.length} 项</span>
            </div>
${stories.map((story) => renderStory(story)).join("\n")}
          </section>`;
}

function renderStory(surface: AgentSurface): string {
  return `            <article class="pub-story">
              <div class="pub-story__art">${art(surface, { size: "sm" })}</div>
              <div>
                <p class="pub-story__badge">${
    surface.governanceState === "approved_public" ? "已公开" : "登记"
  }</p>
                <h3 class="pub-story__title"><a href="/public/s/${esc(surface.id)}">${
    esc(surface.name)
  }</a></h3>
                <p class="pub-story__abs tk-clamp-3">${esc(surface.description)}</p>
                <p class="pub-story__meta">
                  <span>${esc(maintainerChain(surface))}</span>
                  <span>·</span>
                  <span>${esc(displaySlashDate(surface.updatedAt))}</span>
                  <span>·</span>
                  <span>约 ${readingMinutes(surface.description)} 分钟</span>
                </p>
              </div>
            </article>`;
}

function renderIndexRail(
  visible: AgentSurface[],
  groups: Array<{ channel: Channel; items: AgentSurface[] }>,
): string {
  const picks = visible.slice(0, 3);
  return `        <aside class="pub-rail">
          <section>
            <div class="pub-rail__head">
              <h2 class="pub-rail__title">专题导航</h2>
              <a class="pub-rail__more" href="/public/t/cli">查看全部 →</a>
            </div>
            ${
    groups.map((group) =>
      `<a class="pub-topic" href="/public/t/${esc(group.channel)}">
                ${art(group.items[0], { size: "sm" })}
                <div>
                  <p class="pub-topic__name">${esc(CHANNEL_LABEL[group.channel])}</p>
                  <p class="pub-topic__note">${esc(channelDescription(group.channel))}</p>
                  <p class="pub-topic__count">${group.items.length} 项登记</p>
                </div>
              </a>`
    ).join("\n            ")
  }
          </section>

          <section>
            <div class="pub-rail__head">
              <h2 class="pub-rail__title">编辑精选</h2>
            </div>
            ${
    picks.map((pick, index) =>
      `<a class="pub-pick" href="/public/s/${esc(pick.id)}">
                <span class="pub-pick__index">0${index + 1}</span>
                <span>
                  <span class="pub-pick__title">${esc(pick.name)}</span>
                  <span class="pub-pick__abs tk-clamp-2">${esc(pick.description)}</span>
                  <span class="pub-pick__date">${esc(displaySlashDate(pick.updatedAt))}</span>
                </span>
              </a>`
    ).join("\n            ")
  }
          </section>

          <section class="pub-card pub-card--tinted">
            <p class="pub-card__quote">公开不是标签，是边界：只有独立审批通过的登记才会出现在这一页。</p>
            <p class="pub-card__sig">— Portico 治理规则</p>
          </section>

          <section class="pub-card">
            <p class="pub-card__quote">内部先可用，公开再决定。可审计优先于编辑体验。</p>
            <p class="pub-card__sig">— 设计取向</p>
          </section>
        </aside>`;
}

/* ── channel topic index ────────────────────────────────────────────────── */

export interface PublicTopicInput {
  ctx: PublicContext;
  surfaces: AgentSurface[];
  channel: Channel;
}

export function renderPublicTopic(input: PublicTopicInput): string {
  const visible = publicOnly(input.surfaces).filter((s) => s.channels.includes(input.channel));
  const body = `    <main class="tk-shell">
      <section class="pub-band">
        <p class="tk-eyebrow pub-band__eyebrow"><a class="tk-link" href="/public">公开登记</a> · 专题</p>
        <h1 class="pub-band__title">${esc(CHANNEL_LABEL[input.channel])}</h1>
        <p class="pub-band__lede">${
    esc(channelDescription(input.channel))
  }。共 ${visible.length} 项已公开登记。</p>
        <div class="pub-band__rule"></div>
      </section>
      <div class="pub-well">
        <div class="pub-main">
          ${
    visible.length === 0 ? emptyState("该渠道暂无公开登记。") : `<section class="pub-group">
            <div class="pub-group__head">
              <h2 class="pub-group__title">全部 ${esc(CHANNEL_LABEL[input.channel])} 登记</h2>
              <span class="pub-group__note">按更新时间排序</span>
            </div>
${visible.map((surface) => renderStory(surface)).join("\n")}
          </section>`
  }
        </div>
        <aside class="pub-rail">
          <section>
            <div class="pub-rail__head"><h2 class="pub-rail__title">其他专题</h2></div>
            ${
    (Object.keys(CHANNEL_LABEL) as Channel[]).map((channel) =>
      `<a class="pub-topic" href="/public/t/${esc(channel)}">
                <span class="tk-chip tk-chip--channel">${esc(CHANNEL_LABEL[channel])}</span>
                <span class="pub-topic__note">${esc(CHANNEL_NOTE[channel])}</span>
              </a>`
    ).join("\n            ")
  }
          </section>
        </aside>
      </div>
    </main>
${footer()}`;

  return renderPublicPage({
    ctx: input.ctx,
    title: CHANNEL_LABEL[input.channel],
    section: "topics",
    body,
    bodyAttrs: ` data-page="topic" data-channel="${esc(input.channel)}"`,
  });
}

/* ── public article ─────────────────────────────────────────────────────── */

export interface PublicArticleInput {
  ctx: PublicContext;
  /** Candidate record; the view re-checks the public boundary before rendering. */
  surface: AgentSurface;
  /** Other public records, for the "继续阅读" rail. */
  others: AgentSurface[];
}

export function renderPublicArticle(input: PublicArticleInput): string | null {
  const allowed = publicOnly([input.surface]);
  if (allowed.length === 0) return null;
  const surface = allowed[0];
  const related = publicOnly(input.others).filter((item) => item.id !== surface.id).slice(0, 3);
  const channels = surface.channels;

  const body = `    <main class="tk-shell pub-article">
      <nav class="pub-crumb int-crumb" aria-label="面包屑">
        <a href="/">发现</a>
        <span class="int-crumb__sep">›</span>
        <a href="/public">首发</a>
        <span class="int-crumb__sep">›</span>
        <a href="/public/t/${esc(channels[0])}">${esc(CHANNEL_LABEL[channels[0]])}</a>
        <span class="int-crumb__sep">›</span>
        <span>${esc(surface.id)}</span>
        <span class="int-crumb__sep">›</span>
        <a href="/s/${esc(surface.id)}">杂志详情</a>
      </nav>

      <header class="pub-article__head">
        <div class="pub-article__eyebrow">
          <span class="tk-kicker">${esc(channels.map((c) => CHANNEL_LABEL[c]).join(" · "))}</span>
          ${stateChip(surface.governanceState, { compact: true })}
        </div>
        <h1 class="pub-article__title">${esc(surface.name)}</h1>
        <p class="pub-article__lede">${esc(surface.description)}</p>
        <div class="pub-article__meta">
          <span>${esc(maintainerChain(surface))}</span>
          <span>${esc(displaySlashDate(surface.updatedAt))}</span>
          <span>约 ${readingMinutes(surface.description)} 分钟阅读</span>
          <span>v${esc(surface.version)}</span>
        </div>
      </header>

      <div class="pub-article__grid">
        <div>
          <div class="pub-prose">
            <h2><span class="pub-prose__index">01</span>它是什么</h2>
            <p>${esc(surface.description)}</p>
            <p>这条登记由 ${esc(maintainerChain(surface))} 维护，当前版本 v${
    esc(surface.version)
  }。它已经通过独立于维护者的公开审批，因此可以在本页被公开发现。</p>

            <h2><span class="pub-prose__index">02</span>如何访问</h2>
            <p>Portico 只发布授权信息，不代理流量、不代跑 Agent。读者拿到入口后由客户端直连。</p>
            <div class="pub-flow">
              <div class="pub-flow__step"><p class="pub-flow__icon">▤</p><p class="pub-flow__name">发现</p><p class="pub-flow__note">本页的公开登记</p></div>
              <span class="pub-flow__arrow" aria-hidden="true">→</span>
              <div class="pub-flow__step"><p class="pub-flow__icon">✓</p><p class="pub-flow__name">授权</p><p class="pub-flow__note">身份与可见性判定</p></div>
              <span class="pub-flow__arrow" aria-hidden="true">→</span>
              <div class="pub-flow__step"><p class="pub-flow__icon">⌘</p><p class="pub-flow__name">${
    esc(CHANNEL_LABEL[channels[0]])
  }</p><p class="pub-flow__note">客户端自行接入</p></div>
              <span class="pub-flow__arrow" aria-hidden="true">→</span>
              <div class="pub-flow__step"><p class="pub-flow__icon">◎</p><p class="pub-flow__name">审计</p><p class="pub-flow__note">访问留痕，不可改写</p></div>
            </div>
            <p>入口：${entryValue(surface.entry, { linkable: true })}</p>
            ${
    channels.map((channel) =>
      `<p><strong>${esc(CHANNEL_LABEL[channel])}</strong> — ${esc(channelDescription(channel))}</p>`
    ).join("\n            ")
  }

            <h2><span class="pub-prose__index">03</span>这条登记为何公开</h2>
            <p>公开是跨越组织信任边界的动作，因此它与内部发布走两条不同的路径：维护者只能把记录提交为公开候选，通过与否由一个不能是提交者本人的人类审计者决定。</p>
            <blockquote class="pub-quote">
              未审批的公开入口在任何渠道都不可见、不可达；审批通过后，它才出现在这里。
              <cite>— Portico 公开发布规则</cite>
            </blockquote>
          </div>
        </div>

        <aside class="pub-rail">
          <section class="pub-facts">
            <div class="pub-facts__head">登记信息</div>
            <div class="pub-facts__body">
              <dl class="tk-dl">
                ${dl("标识", `<span class="tk-id">${esc(surface.id)}</span>`)}
                ${dl("渠道", surface.channels.map(channelChip).join(""))}
                ${dl("版本", `<span class="tk-num">v${esc(surface.version)}</span>`)}
                ${dl("维护者", esc(maintainerChain(surface)))}
                ${dl("治理状态", stateChip(surface.governanceState, { compact: true }))}
              </dl>
            </div>
          </section>

          ${
    related.length === 0 ? "" : `<section>
            <div class="pub-rail__head"><h2 class="pub-rail__title">继续阅读</h2></div>
            ${
      related.map((item, index) =>
        `<a class="pub-pick" href="/public/s/${esc(item.id)}">
                <span class="pub-pick__index">0${index + 1}</span>
                <span>
                  <span class="pub-pick__title">${esc(item.name)}</span>
                  <span class="pub-pick__date">${esc(displaySlashDate(item.updatedAt))}</span>
                </span>
              </a>`
      ).join("\n            ")
    }
          </section>`
  }

          <section>${boundaryNote("Portico 不运行 Agent、不执行工具、不代理推理。")}</section>
        </aside>
      </div>
    </main>
${footer()}`;

  return renderPublicPage({
    ctx: input.ctx,
    title: surface.name,
    section: "recommend",
    body,
    bodyAttrs: ` data-page="article" data-surface="${esc(surface.id)}"`,
  });
}
