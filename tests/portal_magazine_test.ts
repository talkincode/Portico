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

const maintainer: Actor = {
  id: "agent:docs-bot",
  kind: "agent",
  role: "maintainer",
};

const reader: Actor = {
  id: "human:reader",
  kind: "human",
  role: "reader",
};

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

function internalCli(): RegisterInput {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function secretCli(): RegisterInput {
  return {
    id: "secret-cli",
    name: "Secret Internal CLI",
    description: "Must not leak to anonymous channel filters.",
    channels: ["cli"],
    version: "2.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@secret/internal-cli" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function publicWeb(): RegisterInput {
  return {
    id: "docs-web",
    name: "Docs Web",
    description: "External documentation portal.",
    channels: ["web"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "url", value: "https://docs.example.test/portals/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

let roster: RosterFixture;

async function seededContext() {
  roster = await signedInRoster();
  const access = roster.access;
  const catalog = new CatalogService(new MemoryCatalogStore());
  const pages = new PageService(new MemoryPageStore(), catalog);
  return { catalog, access, pages };
}

/** A real Bearer session: an identity is proven, never asserted. */
function actorHeaders(actor: Actor): HeadersInit {
  return roster.headersFor(actor.id);
}

const ACCENT = "#4A9EFF";
const DARK_BG = "#0B0D0F";
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

Deno.test("dark and light magazine shells share the cyan accent and keep CSP closed", async () => {
  const context = await seededContext();

  const dark = await handlePortalRequest(
    new Request("http://portico.local/?theme=dark"),
    context,
  );
  const light = await handlePortalRequest(
    new Request("http://portico.local/?theme=light"),
    context,
  );
  assertEquals(dark.status, 200);
  assertEquals(light.status, 200);
  assertEquals(dark.headers.get("content-security-policy"), CSP);
  assertEquals(light.headers.get("content-security-policy"), CSP);

  const darkHtml = await dark.text();
  const lightHtml = await light.text();
  const darkTag = darkHtml.match(/<html\b[^>]*>/)?.[0] ?? "";
  const lightTag = lightHtml.match(/<html\b[^>]*>/)?.[0] ?? "";
  assert(darkTag.includes('data-theme="dark"'), "dark query must set data-theme=dark");
  assert(lightTag.includes('data-theme="light"'), "light query must set data-theme=light");
  assert(darkHtml.includes(ACCENT), "dark theme must use the cyan-blue accent");
  assert(lightHtml.includes(ACCENT), "light theme must use the same cyan-blue accent");
  assert(darkHtml.includes(DARK_BG), "dark theme must use the near-black magazine ground");
  assert(darkHtml.includes("Songti SC"), "Chinese titles must use Songti SC");
  assert(darkHtml.includes("Noto Serif SC"));
  assert(darkHtml.includes("Source Han Serif"));
  assert(darkHtml.includes("Palatino"));
  assert(!darkHtml.includes("Inter"), "Inter is banned");
  assert(!lightHtml.includes("Roboto"), "Roboto is banned");
  assert(!darkHtml.includes("<script"), "theme switch must not require a script");
  assert(!lightHtml.includes("<script"), "theme switch must not require a script");
  for (const html of [darkHtml, lightHtml]) {
    assert(html.includes("PORTICO"), "masthead brand");
    assert(html.includes("内容"));
    assert(html.includes("专题"));
    assert(html.includes("收藏"));
    assert(html.includes("aria-disabled"), "收藏 is display-only");
  }
});

Deno.test("system theme follows prefers-color-scheme and does not persist a data-theme", async () => {
  const context = await seededContext();
  const page = await handlePortalRequest(new Request("http://portico.local/"), context);
  const html = await page.text();
  const openTag = html.match(/<html\b[^>]*>/)?.[0] ?? "";
  assert(!openTag.includes("data-theme"), "system default must not persist data-theme on <html>");
  assert(html.includes("prefers-color-scheme"));
  assert(html.includes(ACCENT));
});

Deno.test("channel filter does not leak anonymous-invisible records", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, secretCli());
  await context.catalog.register(maintainer, publicWeb());
  await context.catalog.publish(maintainer, { id: "docs-web", visibility: "public" });
  await context.catalog.approve(auditor, { id: "docs-web" });

  const anonCli = await handlePortalRequest(
    new Request("http://portico.local/?channel=cli"),
    context,
  );
  const anonCliHtml = await anonCli.text();
  assertEquals(anonCli.status, 200);
  assert(
    !anonCliHtml.includes("Secret Internal CLI"),
    "anonymous cli filter must not leak internal",
  );
  assert(!anonCliHtml.includes("jsr:@secret/internal-cli"));
  assert(!anonCliHtml.includes("Docs Web"), "cli filter must not show a web surface");

  const anonWeb = await handlePortalRequest(
    new Request("http://portico.local/?channel=web"),
    context,
  );
  const anonWebHtml = await anonWeb.text();
  assert(anonWebHtml.includes("Docs Web"), "anonymous may see approved public web");
  assert(!anonWebHtml.includes("Secret Internal CLI"));
  assert(!anonWebHtml.includes("jsr:@secret/internal-cli"));

  const readerCli = await handlePortalRequest(
    new Request("http://portico.local/?channel=cli", { headers: actorHeaders(reader) }),
    context,
  );
  const readerCliHtml = await readerCli.text();
  assert(readerCliHtml.includes("Secret Internal CLI"));
  assert(!readerCliHtml.includes("Docs Web"), "reader cli filter must not mix web records");
});

Deno.test("anonymous internal detail is 404 HTML and does not leak entries", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const anon = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer"),
    context,
  );
  assertEquals(anon.status, 404);
  assertEquals(anon.headers.get("content-type"), "text/html; charset=utf-8");
  const anonHtml = await anon.text();
  assert(!anonHtml.includes("Docs Writer"));
  assert(!anonHtml.includes("Drafts internal documentation."));
  assert(!anonHtml.includes("jsr:@example/docs-writer"));
  assert(!anonHtml.includes("agent:docs-bot"));

  const readerPage = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(readerPage.status, 200);
  const readerHtml = await readerPage.text();
  assert(readerHtml.includes("Docs Writer"));
  assert(readerHtml.includes("Drafts internal documentation."));
  assert(readerHtml.includes("1.0.0"));
  assert(readerHtml.includes("jsr:@example/docs-writer"));
  assert(!readerHtml.includes('href="jsr:@example/docs-writer"'));
});

Deno.test("anonymous does not see unapproved sidebar picks", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.pages.set(maintainer, {
    components: [{ kind: "catalog_card", id: "docs-writer" }],
  });

  const readerPage = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  const readerHtml = await readerPage.text();
  assert(readerHtml.includes("Docs Writer"));
  assert(readerHtml.includes('data-kind="catalog_card"'));

  const anonPage = await handlePortalRequest(new Request("http://portico.local/"), context);
  const anonHtml = await anonPage.text();
  assert(!anonHtml.includes("Docs Writer"));
  assert(!anonHtml.includes("docs-writer"));
});

Deno.test("magazine index keeps dual-surface /internal and /public routes", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const readerInternal = await handlePortalRequest(
    new Request("http://portico.local/internal", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(readerInternal.status, 200);
  assertEquals(readerInternal.headers.get("content-type"), "text/html; charset=utf-8");
  const readerInternalHtml = await readerInternal.text();
  assert(readerInternalHtml.includes("Docs Writer"));

  const anonInternal = await handlePortalRequest(
    new Request("http://portico.local/internal"),
    context,
  );
  assertEquals(anonInternal.status, 404);
  const anonInternalBody = await anonInternal.text();
  assert(!anonInternalBody.includes("Docs Writer"));

  const anonPublic = await handlePortalRequest(
    new Request("http://portico.local/public"),
    context,
  );
  assertEquals(anonPublic.status, 200);
  const anonPublicHtml = await anonPublic.text();
  assert(!anonPublicHtml.includes("Docs Writer"));
  assert(!anonPublicHtml.includes("jsr:@example/docs-writer"));
});

Deno.test("magazine search is a GET form over authorized surfaces, not a CMS article search", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.catalog.register(maintainer, publicWeb());
  await context.catalog.publish(maintainer, { id: "docs-web", visibility: "public" });
  await context.catalog.approve(auditor, { id: "docs-web" });

  const home = await handlePortalRequest(new Request("http://portico.local/"), context);
  const homeHtml = await home.text();
  assert(homeHtml.includes("<form"), "search must submit without script");
  assert(homeHtml.includes('name="q"'));
  assert(homeHtml.includes("搜索已授权入口"));
  assert(!homeHtml.includes("搜索文章、报告或主题"));
  assert(!homeHtml.includes('aria-hidden="true"'));

  const readerHit = await handlePortalRequest(
    new Request("http://portico.local/?q=Writer", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(readerHit.status, 200);
  const readerHtml = await readerHit.text();
  assert(readerHtml.includes("Docs Writer"));
  assert(!readerHtml.includes("Docs Web"), "q must not mix unrelated visible records");
  assert(readerHtml.includes('value="Writer"'), "the form must echo the query");

  const anonMiss = await handlePortalRequest(
    new Request("http://portico.local/?q=Writer"),
    context,
  );
  const anonHtml = await anonMiss.text();
  assertEquals(anonMiss.status, 200);
  assert(!anonHtml.includes("Docs Writer"));
  assert(!anonHtml.includes("jsr:@example/docs-writer"));
  assert(anonHtml.includes("没有可见的 Agent 表面。") || !anonHtml.includes("data-id="));
});

function topbarLink(html: string, label: string): { className: string; href: string } {
  const match = html.match(new RegExp(`<a class="([^"]*)" href="([^"]*)">${label}</a>`));
  if (!match) throw new Error(`missing topbar link ${label}`);
  return { className: match[1], href: match[2] };
}

Deno.test("unfiltered reading page does not default 专题 to web and highlights 内容", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const content = topbarLink(html, "内容");
  const topic = topbarLink(html, "专题");
  assertEquals(content.href, "/");
  assertEquals(content.className, "active");
  assertEquals(topic.href, "/");
  assertEquals(topic.className, "");
  assert(!topic.href.includes("channel=web"), "null channel is all, not a silent web filter");
});

Deno.test("channel-filtered reading page highlights 专题 without dropping the filter", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const content = topbarLink(html, "内容");
  const topic = topbarLink(html, "专题");
  assertEquals(content.href, "/");
  assertEquals(content.className, "");
  assertEquals(topic.href, "/?channel=cli");
  assertEquals(topic.className, "active");
});

function railLinks(html: string): Array<{ className: string; href: string; label: string }> {
  const matches = html.matchAll(
    /<a class="(rail-link[^"]*)" href="([^"]*)">[\s\S]*?<span>([^<]*)<\/span>/g,
  );
  return [...matches].map((match) => ({
    className: match[1],
    href: match[2],
    label: match[3],
  }));
}

function breadcrumbNav(html: string): string {
  const match = html.match(/<nav class="breadcrumbs">([\s\S]*?)<\/nav>/);
  if (!match) throw new Error("reading page must have breadcrumbs");
  return match[1];
}

Deno.test("reading page keeps one channel navigator that returns to the filtered list", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const rails = railLinks(html);
  assertEquals(rails.map((item) => item.label), ["全部服务", "Web", "CLI", "MCP"]);
  assertEquals(rails.map((item) => item.href), [
    "/",
    "/?channel=web",
    "/?channel=cli",
    "/?channel=mcp",
  ]);
  assert(
    rails.every((item) => !item.href.startsWith("/s/")),
    "the remaining channel navigator must leave the reading page",
  );
  const active = rails.find((item) => item.className.includes("active"));
  assertEquals(active?.label, "CLI");
  assert(!html.includes("专题分类"), "reading page must not repeat a second channel navigator");
  assert(!html.includes('class="topics"'), "topic tabs must not remain as a second channel set");
  assert(!html.includes(">CLI 工具<"), "channel labels must not keep the suffixed rail copy");
  assert(!html.includes(">Web 渠道<"));
  assert(!html.includes(">MCP 服务<"));
});

