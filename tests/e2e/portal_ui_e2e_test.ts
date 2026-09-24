/**
 * Dual-surface Portal E2E: the internal console and the public editorial page
 * over a real HTTP listener. Unit tests already pin the rendered trust
 * boundary; this file is the missing Happy Path (and the HTML-404 failure
 * path) the acceptance matrix requires for a first-class feature.
 */

import { assert, assertEquals } from "../assert.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import {
  actor,
  bootstrapRoster,
  runCli,
  sampleMcpRecord,
  sampleRecord,
  sampleWebRecord,
  sessionFor,
  sessionsPathFor,
} from "./harness.ts";

function headersFor(id: string): HeadersInit {
  return { authorization: `Bearer ${sessionFor(id)!}` };
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

async function fetchPage(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; type: string; body: string }> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

function bodyTheme(html: string): string | undefined {
  return html.match(/<body\b[^>]*\bdata-theme="([^"]+)"/)?.[1];
}

function assertHtml404(page: { status: number; type: string; body: string }, label: string) {
  assertEquals(page.status, 404, `${label} must be 404`);
  assertEquals(page.type, "text/html; charset=utf-8", `${label} must be HTML, not JSON`);
  assert(page.body.includes("<!DOCTYPE html>"), `${label} must render HTML`);
  assert(!page.body.trimStart().startsWith("{"), `${label} must not leak a JSON envelope`);
  assert(!page.body.includes("FORBIDDEN"), `${label} must not confirm a privileged route`);
}

async function assertLoginRedirect(
  url: string,
  label: string,
  assertNoLeak: (body: string) => void,
): Promise<void> {
  const response = await fetch(url, { redirect: "manual" });
  assertEquals(response.status, 303, `${label} must redirect to login`);
  const location = response.headers.get("location");
  assert(location?.startsWith("/login"), `${label} must redirect to /login`);
  assert(location?.includes("next="), `${label} redirect must carry a next param`);
  const body = await response.text();
  assert(!body.trimStart().startsWith("{"), `${label} must not leak a JSON envelope`);
  assert(!body.includes("FORBIDDEN"), `${label} must not confirm a privileged route`);
  assertNoLeak(body);
}

Deno.test("E2E: maintainer console shows drafts; public plane only shows approved_public; theme query applies", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-ui-e2e-" });
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
    const consolePage = await fetchPage(`${base}/internal`, {
      headers: headersFor("agent:docs-bot"),
    });
    assertEquals(consolePage.status, 200);
    assert(consolePage.body.includes("Docs Writer"), "console must show the draft");
    assert(consolePage.body.includes("内部笔记台") || consolePage.body.includes("全部内容"));
    assert(!/<script/i.test(consolePage.body), "console must not ship script");

    const dark = await fetchPage(`${base}/internal?theme=portico-internal-dark`, {
      headers: headersFor("agent:docs-bot"),
    });
    assertEquals(dark.status, 200);
    assert(
      bodyTheme(dark.body) === "portico-internal-dark",
      "explicit internal dark theme must paint",
    );

    const publicAsMaintainer = await fetchPage(`${base}/public`, {
      headers: headersFor("agent:docs-bot"),
    });
    assertEquals(publicAsMaintainer.status, 200);
    assert(
      !publicAsMaintainer.body.includes("Docs Writer"),
      "a draft must not reach the public plane, even for its maintainer",
    );

    await assertLoginRedirect(`${base}/internal`, "anonymous /internal", (body) => {
      assert(!body.includes("Docs Writer"));
      assert(!body.includes("内部笔记台"));
    });
  });

  const published = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--id",
    "docs-writer",
    "--visibility",
    "internal",
  ], env);
  assertEquals(published.code, 0, published.raw || published.stderr);
  const submitted = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--id",
    "docs-writer",
    "--visibility",
    "public",
  ], env);
  assertEquals(submitted.code, 0, submitted.raw || submitted.stderr);
  const approved = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
  ], env);
  assertEquals(approved.code, 0, approved.raw || approved.stderr);

  await withPortal(catalog, identities, async (base) => {
    const publicAnon = await fetchPage(`${base}/public`);
    assertEquals(publicAnon.status, 200);
    assert(
      publicAnon.body.includes("Docs Writer"),
      "anonymous public plane must show approved_public",
    );
    assert(
      publicAnon.body.includes('data-tone="public"') ||
        publicAnon.body.includes("portico-editorial-light") ||
        publicAnon.body.includes("公开发布"),
      "public plane must render the editorial shell",
    );

    const editorialDark = await fetchPage(`${base}/public?theme=portico-editorial-dark`);
    assertEquals(editorialDark.status, 200);
    assertEquals(
      bodyTheme(editorialDark.body),
      "portico-editorial-dark",
      "explicit editorial dark theme must paint",
    );

    const crossed = await fetchPage(`${base}/public?theme=portico-internal-dark`);
    assertEquals(crossed.status, 200);
    assertEquals(
      bodyTheme(crossed.body),
      "portico-editorial-light",
      "a cross-tone theme must silently fall back to the public default",
    );
  });
});

