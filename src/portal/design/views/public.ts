/**
 * Public view templates.
 *
 * This is the surface an outside reader sees, so it is deliberately the most
 * conservative code in the portal: it may render only `approved_public`
 * records, only as a link an `http(s)` entry that already passed approval, and
 * never as anything a maintainer authored directly. The editorial framing is
 * generated from catalog facts — there is no body field a maintainer could
 * write into, because a writable body would make this a CMS.
 *
 * The publication has exactly two sections: 发现 (everything public, newest
 * first) and 推荐 (the maintainers' curated picks). Anything finer is a tag.
 * There is no second classification axis — no channel topics, no 栏目.
 */

import type { Actor, AgentSurface } from "../../../catalog/types.ts";
import { applyCatalogQuery, CATALOG_QUERY_MAX_Q } from "../../../catalog/query.ts";
import {
  boundaryNote,
  channelChip,
  channelDescription,
  channelGlyph,
  displaySlashDate,
  dl,
  emptyState,
  entryValue,
  esc,
  isHttpUrl,
  maintainerChain,
  publicOnly,
  readingMinutes,
  stateChip,
  tagChips,
  tagHref,
} from "../components.ts";
import { renderShell, themeSwitch } from "../page.ts";
import { CHANNEL_LABEL } from "../tokens.ts";
import type { ReviewEntry } from "../../review-entry.ts";
import type { PageTheme } from "./types.ts";

export interface PublicContext {
  actor: Actor;
  path: string;
  theme: PageTheme;
  /**
   * The Review entrance this deployment serves. Absent means the same-origin
   * default; `{ kind: "none" }` removes the Review link from this plane too.
   */
  reviewEntry?: ReviewEntry;
}

/** The reader's 发现 filter. Both fields are already parsed by the catalog query. */
export interface PublicFilter {
  q?: string;
  tag?: string;
}

type PublicSection = "discover" | "picks";

interface PublicShellInput {
  ctx: PublicContext;
  title: string;
  /** Nav highlight; absent on pages that belong to neither section. */
  section?: PublicSection;
  body: string;
  bodyAttrs?: string;
  /** Carried by the search form so a search keeps the tag being read. */
  filter?: PublicFilter;
}

function renderPublicPage(input: PublicShellInput): string {
  const { ctx } = input;
  const signedIn = ctx.actor.role !== "anonymous";
  // A signed-in reader gets the way back into the workbench. Anonymous callers
  // see no such link, and `/internal` keeps answering them with a login
  // redirect rather than advertising what is behind it.
  const session = signedIn
    ? `<a class="pub-nav__link" href="/internal">内部工作台</a><span class="tk-meta">${
      esc(ctx.actor.id)
    }</span><form method="post" action="/logout" class="int-logout"><button type="submit">登出</button></form>`
    : `<a class="pub-nav__link" href="/login">登录</a>`;
  const current = (section: PublicSection) =>
    input.section === section ? ' aria-current="page"' : "";
  const body = `    <header class="pub-masthead">
      <div class="tk-shell pub-masthead__inner">
        <a class="tk-brand" href="/public">
          <span class="tk-brand__dot"></span>
          <span class="tk-brand__mark">Portico</span>
        </a>
        <nav class="pub-nav" aria-label="公开发布">
          <a class="pub-nav__link" href="/public"${current("discover")}>发现</a>
          <a class="pub-nav__link" href="/public/picks"${current("picks")}>推荐</a>
        </nav>
        <div class="pub-masthead__tools">
          ${searchForm(ctx, input.filter)}
          ${session}
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

/**
 * A real search: a plain GET form into 发现, so it works without script and
 * stays inside the CSP. It searches the same id / name / description fields
 * as `catalog list --q`, and only over records already on the public face.
 */
function searchForm(ctx: PublicContext, filter: PublicFilter = {}): string {
  const hidden = [
    filter.tag ? `<input type="hidden" name="tag" value="${esc(filter.tag)}">` : "",
    ctx.theme.request ? `<input type="hidden" name="theme" value="${esc(ctx.theme.request)}">` : "",
  ].join("");
  return `<form class="pub-search" method="get" action="/public" role="search">${hidden}<input type="search" name="q" value="${
    esc(filter.q ?? "")
  }" maxlength="${CATALOG_QUERY_MAX_Q}" placeholder="搜索公开登记" aria-label="搜索公开登记"><button type="submit">搜索</button></form>`;
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

