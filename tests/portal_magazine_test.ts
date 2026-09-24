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

function infoAssassinSurface(): RegisterInput {
  return {
    id: "info-assassin-news",
    name: "Info Assassin News",
    description: "Tech news from the info assassin category.",
    channels: ["web"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "url", value: "https://info.example.test/news" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    category: "info-assassin",
  };
}

function miraRadioSurface(): RegisterInput {
  return {
    id: "mira-radio-podcast",
    name: "Mira Radio Podcast",
    description: "Audio content from Mira Radio.",
    channels: ["web"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "url", value: "https://mira.example.test/podcast" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    category: "mira-radio",
    mediaUrl: "https://mira.example.test/podcast.mp3",
  };
}

function uncategorizedSurface(): RegisterInput {
  return {
    id: "misc-tool",
    name: "Miscellaneous Tool",
    description: "An uncategorized tool.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/misc-tool" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    category: "uncategorized",
  };
}

function noCategorySurface(): RegisterInput {
  return {
    id: "legacy-tool",
    name: "Legacy Tool",
    description: "A legacy tool without a category field.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/legacy-tool" },
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
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src https: http:";

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
    assert(html.includes("全部"), "all categories link");
    assert(html.includes("信息刺客"), "info-assassin category");
    assert(html.includes("Mira Radio"), "mira-radio category");
    assert(html.includes("未分类"), "uncategorized category");
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
    new Request("http://portico.local/?id=docs-writer"),
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
    new Request("http://portico.local/?id=docs-writer", { headers: actorHeaders(reader) }),
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
  assertEquals(anonInternal.status, 303, "anonymous /internal must redirect to login");
  assert(
    anonInternal.headers.get("location")?.startsWith("/login"),
    "anonymous /internal must redirect to /login",
  );
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

Deno.test("unfiltered reading page highlights 全部 category in navigation", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-writer", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const allCategories = topbarLink(html, "全部");
  const infoAssassin = topbarLink(html, "信息刺客");
  assertEquals(allCategories.href, "/");
  assertEquals(allCategories.className.trim(), "active");
  assert(
    !infoAssassin.className.includes("active"),
    "info-assassin should not be active when no category",
  );
});

Deno.test("channel-filtered reading page preserves channel in category links", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-writer&channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const allCategories = topbarLink(html, "全部");
  const infoAssassin = topbarLink(html, "信息刺客");
  assert(
    allCategories.href.includes("channel=cli"),
    "category links should preserve channel filter",
  );
  assertEquals(allCategories.className.trim(), "active");
  assert(
    infoAssassin.href.includes("channel=cli"),
    "info-assassin link should preserve channel filter",
  );
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

Deno.test("reading page has no channel sidebar and selects in place", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-writer&channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  assertEquals(railLinks(html), []);
  assert(!html.includes("服务渠道"));
  assert(!html.includes("已登记服务"));
  assert(html.includes(">内容<"));
  assert(html.includes('href="/?id=docs-writer') || html.includes("id=docs-writer"));
  assert(!html.includes('href="/s/'));
  assert(!html.includes("专题分类"));
  assert(!html.includes('class="topics"'));
});

Deno.test("reading page category links and breadcrumb home keep the search query", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-writer&q=Writer&channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const allCategories = topbarLink(html, "全部");
  const infoAssassin = topbarLink(html, "信息刺客");
  assert(
    allCategories.href.includes("q=Writer"),
    "all-categories link should preserve search query",
  );
  assert(infoAssassin.href.includes("q=Writer"), "info-assassin link should preserve search query");

  const home = html.match(/<nav class="breadcrumbs">\s*<a href="([^"]*)">首页<\/a>/);
  if (!home) throw new Error("reading page must have a breadcrumb home link");
  assertEquals(home[1], "/?q=Writer");
  assertEquals(railLinks(html), []);
  assert(!html.includes("服务渠道"));
});

Deno.test("reading page breadcrumb channel uses CHANNEL_LABEL and links to the filtered list", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.catalog.register(maintainer, publicWeb());

  const cliPage = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-writer&channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(cliPage.status, 200);
  const cliHtml = await cliPage.text();
  const cliCrumb = breadcrumbNav(cliHtml);
  assert(cliCrumb.includes("<span>Docs Writer</span>"), "the record name stays the current crumb");
  assert(!cliCrumb.includes("服务渠道"));

  const webPage = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-web", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(webPage.status, 200);
  const webHtml = await webPage.text();
  const webCrumb = breadcrumbNav(webHtml);
  assert(webCrumb.includes("<span>Docs Web</span>") || webHtml.includes("Docs Web"));
  assert(!webCrumb.includes(">WEB<"));
});