Deno.test("reading page channel tabs and breadcrumb home keep the search query", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?q=Writer&channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const content = topbarLink(html, "内容");
  const topic = topbarLink(html, "专题");
  assertEquals(content.href, "/?q=Writer");
  assertEquals(topic.href, "/?channel=cli&amp;q=Writer");

  const home = html.match(/<nav class="breadcrumbs">\s*<a href="([^"]*)">首页<\/a>/);
  if (!home) throw new Error("reading page must have a breadcrumb home link");
  assertEquals(home[1], "/?q=Writer");

  const rails = railLinks(html);
  assertEquals(rails.map((item) => [item.label, item.href]), [
    ["全部服务", "/?q=Writer"],
    ["Web", "/?channel=web&amp;q=Writer"],
    ["CLI", "/?channel=cli&amp;q=Writer"],
    ["MCP", "/?channel=mcp&amp;q=Writer"],
  ]);
  assert(!html.includes("专题分类"), "keeping q must not revive the second channel navigator");
  assert(!html.includes('class="topics"'));
});

Deno.test("reading page breadcrumb channel uses CHANNEL_LABEL and links to the filtered list", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.catalog.register(maintainer, publicWeb());

  const cliPage = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(cliPage.status, 200);
  const cliHtml = await cliPage.text();
  const cliCrumb = breadcrumbNav(cliHtml);
  assert(
    cliCrumb.includes('<a href="/?channel=cli">CLI</a>'),
    "breadcrumb channel must be a filter link, not a span",
  );
  assert(!cliCrumb.includes("<span>CLI</span>"), "breadcrumb channel must not stay plain text");
  assert(cliCrumb.includes("<span>Docs Writer</span>"), "the record name stays the current crumb");

  const webPage = await handlePortalRequest(
    new Request("http://portico.local/s/docs-web", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(webPage.status, 200);
  const webHtml = await webPage.text();
  const webCrumb = breadcrumbNav(webHtml);
  assert(
    webCrumb.includes('<a href="/?channel=web">Web</a>'),
    "unfiltered reading page still links the record's own channel; label is Web not WEB",
  );
  assert(!webCrumb.includes(">WEB<"), "channelLabel must use CHANNEL_LABEL, not toUpperCase");
});

Deno.test("reading page breadcrumb channel keeps the search query", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?q=Writer&channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const crumb = breadcrumbNav(html);
  assert(
    crumb.includes('<a href="/?channel=cli&amp;q=Writer">CLI</a>'),
    "breadcrumb channel must keep q when linking back to the list",
  );
  const home = html.match(/<nav class="breadcrumbs">\s*<a href="([^"]*)">首页<\/a>/);
  if (!home) throw new Error("reading page must have a breadcrumb home link");
  assertEquals(home[1], "/?q=Writer");
});