function channelKicker(surface: AgentSurface): string {
  return surface.channels.map((c) => CHANNEL_LABEL[c]).join(" · ");
}

/* ── 发现 ───────────────────────────────────────────────────────────────── */

export interface PublicIndexInput {
  ctx: PublicContext;
  /** Surfaces visible to the actor; filtered here to the public boundary. */
  surfaces: AgentSurface[];
  filter?: PublicFilter;
  /** Curated picks already narrowed to the public face, in curated order. */
  picks?: AgentSurface[];
}

export function renderPublicIndex(input: PublicIndexInput): string {
  const visible = publicOnly(input.surfaces);
  const filter = input.filter ?? {};
  const filtering = Boolean(filter.q || filter.tag);
  const shown = filtering ? applyCatalogQuery(visible, filter) : visible;
  const [lead] = filtering ? [] : shown;
  const stories = lead ? shown.filter((item) => item.id !== lead.id) : shown;

  const band = filtering ? filterBand(filter, shown.length) : `      <section class="pub-band">
        <p class="tk-eyebrow pub-band__eyebrow">Portico · 发现</p>
        <h1 class="pub-band__title">已通过审批的 Agent 表面</h1>
        <p class="pub-band__lede">这里发布的是组织的 Agent 治理目录中已跨越公开边界的部分：可发现、可授权的渠道入口，以及它们背后是谁在维护。</p>
        <div class="pub-band__rule"></div>
      </section>`;

  let content: string;
  if (visible.length === 0) {
    content = emptyState("公开发布尚无内容。", "内部记录必须经独立审批后才会出现在这里。");
  } else {
    const main = shown.length === 0
      ? emptyState("没有匹配的公开登记。", "换个关键词或标签，或清除筛选。")
      : stories.length === 0
      ? ""
      : `<section class="pub-group">
            <div class="pub-group__head">
              <h2 class="pub-group__title">${filtering ? "结果" : "最新"}</h2>
              <span class="pub-group__note">按更新时间 · ${stories.length} 项</span>
            </div>
${stories.map(renderStory).join("\n")}
          </section>`;
    content = `${lead ? renderLead(lead, visible.length) : ""}
      <div class="pub-well">
        <div class="pub-main">
          ${main}
        </div>
        ${renderRail(visible, filter.tag, input.picks ?? [])}
      </div>`;
  }

  const body = `    <main class="tk-shell">
${band}
      ${content}
    </main>
${footer()}`;

  return renderPublicPage({
    ctx: input.ctx,
    title: filter.tag ? `#${filter.tag}` : "发现",
    section: "discover",
    body,
    bodyAttrs: ' data-page="discover"',
    filter,
  });
}

function filterBand(filter: PublicFilter, count: number): string {
  const title = [
    filter.tag ? `#${filter.tag}` : "",
    filter.q ? `“${filter.q}”` : "",
  ].filter(Boolean).join(" · ");
  return `      <section class="pub-band pub-band--filter">
        <p class="tk-eyebrow pub-band__eyebrow"><a class="tk-link" href="/public">发现</a> · ${
    filter.tag ? "标签" : "搜索"
  }</p>
        <h1 class="pub-band__title">${esc(title)}</h1>
        <p class="pub-band__lede">共 ${count} 项公开登记。<a class="tk-link" href="/public">清除筛选</a></p>
        <div class="pub-band__rule"></div>
      </section>`;
}

