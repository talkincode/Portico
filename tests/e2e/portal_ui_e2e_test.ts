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
  sampleRecord,
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

    const anonInternal = await fetchPage(`${base}/internal`);
    assertHtml404(anonInternal, "anonymous /internal");
    assert(!anonInternal.body.includes("Docs Writer"));
    assert(!anonInternal.body.includes("内部笔记台"));
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

    const anonAudit = await fetchPage(`${base}/internal/audit`);
    assertHtml404(anonAudit, "anonymous /internal/audit");
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

    const asAnon = await fetchPage(`${base}/internal/approvals`);
    assertHtml404(asAnon, "anonymous /internal/approvals");
    assert(!asAnon.body.includes("Docs Writer"));
    assert(!asAnon.body.includes("Package coordinate reviewed."));
    assert(!asAnon.body.includes("审批记录"));
  });

  const catalogAfter = await Deno.readFile(catalog);
  assertEquals(
    catalogAfter,
    catalogBefore,
    "reading the approvals page must not dirty the catalog",
  );
});