function locationPath(response: Response): string {
  const location = response.headers.get("location");
  if (!location) throw new Error("missing Location");
  const url = new URL(location, "http://portico.local");
  return `${url.pathname}${url.search}`;
}

Deno.test("reading page with a mismatched channel redirects to the record's own channel", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  const before = JSON.stringify(await context.catalog.list(maintainer));

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?channel=mcp", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 302);
  assertEquals(locationPath(page), "/s/docs-writer?channel=cli");
  assertEquals(JSON.stringify(await context.catalog.list(maintainer)), before);
});

Deno.test("reading page drops a q that does not match the selected record", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?q=zzz", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 302);
  assertEquals(locationPath(page), "/s/docs-writer");
});

Deno.test("reading page keeps a matching q when rewriting a mismatched channel", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?channel=mcp&q=Writer&theme=dark", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 302);
  assertEquals(locationPath(page), "/s/docs-writer?channel=cli&q=Writer&theme=dark");
});

Deno.test("reading page with a matching filter still renders and includes the selected record", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  assertEquals(page.headers.get("location"), null);
  const html = await page.text();
  assert(html.includes('class="detail"'));
  assert(html.includes("1 个入口"));
  assert(!html.includes("0 个入口"));
});

Deno.test("anonymous mismatched-channel reading of an internal record is still 404", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?channel=mcp"),
    context,
  );
  assertEquals(page.status, 404);
  assertEquals(page.headers.get("location"), null);
  const html = await page.text();
  assert(!html.includes("Docs Writer"));
  assert(!html.includes("jsr:@example/docs-writer"));
  assert(!html.includes("/s/docs-writer?channel=cli"));
});

