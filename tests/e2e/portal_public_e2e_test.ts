/**
 * E2E: the public plane at `/public` — 发现, 推荐, and the article pages.
 *
 * The guarantees are the ones the retired magazine shell used to pin: a
 * reader reads internal records on the workbench, anonymous reads only what
 * crossed the approval boundary, 发现's search is a scriptless GET form, and
 * every retired magazine address forwards here by path alone (a redirect
 * never confirms that an id exists).
 */
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

async function runOk(args: string[], env: Record<string, string>): Promise<void> {
  const result = await runCli(args, env);
  assertEquals(result.code, 0, result.raw || result.stderr);
}

function register(catalog: string, input: string, env: Record<string, string>) {
  return runOk([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ], env);
}

function publish(catalog: string, id: string, env: Record<string, string>) {
  return runOk([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--id",
    id,
    "--visibility",
    "public",
  ], env);
}

function approve(catalog: string, id: string, env: Record<string, string>) {
  return runOk([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    id,
  ], env);
}

Deno.test("E2E: reader reads internal records on the workbench; approve then 发现 shows them to anonymous", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-public-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await register(catalog, input, env);

  await withPortal(catalog, identities, async (base) => {
    // Internal records are read on the workbench.
    const workbench = await fetch(`${base}/internal?id=docs-writer`, { headers: readerHeaders() });
    assertEquals(workbench.status, 200);
    const workbenchHtml = await workbench.text();
    assert(workbenchHtml.includes("Docs Writer"), "reader workbench must show the record");
    assert(workbenchHtml.includes("jsr:@example/docs-writer"));
    assert(workbenchHtml.includes(">公开面</a>"), "the workbench links the public plane");

    // 发现 is approved-only, even for the reader who can see the record.
    const discover = await fetch(`${base}/public`, { headers: readerHeaders() });
    assertEquals(discover.status, 200);
    const discoverHtml = await discover.text();
    assert(!discoverHtml.includes("Docs Writer"), "发现 must not show an unapproved record");
    assert(!discoverHtml.includes("jsr:@example/docs-writer"));
    assert(discoverHtml.includes("公开发布尚无内容"), "the empty state must explain why");

    // Anonymous gets nothing anywhere on the plane, and `/` forwards first.
    const anonRoot = await fetch(`${base}/`, { redirect: "manual" });
    assertEquals(anonRoot.status, 302, "the retired magazine address must forward");
    assertEquals(anonRoot.headers.get("location"), "/public");
    const anonPage = await (await fetch(`${base}/public`)).text();
    assert(!anonPage.includes("Docs Writer"));
    const anonArticle = await fetch(`${base}/public/s/docs-writer`);
    assertEquals(anonArticle.status, 404);
    assert(!(await anonArticle.text()).includes("jsr:@example/docs-writer"));
  });

  await publish(catalog, "docs-writer", env);
  await approve(catalog, "docs-writer", env);

  await withPortal(catalog, identities, async (base) => {
    const discover = await fetch(`${base}/public`);
    assertEquals(discover.status, 200);
    const html = await discover.text();
    assert(html.includes("Docs Writer"), "发现 must show the approved surface");
    assert(html.includes('href="/public/s/docs-writer"'), "发现 links the approved record");
    assert(html.includes(">发现</a>"), "the nav offers 发现");
    assert(html.includes('href="/public/picks"'), "the nav offers 推荐");

    const article = await fetch(`${base}/public/s/docs-writer`);
    assertEquals(article.status, 200);
    const articleHtml = await article.text();
    assert(articleHtml.includes("Docs Writer"));
    assert(articleHtml.includes("jsr:@example/docs-writer"));
    assert(articleHtml.includes('href="/public"'), "the article keeps its breadcrumb back");
  });
});

