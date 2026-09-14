import { assert, assertEquals } from "../assert.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

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
    "x-portico-actor-id": "human:reader",
    "x-portico-actor-kind": "human",
    "x-portico-actor-role": "reader",
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

Deno.test("E2E: CLI register is visible on Portal to a reader and hidden from anonymous", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-e2e-" });
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

  const cliList = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(cliList.code, 0, cliList.raw || cliList.stderr);
  const cliBody = cliList.stdout as { ok: boolean; data: Array<{ id: string; name: string }> };
  assertEquals(cliBody.data.length, 1);
  assertEquals(cliBody.data[0].id, "docs-writer");

  await withPortal(catalog, identities, async (base) => {
    const portalList = await fetchJson(`${base}/api/catalog`, { headers: readerHeaders() });
    assertEquals(portalList.status, 200);
    assertEquals(portalList.body.ok, true);
    const data = portalList.body.data as Array<
      { id: string; name: string; governanceState: string }
    >;
    assertEquals(data.length, 1);
    assertEquals(data[0].id, cliBody.data[0].id);
    assertEquals(data[0].name, cliBody.data[0].name);
    assertEquals(data[0].governanceState, "internal");

    const html = await fetch(`${base}/`, { headers: readerHeaders() });
    assertEquals(html.status, 200);
    const page = await html.text();
    assert(page.includes("Docs Writer"), "portal HTML should match the CLI record name");

    const anon = await fetchJson(`${base}/api/catalog`);
    assertEquals(anon.status, 200);
    assertEquals(anon.body.data, []);
    const anonPage = await (await fetch(`${base}/`)).text();
    assert(!anonPage.includes("Docs Writer"), "anonymous portal must not leak internal names");
  });
});

Deno.test("E2E: pending public stays hidden from anonymous on Portal; approve then matches CLI", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-public-e2e-" });
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

  const published = await runCli([
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
  assertEquals(published.code, 0, published.raw || published.stderr);

  await withPortal(catalog, identities, async (base) => {
    const pending = await fetchJson(`${base}/api/catalog`);
    assertEquals(pending.body.data, []);
    const readerSees = await fetchJson(`${base}/api/catalog`, { headers: readerHeaders() });
    const readerData = readerSees.body.data as Array<{ governanceState: string }>;
    assertEquals(readerData.length, 1);
    assertEquals(readerData[0].governanceState, "pending_public");
    const dash = await fetchJson(`${base}/api/dashboard`);
    const counts =
      (dash.body.data as { counts: { pending_public: number; visible: number } }).counts;
    assertEquals(counts.visible, 0);
    assertEquals(counts.pending_public, 0);
  });

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

  const cliAnon = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(cliAnon.code, 0, cliAnon.raw || cliAnon.stderr);

  await withPortal(catalog, identities, async (base) => {
    const portalAnon = await fetchJson(`${base}/api/catalog`);
    assertEquals(portalAnon.status, 200);
    const portalData = portalAnon.body.data as Array<{ id: string; governanceState: string }>;
    const cliData =
      (cliAnon.stdout as { data: Array<{ id: string; governanceState: string }> }).data;
    assertEquals(portalData.length, 1);
    assertEquals(portalData[0].id, cliData[0].id);
    assertEquals(portalData[0].governanceState, "approved_public");
    assertEquals(cliData[0].governanceState, "approved_public");
  });
});

Deno.test("E2E: Portal POST does not dirty the catalog file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-write-e2e-" });
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
  const before = await Deno.readTextFile(catalog);

  await withPortal(catalog, identities, async (base) => {
    const response = await fetchJson(`${base}/api/catalog`, {
      method: "POST",
      headers: {
        ...readerHeaders(),
        "x-portico-actor-id": "agent:docs-bot",
        "x-portico-actor-kind": "agent",
        "x-portico-actor-role": "maintainer",
        "content-type": "application/json",
      },
      body: JSON.stringify({ visibility: "public", token: "should-not-be-written" }),
    });
    assertEquals(response.status, 405);
    assertEquals(response.body.ok, false);
    assertEquals(response.body.error?.code, "USAGE");
  });

  assertEquals(await Deno.readTextFile(catalog), before);
});

Deno.test("E2E: Portal homepage cards open an in-portal detail page for the same surface", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-detail-e2e-" });
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
    const home = await fetch(`${base}/`, { headers: readerHeaders() });
    assertEquals(home.status, 200);
    const homeHtml = await home.text();
    assert(homeHtml.includes("Docs Writer"));
    assert(homeHtml.includes('href="/s/docs-writer"'));
    assert(!homeHtml.includes("<th>治理状态</th>"));

    const detail = await fetch(`${base}/s/docs-writer`, { headers: readerHeaders() });
    assertEquals(detail.status, 200);
    const detailHtml = await detail.text();
    assert(detailHtml.includes("Docs Writer"));
    assert(detailHtml.includes("Drafts internal documentation."));

    const anon = await fetch(`${base}/s/docs-writer`);
    assertEquals(anon.status, 404);
    const anonHtml = await anon.text();
    assert(!anonHtml.includes("Docs Writer"));
  });
});