function renderLead(lead: AgentSurface, total: number): string {
  return `      <section class="pub-lead">
        <div>
          <div class="pub-lead__kicker">
            <span class="tk-kicker">${esc(channelKicker(lead))}</span>
            ${stateChip(lead.governanceState, { compact: true })}
          </div>
          <h2 class="pub-lead__title"><a href="/public/s/${esc(lead.id)}">${esc(lead.name)}</a></h2>
          <p class="pub-lead__abs tk-clamp-3">${esc(lead.description)}</p>
          <p class="pub-lead__meta">
            <span>${esc(maintainerChain(lead))}</span>
            <span>·</span>
            <span>${esc(displaySlashDate(lead.updatedAt))}</span>
            <span>·</span>
            <span>v${esc(lead.version)}</span>
            <span>·</span>
            <span>约 ${readingMinutes(lead.description)} 分钟</span>
          </p>
          ${tagChips(lead.tags, { linked: true })}
        </div>
        <div class="pub-lead__art">${art(lead, { caption: `已公开 ${total} 项登记` })}</div>
      </section>`;
}

function renderStory(surface: AgentSurface): string {
  return `            <article class="pub-story" data-surface="${esc(surface.id)}">
              <div class="pub-story__art">${art(surface, { size: "sm" })}</div>
              <div>
                <p class="pub-story__badge">${esc(channelKicker(surface))}</p>
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
                ${tagChips(surface.tags, { linked: true })}
              </div>
            </article>`;
}

