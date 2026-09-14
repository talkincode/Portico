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

interface JsonBody {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: JsonBody }> {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() as JsonBody };
}

function readerHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${sessionFor("human:reader")!}`,
  };
}

async function withPortal(
  catalog: string,
  identities: string,
  page: string,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const server = listenPortal({
    catalogPath: catalog,
    identitiesPath: identities,
    sessionsPath: sessionsPathFor(identities),
    pagePath: page,
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

Deno.test("E2E: CLI page set is the same card on Portal for a reader, hidden from anonymous", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-page-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const page = `${dir}/page.json`;
  const input = `${dir}/record.json`;
  const pageInput = `${dir}/page-input.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(
    pageInput,
    `${
      JSON.stringify(
        {
          components: [
            { kind: "catalog_card", id: "docs-writer" },
            { kind: "permission_hint" },
          ],
        },
        null,
        2,
      )
    }\n`,
  );

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
      "page",
      "set",
      "--page",
      page,
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      pageInput,
    ], env)).code,
    0,
  );

  const cliGet = await runCli([
    "page",
    "get",
    "--page",
    page,
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(cliGet.code, 0, cliGet.raw || cliGet.stderr);
  const cliBody = cliGet.stdout as {
    data: { components: Array<{ kind: string; id?: string; name?: string }> };
  };

  await withPortal(catalog, identities, page, async (base) => {
    const portalPage = await fetchJson(`${base}/api/page`, { headers: readerHeaders() });
    assertEquals(portalPage.status, 200);
    assertEquals(portalPage.body.ok, true);
    const data = portalPage.body.data as {
      components: Array<{ kind: string; id?: string; name?: string }>;
    };
    assertEquals(data.components.length, cliBody.data.components.length);
    assertEquals(data.components[0].id, cliBody.data.components[0].id);
    assertEquals(data.components[0].name, cliBody.data.components[0].name);

    const html = await fetch(`${base}/`, { headers: readerHeaders() });
    assertEquals(html.status, 200);
    const text = await html.text();
    assert(text.includes("Docs Writer"));
    assert(text.includes('data-kind="catalog_card"'));

    const anon = await fetchJson(`${base}/api/page`);
    const anonData = anon.body.data as { components: Array<{ kind: string }> };
    assertEquals(anonData.components.some((item) => item.kind === "catalog_card"), false);
    const anonHtml = await (await fetch(`${base}/`)).text();
    assert(!anonHtml.includes("Docs Writer"), "anonymous portal must not leak internal names");
  });
});

Deno.test("E2E: Portal POST /api/page does not dirty the page or catalog files", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-page-write-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const page = `${dir}/page.json`;
  const input = `${dir}/record.json`;
  const pageInput = `${dir}/page-input.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(
    pageInput,
    `${JSON.stringify({ components: [{ kind: "catalog_card", id: "docs-writer" }] }, null, 2)}\n`,
  );

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
      "page",
      "set",
      "--page",
      page,
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      pageInput,
    ], env)).code,
    0,
  );
  const beforePage = await Deno.readTextFile(page);
  const beforeCatalog = await Deno.readTextFile(catalog);

  await withPortal(catalog, identities, page, async (base) => {
    const posted = await fetchJson(`${base}/api/page`, {
      method: "POST",
      headers: { ...readerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ components: [{ kind: "hero_banner" }] }),
    });
    assertEquals(posted.status, 405);
    assertEquals(posted.body.ok, false);
    assertEquals(posted.body.error?.code, "USAGE");
  });

  assertEquals(await Deno.readTextFile(page), beforePage);
  assertEquals(await Deno.readTextFile(catalog), beforeCatalog);
});