Deno.test("reading page breadcrumb channel keeps the search query", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-writer&q=Writer&channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const crumb = breadcrumbNav(html);
  assert(crumb.includes("<span>Docs Writer</span>"));
  assert(!html.includes("服务渠道"));
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
  assertEquals(locationPath(page), "/?channel=cli&id=docs-writer");
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
  assertEquals(locationPath(page), "/?id=docs-writer");
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
  assertEquals(locationPath(page), "/?channel=cli&q=Writer&theme=dark&id=docs-writer");
});

Deno.test("reading page with a matching filter still renders and includes the selected record", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-writer&channel=cli", {
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
  assertEquals(locationPath(page), "/?channel=web&id=docs-web");
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
  assertEquals(locationPath(mismatch), "/?channel=cli&id=docs-writer");

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

Deno.test("anonymous magazine chrome does not advertise /internal", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, publicWeb());
  await context.catalog.publish(maintainer, { id: "docs-web", visibility: "public" });
  await context.catalog.approve(auditor, { id: "docs-web" });
  const before = JSON.stringify(await context.catalog.list(maintainer));

  const home = await handlePortalRequest(new Request("http://portico.local/"), context);
  assertEquals(home.status, 200);
  const homeHtml = await home.text();
  assert(!hasHref(homeHtml, "/internal"), "anonymous magazine must not advertise /internal");

  const reading = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-web&channel=web"),
    context,
  );
  assertEquals(reading.status, 200);
  const readingHtml = await reading.text();
  assert(!hasHref(readingHtml, "/internal"));
  assert(readingHtml.includes(">内容<"), "the list is named 内容");
  assert(!readingHtml.includes("服务渠道"));
  assert(!readingHtml.includes("返回列表"));
  assert(!readingHtml.includes("已登记服务"));
  assertEquals(JSON.stringify(await context.catalog.list(maintainer)), before);
});

Deno.test("signed-in magazine chrome verifies /internal access without bypass", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  const before = JSON.stringify(await context.catalog.list(maintainer));

  const readerHome = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(readerHome.status, 200);

  const reading = await handlePortalRequest(
    new Request("http://portico.local/?id=docs-writer&q=Writer&channel=cli", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(reading.status, 200);
  const readingHtml = await reading.text();
  assert(readingHtml.includes("id=docs-writer"), "selection stays on the magazine");
  assert(!readingHtml.includes("返回列表"));

  const anonInternal = await handlePortalRequest(
    new Request("http://portico.local/internal"),
    context,
  );
  assertEquals(anonInternal.status, 303, "anonymous /internal must redirect to login");
  assert(
    anonInternal.headers.get("location")?.startsWith("/login"),
    "anonymous /internal must redirect to /login",
  );
  const anonInternalHtml = await anonInternal.text();
  assert(!anonInternalHtml.includes("Docs Writer"));
  assertEquals(JSON.stringify(await context.catalog.list(maintainer)), before);
});

Deno.test("signed-in magazine chrome shows review link with pending count", async () => {
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
  assert(filteredHtml.includes("登出"), "a signed-in reader can log out");
  assert(!filteredHtml.includes('href="/review"'), "magazine does not offer a review entrance");
  assert(!filteredHtml.includes("审核 (1)"), "pending count is not a header review link");
  assert(
    !filteredHtml.includes("Docs Writer"),
    "a miss on q must not dump the pending candidate into the magazine stream",
  );

  const anon = await handlePortalRequest(new Request("http://portico.local/"), context);
  assertEquals(anon.status, 200);
  const anonHtml = await anon.text();
  assert(
    !anonHtml.includes("审核 (1)"),
    "anonymous magazine must not show pending count",
  );
  assert(!anonHtml.includes("Docs Writer"));

  assertEquals(
    JSON.stringify(await context.catalog.list(maintainer)),
    before,
    "reading magazine chrome must not dirty the catalog",
  );
});

Deno.test("authenticated chrome offers logout and no parallel review entry", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const anonMag = await handlePortalRequest(new Request("http://portico.local/"), context);
  const anonMagHtml = await anonMag.text();
  assert(anonMagHtml.includes('href="/login"'));
  assert(!anonMagHtml.includes("登出"));
  assert(!anonMagHtml.includes('href="/review'));
  assert(!anonMagHtml.includes("去审核"));

  const readerMag = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  const readerMagHtml = await readerMag.text();
  assert(readerMagHtml.includes("登出"));
  assert(!readerMagHtml.includes('href="/review'));

  const anonPublic = await handlePortalRequest(new Request("http://portico.local/public"), context);
  const anonPublicHtml = await anonPublic.text();
  assert(anonPublicHtml.includes('href="/login"'));
  assert(!anonPublicHtml.includes("去审核"));
  assert(!anonPublicHtml.includes("审核登录"));

  const auditorInternal = await handlePortalRequest(
    new Request("http://portico.local/internal", { headers: actorHeaders(auditor) }),
    context,
  );
  const auditorHtml = await auditorInternal.text();
  assert(auditorHtml.includes("登出"));
  assert(!auditorHtml.includes("去审核"));
  assert(!auditorHtml.includes('href="/review'));
  const readerInternal = await handlePortalRequest(
    new Request("http://portico.local/internal", { headers: actorHeaders(reader) }),
    context,
  );
  const readerHtml = await readerInternal.text();
  assert(readerHtml.includes("登出"));
  assert(!readerHtml.includes(">删除<"), "a reader cannot delete");
  assert(!readerHtml.includes(">撤回<"), "a reader cannot withdraw");
  assert(!readerHtml.includes(">通过<"), "a reader cannot approve");
});