Deno.test("E2E: page 404s are HTML; reader vs auditor vs anonymous disagree; withdraw removes the public article", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-ui-e2e-fail-" });
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
      "internal",
    ], env)).code,
    0,
  );

  const catalogBefore = await Deno.readFile(catalog);

  await withPortal(catalog, identities, async (base) => {
    const unpublished = await fetchPage(`${base}/public/s/docs-writer`);
    assertHtml404(unpublished, "unpublished public article");
    assert(!unpublished.body.includes("Docs Writer"));

    const readerConsole = await fetchPage(`${base}/internal`, {
      headers: headersFor("human:reader"),
    });
    assertEquals(readerConsole.status, 200);
    assert(readerConsole.body.includes("Docs Writer"));

    const readerAudit = await fetchPage(`${base}/internal/audit`, {
      headers: headersFor("human:reader"),
    });
    assertHtml404(readerAudit, "reader /internal/audit");
    assert(!readerAudit.body.includes("审计时间线"));

    const auditorAudit = await fetchPage(`${base}/internal/audit`, {
      headers: headersFor("human:security-auditor"),
    });
    assertEquals(auditorAudit.status, 200);
    assert(auditorAudit.body.includes("审计时间线"));

    await assertLoginRedirect(`${base}/internal/audit`, "anonymous /internal/audit", (body) => {
      assert(!body.includes("审计时间线"));
    });
  });

  const catalogAfterDenied = await Deno.readFile(catalog);
  assertEquals(
    catalogAfterDenied,
    catalogBefore,
    "failed public reads must not dirty the catalog",
  );

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
    const before = await fetchPage(`${base}/public/s/docs-writer`);
    assertEquals(before.status, 200);
    assert(before.body.includes("Docs Writer"));
  });

  assertEquals(
    (await runCli([
      "catalog",
      "withdraw",
      "--catalog",
      catalog,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-writer",
    ], env)).code,
    0,
  );

  await withPortal(catalog, identities, async (base) => {
    const index = await fetchPage(`${base}/public`);
    assertEquals(index.status, 200);
    assert(!index.body.includes("Docs Writer"), "withdrawn surface must leave the public index");
    const article = await fetchPage(`${base}/public/s/docs-writer`);
    assertHtml404(article, "withdrawn public article");
    assert(!article.body.includes("Docs Writer"));
  });
});

Deno.test("E2E: /internal/approvals shows the same notes to a reader; anonymous 404s; catalog is unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-ui-approvals-e2e-" });
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
      "internal",
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
      "--note",
      "Package coordinate reviewed.",
    ], env)).code,
    0,
  );

  const catalogBefore = await Deno.readFile(catalog);

  await withPortal(catalog, identities, async (base) => {
    const asReader = await fetchPage(`${base}/internal/approvals`, {
      headers: headersFor("human:reader"),
    });
    assertEquals(asReader.status, 200);
    assert(asReader.body.includes("审批记录"), "reader must get the approvals screen");
    assert(asReader.body.includes("Docs Writer"), "reader must see the approved name");
    assert(
      asReader.body.includes("Package coordinate reviewed."),
      "reader must see the auditor note",
    );
    assert(!/<script/i.test(asReader.body), "approvals page must not ship script");

    const asAuditor = await fetchPage(`${base}/internal/approvals`, {
      headers: headersFor("human:security-auditor"),
    });
    assertEquals(asAuditor.status, 200);
    assert(asAuditor.body.includes("Package coordinate reviewed."));

    await assertLoginRedirect(
      `${base}/internal/approvals`,
      "anonymous /internal/approvals",
      (body) => {
        assert(!body.includes("Docs Writer"));
        assert(!body.includes("Package coordinate reviewed."));
        assert(!body.includes("审批记录"));
      },
    );
  });

  const catalogAfter = await Deno.readFile(catalog);
  assertEquals(
    catalogAfter,
    catalogBefore,
    "reading the approvals page must not dirty the catalog",
  );
});

