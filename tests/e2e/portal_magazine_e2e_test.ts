import { assert, assertEquals } from "../assert.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import {
  actor,
  bootstrapRoster,
  runCli,
  sampleRecord,
  sampleWebRecord,
  sessionFor,
  sessionsPathFor,
} from "./harness.ts";

function readerHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${sessionFor("human:reader")!}`,
  };
}

async function withPortal(
  catalog: string,
  identities: string,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const server = listenPortal({
    catalogPath: catalog,
    identitiesPath: identities,
    sessionsPath: sessionsPathFor(identities),
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
  });
  try {
    await fn(portalUrl(server));
  } finally {
    controller.abort();
    await server.finished;
  }
}

Deno.test("E2E: reader sees registered surface in list and detail; approve then anonymous sees hero and list", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-magazine-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  await withPortal(catalog, identities, async (base) => {
    const list = await fetch(`${base}/`, { headers: readerHeaders() });
    assertEquals(list.status, 200);
    const listHtml = await list.text();
    assert(listHtml.includes("PORTICO"));
    assert(listHtml.includes("Docs Writer"), "reader list must show the registered surface");
    assert(listHtml.includes('data-id="docs-writer"'));
    assert(listHtml.includes("jsr:@example/docs-writer"));
    assert(!listHtml.includes("data-hero"), "internal surfaces must not be featured");

    const detail = await fetch(`${base}/s/docs-writer`, { headers: readerHeaders() });
    assertEquals(detail.status, 200);
    const detailHtml = await detail.text();
    assert(detailHtml.includes("Docs Writer"));
    assert(detailHtml.includes("Drafts internal documentation."));
    assert(detailHtml.includes("1.0.0"));
    assert(detailHtml.includes("jsr:@example/docs-writer"));

    const anonList = await (await fetch(`${base}/`)).text();
    assert(!anonList.includes("Docs Writer"));
    const anonDetail = await fetch(`${base}/s/docs-writer`);
    assertEquals(anonDetail.status, 404);
    const anonDetailHtml = await anonDetail.text();
    assert(!anonDetailHtml.includes("jsr:@example/docs-writer"));
  });

  assertEquals(
    (await runCli([
      "catalog",
      "publish",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--id",
      "docs-writer",
      "--visibility",
      "public",
    ], env)).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "approve",
      "--catalog",
      catalog,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-writer",
    ], env)).code,
    0,
  );

  await withPortal(catalog, identities, async (base) => {
    const anon = await fetch(`${base}/`);
    assertEquals(anon.status, 200);
    const html = await anon.text();
    assert(html.includes("Docs Writer"), "anonymous list must show the approved surface");
    assert(html.includes("data-hero"), "approved public surface is the featured hero");
    assert(html.includes('data-id="docs-writer"'));
    assert(html.includes("PORTICO"));
    assert(html.includes("全部"));
    assert(html.includes("CLI"));

    const detail = await fetch(`${base}/s/docs-writer`);
    assertEquals(detail.status, 200);
    const detailHtml = await detail.text();
    assert(detailHtml.includes("Docs Writer"));
    assert(detailHtml.includes("jsr:@example/docs-writer"));
  });
});

Deno.test("E2E: magazine search is a GET over authorized surfaces, not a CMS article index", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-magazine-search-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const writerInput = `${dir}/writer.json`;
  const webInput = `${dir}/web.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(writerInput, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(webInput, `${JSON.stringify(sampleWebRecord(), null, 2)}\n`);

  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      writerInput,
    ], env)).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      webInput,
    ], env)).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "publish",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--id",
      "docs-web",
      "--visibility",
      "public",
    ], env)).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "approve",
      "--catalog",
      catalog,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-web",
    ], env)).code,
    0,
  );

  await withPortal(catalog, identities, async (base) => {
    const home = await fetch(`${base}/`);
    const homeHtml = await home.text();
    assert(homeHtml.includes("<form"), "search must submit without script");
    assert(homeHtml.includes('name="q"'));
    assert(homeHtml.includes("搜索已授权入口"));
    assert(!homeHtml.includes("搜索文章、报告或主题"));

    const readerHit = await fetch(`${base}/?q=Writer`, { headers: readerHeaders() });
    assertEquals(readerHit.status, 200);
    const readerHtml = await readerHit.text();
    assert(readerHtml.includes("Docs Writer"));
    assert(!readerHtml.includes("Docs Web"), "q must not mix unrelated visible records");
    assert(readerHtml.includes('value="Writer"'));

    const anonMiss = await fetch(`${base}/?q=Writer`);
    assertEquals(anonMiss.status, 200);
    const anonHtml = await anonMiss.text();
    assert(!anonHtml.includes("Docs Writer"));
    assert(!anonHtml.includes("jsr:@example/docs-writer"));
  });
});