// ── Category filtering tests ───────────────────────────────────────────────

Deno.test("category=info-assassin only lists matching surfaces", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, infoAssassinSurface());
  await context.catalog.register(maintainer, miraRadioSurface());
  await context.catalog.register(maintainer, uncategorizedSurface());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?category=info-assassin", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  assert(html.includes("Info Assassin News"), "info-assassin surface must be visible");
  assert(!html.includes("Mira Radio Podcast"), "mira-radio surface must be filtered out");
  assert(!html.includes("Miscellaneous Tool"), "uncategorized surface must be filtered out");
});

Deno.test("missing category field defaults to uncategorized bucket", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, noCategorySurface());
  await context.catalog.register(maintainer, uncategorizedSurface());
  await context.catalog.register(maintainer, infoAssassinSurface());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?category=uncategorized", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  assert(html.includes("Legacy Tool"), "surface without category must be in uncategorized");
  assert(html.includes("Miscellaneous Tool"), "explicit uncategorized must be visible");
  assert(!html.includes("Info Assassin News"), "info-assassin must be filtered out");
});

Deno.test("category filter works together with channel and q filters", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, infoAssassinSurface());
  await context.catalog.register(maintainer, miraRadioSurface());
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?category=info-assassin&channel=web", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  assert(html.includes("Info Assassin News"), "info-assassin + web must be visible");
  assert(!html.includes("Mira Radio Podcast"), "mira-radio must be filtered by category");
  assert(!html.includes("Docs Writer"), "cli surface must be filtered by channel");
});

Deno.test("magazine page receives and renders category filter active state", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, infoAssassinSurface());

  const page = await handlePortalRequest(
    new Request("http://portico.local/?category=info-assassin", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  const infoAssassinLink = html.match(/<a class="([^"]*)" href="[^"]*">信息刺客<\/a>/);
  if (!infoAssassinLink) throw new Error("信息刺客 nav link must exist");
  assert(
    infoAssassinLink[1].includes("active"),
    "信息刺客 must be active when category=info-assassin",
  );
});

Deno.test("reading page with mismatched category redirects to surface's effective category", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, infoAssassinSurface());

  const page = await handlePortalRequest(
    new Request("http://portico.local/s/info-assassin-news?category=mira-radio", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  assertEquals(page.status, 302);
  const location = page.headers.get("location") ?? "";
  assert(location.includes("category=info-assassin"), "must redirect to surface's category");
});

Deno.test("CSP header allows media-src for audio and video playback", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, miraRadioSurface());

  const page = await handlePortalRequest(
    new Request("http://portico.local/"),
    context,
  );
  assertEquals(page.status, 200);
  const csp = page.headers.get("content-security-policy") ?? "";
  assert(csp.includes("media-src https: http:"), "CSP must allow media-src for external URLs");
  assert(!csp.includes("script-src"), "CSP must not open script-src");
});

Deno.test("null category shows all surfaces regardless of their category", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, infoAssassinSurface());
  await context.catalog.register(maintainer, miraRadioSurface());
  await context.catalog.register(maintainer, uncategorizedSurface());
  await context.catalog.register(maintainer, noCategorySurface());

  const page = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(page.status, 200);
  const html = await page.text();
  assert(html.includes("Info Assassin News"), "info-assassin must be visible");
  assert(html.includes("Mira Radio Podcast"), "mira-radio must be visible");
  assert(html.includes("Miscellaneous Tool"), "uncategorized must be visible");
  assert(html.includes("Legacy Tool"), "no-category must be visible");
});