Deno.test("anonymous mismatched-channel reading of an approved public record redirects", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, publicWeb());
  await context.catalog.publish(maintainer, { id: "docs-web", visibility: "public" });
  await context.catalog.approve(auditor, { id: "docs-web" });

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/docs-web?channel=mcp"),
    context,
  );
  assertEquals(page.status, 302);
  assertEquals(locationPath(page), "/s/docs-web?channel=web");
});

Deno.test("following a canonicalized reading URL never shows zero entries with a detail pane", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const mismatch = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?channel=mcp&q=zzz", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(mismatch.status, 302);
  assertEquals(locationPath(mismatch), "/s/docs-writer?channel=cli");

  const canonical = await handlePortalRequest(
    new Request(new URL(mismatch.headers.get("location")!, "http://portico.local"), {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(canonical.status, 200);
  const html = await canonical.text();
  assert(html.includes('class="detail"'));
  assert(html.includes("Docs Writer"));
  assert(html.includes("1 个入口"));
  assert(!html.includes("0 个入口"));
});

function hasHref(html: string, href: string): boolean {
  return html.includes(`href="${href}"`);
}

Deno.test("anonymous magazine chrome links to /public but not /internal", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, publicWeb());
  await context.catalog.publish(maintainer, { id: "docs-web", visibility: "public" });
  await context.catalog.approve(auditor, { id: "docs-web" });
  const before = JSON.stringify(await context.catalog.list(maintainer));

  const home = await handlePortalRequest(new Request("http://portico.local/"), context);
  assertEquals(home.status, 200);
  const homeHtml = await home.text();
  assert(hasHref(homeHtml, "/public"), "magazine index must reach the public surface");
  assert(homeHtml.includes(">公开发布</a>"));
  assert(!hasHref(homeHtml, "/internal"), "anonymous magazine must not advertise /internal");
  assert(!homeHtml.includes(">内部笔记</a>"));

  const reading = await handlePortalRequest(
    new Request("http://portico.local/s/docs-web?channel=web"),
    context,
  );
  assertEquals(reading.status, 200);
  const readingHtml = await reading.text();
  assert(hasHref(readingHtml, "/public"));
  assert(!hasHref(readingHtml, "/internal"));
  assert(
    readingHtml.includes('<a class="back-to-list" href="/?channel=web">返回列表</a>'),
    "reading page must return to the filtered list",
  );
  assertEquals(JSON.stringify(await context.catalog.list(maintainer)), before);
});