Deno.test("E2E: /internal/pending lists pending_public for signed-in roles; anonymous 404s; catalog is unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-ui-pending-e2e-" });
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
      "internal",
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
      "docs-writer",
      "--visibility",
      "public",
    ], env)).code,
    0,
  );

  const catalogBefore = await Deno.readFile(catalog);

  await withPortal(catalog, identities, async (base) => {
    const asReader = await fetchPage(`${base}/internal/pending`, {
      headers: headersFor("human:reader"),
    });
    assertEquals(asReader.status, 200);
    assert(asReader.body.includes("待审队列"), "reader must get the pending queue");
    assert(asReader.body.includes("Docs Writer"), "reader must see the pending candidate");
    assert(
      asReader.body.includes("jsr:@example/docs-writer"),
      "queue must show the pending entry as text",
    );
    assert(asReader.body.includes("<th>种类</th>"), "queue must name the entry-kind column");
    assert(
      asReader.body.includes('data-entry-kind="package"'),
      "queue must label a package pending entry as package",
    );
    assert(
      !asReader.body.includes('href="jsr:@example/docs-writer"'),
      "a pending entry must not be a clickable target",
    );
    assert(asReader.body.includes("/internal/approvals"), "queue must link to decisions");

    const catalogBoard = await fetchPage(`${base}/internal/c`, {
      headers: headersFor("human:reader"),
    });
    assertEquals(catalogBoard.status, 200);
    assert(
      catalogBoard.body.includes('<a class="tk-stat" href="/internal?state=pending_public">'),
      "catalog board pending count opens the content workbench",
    );
    assert(!/<script/i.test(asReader.body), "pending page must not ship script");
    assert(!asReader.body.includes('action="/review/'), "pending page must not decide");

    const asAuditor = await fetchPage(`${base}/internal/pending`, {
      headers: headersFor("human:security-auditor"),
    });
    assertEquals(asAuditor.status, 200);
    assert(asAuditor.body.includes("Docs Writer"), "auditor must see the same candidate");
    assert(
      asAuditor.body.includes("jsr:@example/docs-writer"),
      "auditor must see where the pending entry points",
    );
    assert(!asAuditor.body.includes('action="/review/'), "auditor must not approve from the queue");
    assert(asAuditor.body.includes("登出"), "auditor chrome offers logout");

    await assertLoginRedirect(`${base}/internal/pending`, "anonymous /internal/pending", (body) => {
      assert(!body.includes("Docs Writer"));
      assert(!body.includes("待审队列"));
      assert(!body.includes("jsr:@example/docs-writer"));
    });
  });

  const catalogAfter = await Deno.readFile(catalog);
  assertEquals(
    catalogAfter,
    catalogBefore,
    "reading the pending queue must not dirty the catalog",
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
    const afterApprove = await fetchPage(`${base}/internal/pending`, {
      headers: headersFor("human:reader"),
    });
    assertEquals(afterApprove.status, 200);
    assert(
      !afterApprove.body.includes("Docs Writer"),
      "an approved surface must leave the pending queue",
    );
  });
});

async function submitPublicCandidate(
  catalog: string,
  input: string,
  env: Record<string, string>,
  record: ReturnType<typeof sampleRecord>,
): Promise<void> {
  await Deno.writeTextFile(input, `${JSON.stringify(record, null, 2)}\n`);
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
      record.id,
      "--visibility",
      "internal",
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
      record.id,
      "--visibility",
      "public",
    ], env)).code,
    0,
  );
}