Deno.test("E2E: reading-page chrome keeps all-channels and search query", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-magazine-nav-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      input,
    ], env)).code,
    0,
  );

  await withPortal(catalog, identities, async (base) => {
    const unfiltered = await fetch(`${base}/s/docs-writer`, { headers: readerHeaders() });
    assertEquals(unfiltered.status, 200);
    const unfilteredHtml = await unfiltered.text();
    assert(unfilteredHtml.includes('<a class="active" href="/">全部</a>'));
    assert(unfilteredHtml.includes("信息刺客</a>"));
    assert(unfilteredHtml.includes("Mira Radio</a>"));

    const searched = await fetch(`${base}/s/docs-writer?q=Writer&channel=cli`, {
      headers: readerHeaders(),
    });
    assertEquals(searched.status, 200);
    const searchedHtml = await searched.text();
    assert(searchedHtml.includes('href="/?q=Writer">首页</a>'));
    assert(searchedHtml.includes('href="/?channel=cli&amp;q=Writer">CLI</a>'));
    assert(searchedHtml.includes('class="rail-link active" href="/?channel=cli&amp;q=Writer"'));
    assert(searchedHtml.includes('class="rail-link" href="/?q=Writer"'));
    assert(!searchedHtml.includes("专题分类"));
    assert(!searchedHtml.includes('class="topics"'));
    assert(!searchedHtml.includes(">CLI 工具<"));
    assert(!searchedHtml.includes(">Web 渠道<"));
    assert(!searchedHtml.includes(">MCP 服务<"));
  });
});

Deno.test("E2E: mismatched reading-page filters redirect instead of rendering zero entries plus a detail", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-magazine-canonical-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/record.json`;
  const webInput = `${dir}/web.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(webInput, `${JSON.stringify(sampleWebRecord(), null, 2)}\n`);
  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      input,
    ], env)).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      webInput,
    ], env)).code,
    0,
  );

  const catalogBefore = await Deno.readTextFile(catalog);

  await withPortal(catalog, identities, async (base) => {
    const mismatch = await fetch(`${base}/s/docs-writer?channel=mcp`, {
      headers: readerHeaders(),
      redirect: "manual",
    });
    assertEquals(mismatch.status, 302);
    const location = mismatch.headers.get("location");
    if (!location) throw new Error("mismatched channel must send Location");
    const redirected = new URL(location, base);
    assertEquals(`${redirected.pathname}${redirected.search}`, "/s/docs-writer?channel=cli");

    const canonical = await fetch(redirected, { headers: readerHeaders() });
    assertEquals(canonical.status, 200);
    const html = await canonical.text();
    assert(html.includes("Docs Writer"));
    assert(html.includes('class="detail"'));
    assert(html.includes("1 个入口"));
    assert(!html.includes("0 个入口"));

    const qMismatch = await fetch(`${base}/s/docs-writer?q=zzz`, {
      headers: readerHeaders(),
      redirect: "manual",
    });
    assertEquals(qMismatch.status, 302);
    const qLocation = qMismatch.headers.get("location");
    if (!qLocation) throw new Error("unmatched q must send Location");
    const qRedirected = new URL(qLocation, base);
    assertEquals(`${qRedirected.pathname}${qRedirected.search}`, "/s/docs-writer");

    const anon = await fetch(`${base}/s/docs-writer?channel=mcp`, { redirect: "manual" });
    assertEquals(anon.status, 404);
    assertEquals(anon.headers.get("location"), null);
    const anonHtml = await anon.text();
    assert(!anonHtml.includes("jsr:@example/docs-writer"));
  });

  assertEquals(
    await Deno.readTextFile(catalog),
    catalogBefore,
    "canonicalization is a read; it must not rewrite the catalog",
  );

  assertEquals(
    (await runCli([
      "catalog",
      "publish",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--id",
      "docs-web",
      "--visibility",
      "public",
    ], env)).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "approve",
      "--catalog",
      catalog,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-web",
    ], env)).code,
    0,
  );

  await withPortal(catalog, identities, async (base) => {
    const anon = await fetch(`${base}/s/docs-web?channel=mcp`, { redirect: "manual" });
    assertEquals(anon.status, 302);
    const location = anon.headers.get("location");
    if (!location) throw new Error("anonymous may canonicalize an approved public record");
    const redirected = new URL(location, base);
    assertEquals(`${redirected.pathname}${redirected.search}`, "/s/docs-web?channel=web");
  });
});