Deno.test("E2E: 发现 search and tag filters are scriptless GETs over approved surfaces only", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-public-search-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const writerInput = `${dir}/writer.json`;
  const webInput = `${dir}/web.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(writerInput, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  // Tags are the only classification below 发现 / 推荐.
  await Deno.writeTextFile(
    webInput,
    `${JSON.stringify({ ...sampleWebRecord(), tags: ["情报"] }, null, 2)}\n`,
  );
  await register(catalog, writerInput, env);
  await register(catalog, webInput, env);
  await publish(catalog, "docs-web", env);
  await approve(catalog, "docs-web", env);

  await withPortal(catalog, identities, async (base) => {
    const index = await fetch(`${base}/public`);
    const indexHtml = await index.text();
    assert(indexHtml.includes("<form"), "search must submit without script");
    assert(indexHtml.includes('name="q"'));
    assert(indexHtml.includes("搜索公开登记"));
    // The retired nav is gone: no channel topics, no 栏目.
    assert(!indexHtml.includes("信息刺客</a>"));
    assert(!indexHtml.includes('href="/public/t/'));
    assertEquals((await fetch(`${base}/public/t/cli`)).status, 404, "channel topics are retired");

    const hit = await fetch(`${base}/public?q=Web`);
    assertEquals(hit.status, 200);
    const hitHtml = await hit.text();
    assert(hitHtml.includes("Docs Web"));
    assert(!hitHtml.includes("Docs Writer"), "q must not surface an unapproved record");
    assert(hitHtml.includes('value="Web"'));

    // A signed-in reader cannot use 发现 as a window onto internal records.
    const readerMiss = await fetch(`${base}/public?q=Writer`, { headers: readerHeaders() });
    assertEquals(readerMiss.status, 200);
    const readerHtml = await readerMiss.text();
    assert(!readerHtml.includes("Docs Writer"));
    assert(!readerHtml.includes("jsr:@example/docs-writer"));
    assert(readerHtml.includes("没有匹配的公开登记"), "the empty state must name the miss");

    const anonMiss = await fetch(`${base}/public?q=Writer`);
    assertEquals(anonMiss.status, 200);
    const anonHtml = await anonMiss.text();
    assert(!anonHtml.includes("Docs Writer"));
    assert(!anonHtml.includes("jsr:@example/docs-writer"));

    const tagged = await fetch(`${base}/public?tag=` + encodeURIComponent("情报"));
    assertEquals(tagged.status, 200);
    const taggedHtml = await tagged.text();
    assert(taggedHtml.includes("Docs Web"), "the tagged surface must be listed");
    assert(!taggedHtml.includes("Docs Writer"));
    // The rail links the tag so the filter is reachable by navigation alone.
    assert(indexHtml.includes(`href="/public?tag=${encodeURIComponent("情报")}"`));
  });
});

Deno.test("E2E: retired magazine addresses forward to the public plane as reads only", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-public-forward-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/record.json`;
  const webInput = `${dir}/web.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(webInput, `${JSON.stringify(sampleWebRecord(), null, 2)}\n`);
  await register(catalog, input, env);
  await register(catalog, webInput, env);

  const catalogBefore = await Deno.readTextFile(catalog);

  await withPortal(catalog, identities, async (base) => {
    const cases: Array<[string, string]> = [
      ["/", "/public"],
      ["/?q=Docs", "/public?q=Docs"],
      ["/?id=docs-writer", "/public/s/docs-writer"],
      ["/s/docs-writer", "/public/s/docs-writer"],
      ["/s/docs-writer?theme=dark", "/public/s/docs-writer?theme=dark"],
      // Retired filters have no successor; they are dropped, not invented.
      ["/?category=mira-radio&channel=cli&q=x", "/public?q=x"],
    ];
    for (const [from, to] of cases) {
      const response = await fetch(`${base}${from}`, {
        redirect: "manual",
        headers: readerHeaders(),
      });
      assertEquals(response.status, 302, `${from} must forward`);
      assertEquals(response.headers.get("location"), to, `${from} must forward to ${to}`);
    }

    // The forward never confirms an id: an unapproved id lands on a 404 that
    // leaks nothing, and the catalog is untouched by any of it.
    const miss = await fetch(`${base}/public/s/docs-writer`, { headers: readerHeaders() });
    assertEquals(miss.status, 404);
    assert(!(await miss.text()).includes("jsr:@example/docs-writer"));
  });

  assertEquals(
    await Deno.readTextFile(catalog),
    catalogBefore,
    "forwarding is a read; it must not rewrite the catalog",
  );
});

Deno.test("E2E: 发现 / 推荐 reach each other read-only; anonymous /internal still goes to login", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-public-cross-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/web.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleWebRecord(), null, 2)}\n`);
  await register(catalog, input, env);
  await publish(catalog, "docs-web", env);
  await approve(catalog, "docs-web", env);

  const catalogBefore = await Deno.readTextFile(catalog);

  await withPortal(catalog, identities, async (base) => {
    const anonDiscover = await fetch(`${base}/public`);
    assertEquals(anonDiscover.status, 200);
    const anonHtml = await anonDiscover.text();
    assert(!anonHtml.includes('href="/internal"'), "anonymous must not see /internal link");
    assert(anonHtml.includes("Docs Web"));

    const anonPicks = await fetch(`${base}/public/picks`);
    assertEquals(anonPicks.status, 200);
    const picksHtml = await anonPicks.text();
    assert(picksHtml.includes("暂无推荐"), "an empty 推荐 says so instead of inventing picks");

    const readerDiscover = await fetch(`${base}/public`, { headers: readerHeaders() });
    assertEquals(readerDiscover.status, 200);
    const readerHtml = await readerDiscover.text();
    assert(readerHtml.includes("登出"), "signed-in chrome must offer logout");
    assert(readerHtml.includes('href="/internal"'), "signed-in chrome returns to the workbench");

    const article = await fetch(`${base}/public/s/docs-web`);
    assertEquals(article.status, 200);
    const articleHtml = await article.text();
    assert(!articleHtml.includes('href="/internal"'));

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