Deno.test("E2E: /internal/pending?channel= filters pending_public; anonymous 404s; catalog is unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-ui-pending-channel-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);

  await submitPublicCandidate(catalog, input, env, sampleRecord());
  await submitPublicCandidate(catalog, input, env, sampleWebRecord());
  await submitPublicCandidate(catalog, input, env, sampleMcpRecord());

  const catalogBefore = await Deno.readFile(catalog);

  await withPortal(catalog, identities, async (base) => {
    const asReader = await fetchPage(`${base}/internal/pending`, {
      headers: headersFor("human:reader"),
    });
    assertEquals(asReader.status, 200);
    assert(asReader.body.includes("Docs Writer"), "unfiltered queue must list the cli candidate");
    assert(asReader.body.includes("Docs Web"), "unfiltered queue must list the web candidate");
    assert(asReader.body.includes("Docs MCP"), "unfiltered queue must list the mcp candidate");
    assert(
      asReader.body.includes('href="/internal/pending?channel=cli"'),
      "queue must offer a cli channel filter",
    );
    assert(
      asReader.body.includes(
        'href="/internal/pending" aria-current="true">全部<span class="tk-tab__count">3</span>',
      ),
      "all-tab must count three pending candidates",
    );
    assert(
      asReader.body.includes(
        'href="/internal/pending?channel=cli">CLI<span class="tk-tab__count">1</span>',
      ),
      "cli tab must count one pending candidate",
    );
    assert(
      asReader.body.includes(
        'href="/internal/pending?channel=web">Web<span class="tk-tab__count">1</span>',
      ),
      "web tab must count one pending candidate",
    );
    assert(
      asReader.body.includes(
        'href="/internal/pending?channel=mcp">MCP<span class="tk-tab__count">1</span>',
      ),
      "mcp tab must count one pending candidate",
    );
    assert(!asReader.body.includes('action="/review/'), "channel filter must not decide");
    assert(!/<script/i.test(asReader.body), "channel filter must not ship script");

    const asCli = await fetchPage(`${base}/internal/pending?channel=cli`, {
      headers: headersFor("human:reader"),
    });
    assertEquals(asCli.status, 200);
    assert(asCli.body.includes("Docs Writer"), "cli filter must keep the cli candidate");
    assert(!asCli.body.includes("Docs Web"), "cli filter must hide the web candidate");
    assert(!asCli.body.includes("Docs MCP"), "cli filter must hide the mcp candidate");
    assert(
      asCli.body.includes(
        'href="/internal/pending">全部<span class="tk-tab__count">3</span>',
      ),
      "filtered all-tab must still count every pending candidate",
    );
    assert(
      asCli.body.includes(
        'href="/internal/pending?channel=web">Web<span class="tk-tab__count">1</span>',
      ),
      "filtered web tab must still show its pending count",
    );
    assert(
      !asCli.body.includes('href="jsr:@example/docs-writer"'),
      "a filtered pending entry must not be a clickable target",
    );

    const asWeb = await fetchPage(`${base}/internal/pending?channel=web`, {
      headers: headersFor("human:security-auditor"),
    });
    assertEquals(asWeb.status, 200);
    assert(asWeb.body.includes("Docs Web"), "auditor web filter must keep the web candidate");
    assert(!asWeb.body.includes("Docs Writer"), "auditor web filter must hide the cli candidate");
    assert(!asWeb.body.includes("Docs MCP"), "auditor web filter must hide the mcp candidate");
    assert(
      !asWeb.body.includes('action="/review/'),
      "auditor must not approve from a filtered queue",
    );

    await assertLoginRedirect(
      `${base}/internal/pending?channel=cli`,
      "anonymous /internal/pending?channel=cli",
      (body) => {
        assert(!body.includes("Docs Writer"));
        assert(!body.includes("待审队列"));
        assert(!body.includes("jsr:@example/docs-writer"));
      },
    );
  });

  const catalogAfter = await Deno.readFile(catalog);
  assertEquals(
    catalogAfter,
    catalogBefore,
    "filtering the pending queue must not dirty the catalog",
  );
});