Deno.test("E2E: magazine and public surfaces reach each other; anonymous /internal redirects to login", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-magazine-cross-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/web.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleWebRecord(), null, 2)}\n`);
  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      input,
    ], env)).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "publish",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--id",
      "docs-web",
      "--visibility",
      "public",
    ], env)).code,
    0,
  );
  assertEquals(
    (await runCli([
      "catalog",
      "approve",
      "--catalog",
      catalog,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-web",
    ], env)).code,
    0,
  );

  const catalogBefore = await Deno.readTextFile(catalog);

  await withPortal(catalog, identities, async (base) => {
    const anonHome = await fetch(`${base}/`);
    assertEquals(anonHome.status, 200);
    const anonHomeHtml = await anonHome.text();
    assert(!anonHomeHtml.includes('href="/internal"'), "anonymous must not see /internal link");

    const readerHome = await fetch(`${base}/`, { headers: readerHeaders() });
    assertEquals(readerHome.status, 200);
    const readerHomeHtml = await readerHome.text();
    assert(
      readerHomeHtml.includes('href="/review"'),
      "signed-in magazine chrome must offer the review entrance",
    );

    const publicPage = await fetch(`${base}/public`);
    assertEquals(publicPage.status, 200);
    const publicHtml = await publicPage.text();
    assert(publicHtml.includes('href="/"'));
    assert(publicHtml.includes(">发现</a>"));
    assert(!publicHtml.includes('href="/internal"'));
    assert(publicHtml.includes("Docs Web"));

    const article = await fetch(`${base}/public/s/docs-web`);
    assertEquals(article.status, 200);
    const articleHtml = await article.text();
    assert(articleHtml.includes('href="/s/docs-web"'));

    const reading = await fetch(`${base}/s/docs-web?channel=web&q=Docs`);
    assertEquals(reading.status, 200);
    const readingHtml = await reading.text();
    assert(
      readingHtml.includes(
        '<a class="back-to-list" href="/?channel=web&amp;q=Docs">返回列表</a>',
      ),
    );

    const list = await fetch(`${base}/?channel=web&q=Docs`);
    assertEquals(list.status, 200);
    const listHtml = await list.text();
    assert(listHtml.includes("Docs Web"));
    assert(listHtml.includes('value="Docs"'));

    const anonInternal = await fetch(`${base}/internal`, { redirect: "manual" });
    assertEquals(anonInternal.status, 303, "anonymous /internal must redirect to login");
    assert(
      anonInternal.headers.get("location")?.startsWith("/login"),
      "anonymous /internal must redirect to /login",
    );
    const anonInternalHtml = await anonInternal.text();
    assert(!anonInternalHtml.includes("Docs Web"));
    assert(!anonInternalHtml.includes("https://docs.example.test"));
  });

  assertEquals(await Deno.readTextFile(catalog), catalogBefore);
});