/** Every tag on the public face, most used first. */
function tagIndex(surfaces: readonly AgentSurface[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const surface of surfaces) {
    for (const tag of surface.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function renderRail(
  visible: readonly AgentSurface[],
  currentTag: string | undefined,
  picks: readonly AgentSurface[],
): string {
  const tags = tagIndex(visible);
  const tagSection = tags.length === 0 ? "" : `<section>
            <div class="pub-rail__head"><h2 class="pub-rail__title">标签</h2></div>
            <div class="pub-tags">
              ${
    tags.map(({ tag, count }) =>
      `<a class="pub-tag" href="${esc(tagHref(tag))}"${
        tag === currentTag ? ' aria-current="page"' : ""
      }>#${esc(tag)}<span class="pub-tag__count">${count}</span></a>`
    ).join("\n              ")
  }
            </div>
          </section>`;
  const pickSection = picks.length === 0 ? "" : `<section>
            <div class="pub-rail__head">
              <h2 class="pub-rail__title">推荐</h2>
              <a class="pub-rail__more" href="/public/picks">查看全部 →</a>
            </div>
            ${
    picks.slice(0, 3).map((pick, index) =>
      `<a class="pub-pick" href="/public/s/${esc(pick.id)}">
                <span class="pub-pick__index">0${index + 1}</span>
                <span>
                  <span class="pub-pick__title">${esc(pick.name)}</span>
                  <span class="pub-pick__date">${esc(displaySlashDate(pick.updatedAt))}</span>
                </span>
              </a>`
    ).join("\n            ")
  }
          </section>`;
  return `<aside class="pub-rail">
          ${pickSection}
          ${tagSection}
          <section>${boundaryNote("Portico 不运行 Agent、不执行工具、不代理推理。")}</section>
        </aside>`;
}

/* ── 推荐 ───────────────────────────────────────────────────────────────── */

export interface PublicPicksInput {
  ctx: PublicContext;
  /** Curated picks already narrowed to the public face, in curated order. */
  picks: AgentSurface[];
  /** Surfaces visible to the actor, for the tag rail; filtered here too. */
  surfaces: AgentSurface[];
}

export function renderPublicPicks(input: PublicPicksInput): string {
  const visible = publicOnly(input.surfaces);
  const body = `    <main class="tk-shell">
      <section class="pub-band">
        <p class="tk-eyebrow pub-band__eyebrow">Portico · 推荐</p>
        <h1 class="pub-band__title">维护者推荐</h1>
        <p class="pub-band__lede">由维护者挑选的公开登记。推荐只能指向已通过独立审批的记录；把未审批的条目放进推荐，它也不会出现在这里。</p>
        <div class="pub-band__rule"></div>
      </section>
      <div class="pub-well">
        <div class="pub-main">
          ${
    input.picks.length === 0
      ? emptyState("暂无推荐。", "推荐由维护者挑选；在「发现」里可以看到全部公开登记。")
      : `<section class="pub-group">
            <div class="pub-group__head">
              <h2 class="pub-group__title">推荐</h2>
              <span class="pub-group__note">按推荐顺序 · ${input.picks.length} 项</span>
            </div>
${input.picks.map(renderStory).join("\n")}
          </section>`
  }
        </div>
        ${renderRail(visible, undefined, [])}
      </div>
    </main>
${footer()}`;

  return renderPublicPage({
    ctx: input.ctx,
    title: "推荐",
    section: "picks",
    body,
    bodyAttrs: ' data-page="picks"',
  });
}

/* ── article ────────────────────────────────────────────────────────────── */

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
        <a href="/public">发现</a>
        <span class="int-crumb__sep">›</span>
        <span>${esc(surface.id)}</span>
      </nav>

      <header class="pub-article__head">
        <div class="pub-article__eyebrow">
          <span class="tk-kicker">${esc(channelKicker(surface))}</span>
          ${stateChip(surface.governanceState, { compact: true })}
        </div>
        <h1 class="pub-article__title">${esc(surface.name)}</h1>
        ${tagChips(surface.tags, { linked: true })}
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
            ${bodyParagraphs(surface.description)}
            ${mediaPlayer(surface.mediaUrl)}

            <h2><span class="pub-prose__index">01</span>如何访问</h2>
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

            <h2><span class="pub-prose__index">02</span>这条登记为何公开</h2>
            <p>这条登记由 ${
    esc(maintainerChain(surface))
  } 维护。公开是跨越组织信任边界的动作：维护者只能把记录提交为公开候选，通过与否由一个不能是提交者本人的人类审计者决定。</p>
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
    section: "discover",
    body,
    bodyAttrs: ` data-page="article" data-surface="${esc(surface.id)}"`,
  });
}

/**
 * The article body is the record's own description. Each line break starts a
 * new paragraph so a multi-paragraph piece stays readable; every paragraph is
 * escaped on its own, so a line break never opens markup.
 */
export function bodyParagraphs(description: string): string {
  return description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => `<p>${esc(line)}</p>`).join("\n            ");
}

/**
 * Native player for an approved record's `mediaUrl`. The CSP already scopes
 * `media-src` to http(s); anything the type sniff cannot place stays a link.
 */
function mediaPlayer(mediaUrl: string | undefined): string {
  if (!mediaUrl || !isHttpUrl(mediaUrl)) return "";
  const safe = esc(mediaUrl);
  const path = new URL(mediaUrl).pathname;
  if (/\.(mp4|webm|mov)$/i.test(path)) {
    return `<div class="pub-media"><video controls preload="metadata" src="${safe}"></video></div>`;
  }
  if (/\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i.test(path)) {
    return `<div class="pub-media"><audio controls preload="metadata" src="${safe}"></audio></div>`;
  }
  return `<div class="pub-media"><a class="tk-link" href="${safe}" rel="noopener noreferrer nofollow">播放媒体 ↗</a></div>`;
}

/* ── not found ──────────────────────────────────────────────────────────── */

/**
 * Every human-facing miss lands here, in the same shell as the pages around
 * it. The reader's identity survives the 404: a signed-in operator's typo must
 * not turn into an anonymous page offering 登录.
 */
export function renderPublicNotFound(ctx: PublicContext): string {
  const body = `    <main class="tk-shell">
      <section class="pub-band">
        <p class="tk-eyebrow pub-band__eyebrow">404</p>
        <h1 class="pub-band__title">没有这个入口，或你无权看见。</h1>
        <p class="pub-band__lede"><a class="tk-link" href="/public">回到发现</a>，查看全部公开登记。</p>
        <div class="pub-band__rule"></div>
      </section>
    </main>
${footer()}`;
  return renderPublicPage({
    ctx,
    title: "未找到",
    body,
    bodyAttrs: ' data-page="not-found"',
  });
}
