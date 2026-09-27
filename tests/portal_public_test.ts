/**
 * The public plane's shape: 发现 / 推荐 nav, scriptless search, tags as the
 * only classification, curated picks, and the retired magazine addresses
 * forwarding into this one plane.
 *
 * Governance boundaries (approved-only rendering, 404s for unapproved) live in
 * `portal_ui_test.ts`; theme tokens in `portal_theme_test.ts`. This file pins
 * what a reader of the publication can actually do and where the old links go.
 */
import { assert, assertEquals } from "./assert.ts";
import { type RosterFixture, signedInRoster } from "./fixtures.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { handlePortalRequest } from "../src/portal/mod.ts";
import { MemoryPageStore, PageService } from "../src/ui/mod.ts";

const maintainer: Actor = { id: "agent:docs-bot", kind: "agent", role: "maintainer" };
const reader: Actor = { id: "human:reader", kind: "human", role: "reader" };

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src https: http:";

function cliInput(): RegisterInput {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    tags: ["工具"],
  };
}

function webInput(): RegisterInput {
  return {
    id: "brief-news",
    name: "情报简报｜2026-09-26",
    description: "第一段简介，说明它是什么、谁在维护、怎么访问。\n第二段：更多细节。",
    channels: ["web"],
    version: "1.2.0",
    visibility: "internal",
    entry: { kind: "url", value: "https://docs.example.test/brief" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    tags: ["信息刺客", "工具"],
    mediaUrl: "https://cdn.example.test/brief.mp3",
  };
}

let roster: RosterFixture;

async function seededContext() {
  roster = await signedInRoster();
  const catalog = new CatalogService(new MemoryCatalogStore());
  const pages = new PageService(new MemoryPageStore(), catalog);
  return { catalog, access: roster.access, pages };
}

function actorHeaders(actor: Actor): HeadersInit {
  return roster.headersFor(actor.id);
}

/** Register, submit, and let the independent auditor approve. */
async function publishApproved(
  context: Awaited<ReturnType<typeof seededContext>>,
  input: RegisterInput,
) {
  await context.catalog.register(maintainer, input);
  await context.catalog.publish(maintainer, { id: input.id, visibility: "public" });
  await context.catalog.approve(roster.auditor, { id: input.id });
}

async function get(
  context: Awaited<ReturnType<typeof seededContext>>,
  path: string,
  who?: Actor,
): Promise<{ status: number; html: string }> {
  const response = await handlePortalRequest(
    new Request(`http://portico.local${path}`, who ? { headers: actorHeaders(who) } : {}),
    context,
  );
  return { status: response.status, html: await response.text() };
}

Deno.test("the public nav is exactly 发现 and 推荐, and every page keeps the closed CSP", async () => {
  const context = await seededContext();
  await publishApproved(context, webInput());

  for (const path of ["/public", "/public/picks", "/public/s/brief-news"]) {
    const response = await handlePortalRequest(
      new Request(`http://portico.local${path}`),
      context,
    );
    assertEquals(response.status, 200, path);
    assertEquals(response.headers.get("content-security-policy"), CSP, path);
    const html = await response.text();
    assert(html.includes('href="/public"') && html.includes(">发现</a>"), `${path} offers 发现`);
    assert(html.includes('href="/public/picks"'), `${path} offers 推荐`);
    // Nothing else survives in the header: no channel topics, no 栏目, no 报告.
    assert(!html.includes(">专题</a>"), `${path} has no 专题`);
    assert(!html.includes(">报告</a>"), `${path} has no 报告`);
    assert(!html.includes('href="/public/t/'), `${path} has no channel topics`);
    assert(!html.includes("category="), `${path} has no category nav`);
    assert(!/<script/i.test(html), `${path} must not contain a script element`);
  }
  // Approved records may carry audio/video; the header is where that permission lives.
  const media = await handlePortalRequest(
    new Request("http://portico.local/public/s/brief-news"),
    context,
  );
  assert(media.headers.get("content-security-policy")!.includes("media-src https: http:"));
});

Deno.test("发现 ships a real GET search form and filters with the shared catalog query", async () => {
  const context = await seededContext();
  await publishApproved(context, webInput());
  await context.catalog.register(maintainer, cliInput());

  const index = await get(context, "/public");
  assert(index.html.includes("<form"), "search submits without script");
  assert(index.html.includes('method="get"'));
  assert(index.html.includes('action="/public"'));
  assert(index.html.includes('name="q"'));
  assert(index.html.includes('placeholder="搜索公开登记"'));

  const hit = await get(context, "/public?q=brief");
  assert(hit.html.includes("情报简报"), "q matches the approved record");
  assert(hit.html.includes('value="brief"'), "the query survives in the field");
  assert(!hit.html.includes("Docs Writer"), "q never reaches an internal record");

  // The same filter for a signed-in reader: 发现 is not a peek window.
  const readerHit = await get(context, "/public?q=Docs", reader);
  assert(!readerHit.html.includes("Docs Writer"));
  assert(readerHit.html.includes("没有匹配的公开登记"));

  const tagHit = await get(context, "/public?tag=" + encodeURIComponent("信息刺客"));
  assert(tagHit.html.includes("情报简报"), "the tag filter lists the tagged record");
  assert(tagHit.html.includes('aria-current="page"'), "the active tag is marked in the rail");
  assert(tagHit.html.includes("清除筛选"), "a filtered page offers a way back");
});

Deno.test("推荐 renders curated picks in order and only on the public face", async () => {
  const context = await seededContext();
  await publishApproved(context, webInput());
  await context.catalog.register(maintainer, cliInput());
  await context.pages.set(maintainer, {
    components: [
      { kind: "catalog_card", id: "brief-news" },
      { kind: "catalog_card", id: "docs-writer" },
    ],
  });

  const picks = await get(context, "/public/picks");
  assert(picks.html.includes('data-page="picks"'));
  assert(picks.html.includes("情报简报"), "an approved card is a pick");
  assert(!picks.html.includes("Docs Writer"), "an internal card stays off 推荐 for every role");

  // The index rail links 推荐 with the first pick; empty pages say so instead.
  const empty = await get(context, "/public/picks", reader);
  assert(empty.html.includes("暂无推荐") === false, "picks exist in this scenario");
  const fresh = await seededContext();
  const noPicks = await get(fresh, "/public/picks");
  assert(noPicks.html.includes("暂无推荐"), "an empty 推荐 says so");
  assert(noPicks.html.includes("在「发现」里"), "the empty state names the next step");
});

Deno.test("the article body is the description as escaped paragraphs, tags included", async () => {
  const context = await seededContext();
  await publishApproved(context, webInput());

  const article = await get(context, "/public/s/brief-news");
  const html = article.html;
  assert(html.includes('data-page="article"'));
  assert(html.includes("<p>第一段简介"), "each line becomes its own paragraph");
  assert(html.includes("<p>第二段：更多细节。</p>"));
  assert(html.includes('<a class="tk-chip tk-chip--tag"'), "tags render as chips");
  assert(
    html.includes(`href="/public?tag=${encodeURIComponent("信息刺客")}"`),
    "a tag chip links into the 发现 filter",
  );
  assert(html.includes("<audio"), "the approved record's mediaUrl plays inline");
  assert(html.includes('src="https://cdn.example.test/brief.mp3"'));
});

Deno.test("retired magazine addresses forward to the public plane", async () => {
  const context = await seededContext();
  await publishApproved(context, webInput());
  await context.catalog.register(maintainer, cliInput());

  const cases: Array<[string, string | null]> = [
    ["/", "/public"],
    ["/?q=brief", "/public?q=brief"],
    ["/?tag=" + encodeURIComponent("工具"), "/public?tag=" + encodeURIComponent("工具")],
    ["/?theme=dark", "/public?theme=dark"],
    ["/?id=brief-news", "/public/s/brief-news"],
    ["/s/brief-news", "/public/s/brief-news"],
    ["/s/brief-news?theme=dark", "/public/s/brief-news?theme=dark"],
    // The magazine's filters had no successor; they are dropped, not reinvented.
    ["/?category=info-assassin&channel=cli", "/public"],
    // An unknown id forwards by path alone: the redirect cannot say it exists.
    ["/s/never-registered", "/public/s/never-registered"],
    // A non-forwarding address stays a JSON 404, not a human-facing page.
    ["/api/nope", null],
  ];
  for (const [from, to] of cases) {
    const response = await handlePortalRequest(
      new Request(`http://portico.local${from}`),
      context,
    );
    if (to === null) {
      assertEquals(response.status, 404, from);
      assertEquals(response.headers.get("content-type"), "application/json; charset=utf-8", from);
      continue;
    }
    assertEquals(response.status, 302, from);
    assertEquals(response.headers.get("location"), to, from);
  }
});

Deno.test("the 404 page is a public page that keeps the reader's identity", async () => {
  const context = await seededContext();
  await publishApproved(context, webInput());

  const anon = await get(context, "/public/s/does-not-exist");
  assertEquals(anon.status, 404);
  assert(anon.html.includes("没有这个入口"), "404 explains itself");
  assert(anon.html.includes('href="/login"'), "an anonymous reader is offered 登录");
  assert(anon.html.includes('data-page="not-found"'));

  const signedIn = await get(context, "/public/s/does-not-exist", reader);
  assertEquals(signedIn.status, 404);
  assert(signedIn.html.includes("human:reader"), "the identity survives the typo");
  assert(signedIn.html.includes("登出"));
  assert(!signedIn.html.includes('href="/login"'), "no 登录 link for a signed-in reader");
});

Deno.test("anonymous /internal redirects to login instead of advertising", async () => {
  const context = await seededContext();
  const response = await handlePortalRequest(
    new Request("http://portico.local/internal"),
    context,
  );
  assertEquals(response.status, 303);
  assert(response.headers.get("location")?.startsWith("/login"));
});