Deno.test("signed-in magazine chrome links to /internal without bypassing anonymous 404", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  const before = JSON.stringify(await context.catalog.list(maintainer));

  const readerHome = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(readerHome.status, 200);
  const readerHtml = await readerHome.text();
  assert(hasHref(readerHtml, "/public"));
  assert(hasHref(readerHtml, "/internal"), "a signed-in reader may reach the internal workbench");
  assert(readerHtml.includes(">内部笔记</a>"));

  const reading = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer?q=Writer&channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(reading.status, 200);
  const readingHtml = await reading.text();
  assert(hasHref(readingHtml, "/internal"));
  assert(
    readingHtml.includes(
      '<a class="back-to-list" href="/?channel=cli&amp;q=Writer">返回列表</a>',
    ),
    "return-to-list must keep channel and q",
  );

  const anonInternal = await handlePortalRequest(
    new Request("http://portico.local/internal"),
    context,
  );
  assertEquals(anonInternal.status, 404);
  const anonInternalHtml = await anonInternal.text();
  assert(!anonInternalHtml.includes("Docs Writer"));
  assertEquals(JSON.stringify(await context.catalog.list(maintainer)), before);
});

Deno.test("signed-in magazine chrome links the unfiltered pending_public count to the queue", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.catalog.publish(maintainer, { id: "docs-writer", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  const before = JSON.stringify(await context.catalog.list(maintainer));

  const filtered = await handlePortalRequest(
    new Request("http://portico.local/?q=zzzz-no-match", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(filtered.status, 200);
  const filteredHtml = await filtered.text();
  assert(
    hasHref(filteredHtml, "/internal/pending"),
    "a signed-in reader must reach the pending queue from magazine chrome",
  );
  assert(
    filteredHtml.includes(">待审 1</a>"),
    "the chrome count is the actor's pending_public total, not the filtered stream",
  );
  assert(
    !filteredHtml.includes("Docs Writer"),
    "a miss on q must not dump the pending candidate into the magazine stream",
  );

  const anon = await handlePortalRequest(new Request("http://portico.local/"), context);
  assertEquals(anon.status, 200);
  const anonHtml = await anon.text();
  assert(
    !hasHref(anonHtml, "/internal/pending"),
    "anonymous magazine must not advertise the queue",
  );
  assert(!anonHtml.includes(">待审 1</a>"));
  assert(!anonHtml.includes("Docs Writer"));

  assertEquals(
    JSON.stringify(await context.catalog.list(maintainer)),
    before,
    "reading magazine chrome must not dirty the catalog",
  );
});

Deno.test("one-click review entry: anonymous shells link login, signed-in shells link review", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const anonMag = await handlePortalRequest(new Request("http://portico.local/"), context);
  const anonMagHtml = await anonMag.text();
  assert(anonMagHtml.includes('href="/review/login"'));
  assert(!anonMagHtml.includes('href="/review"'));

  const readerMag = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  const readerMagHtml = await readerMag.text();
  assert(readerMagHtml.includes('href="/review"'));
  assert(!readerMagHtml.includes('href="/review/login"'));

  const anonPublic = await handlePortalRequest(new Request("http://portico.local/public"), context);
  const anonPublicHtml = await anonPublic.text();
  assert(anonPublicHtml.includes('href="/review/login"'));

  const auditorInternal = await handlePortalRequest(
    new Request("http://portico.local/internal", { headers: actorHeaders(auditor) }),
    context,
  );
  assert((await auditorInternal.text()).includes('href="/review"'));
  const readerInternal = await handlePortalRequest(
    new Request("http://portico.local/internal", { headers: actorHeaders(reader) }),
    context,
  );
  assert(!(await readerInternal.text()).includes('href="/review"'));
});
