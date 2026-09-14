import { assert, assertEquals } from "../assert.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import { actor, bootstrapRoster, runCli, sampleWebRecord } from "./harness.ts";

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

Deno.test("E2E: CLI web register is the same href on Portal for a reader, hidden from anonymous", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-web-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleWebRecord(), null, 2)}\n`);

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
    "web",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(cliList.code, 0, cliList.raw || cliList.stderr);
  const cliBody = cliList.stdout as {
    ok: boolean;
    data: Array<{ id: string; name: string; href: { value: string } }>;
  };
  assertEquals(cliBody.data.length, 1);

  await withPortal(catalog, identities, async (base) => {
    const portalList = await fetchJson(`${base}/api/web`, { headers: readerHeaders() });
    assertEquals(portalList.status, 200);
    assertEquals(portalList.body.ok, true);
    const data = portalList.body.data as Array<{
      id: string;
      name: string;
      href: { value: string };
      connect: { mode: string };
    }>;
    assertEquals(data.length, 1);
    assertEquals(data[0].id, cliBody.data[0].id);
    assertEquals(data[0].name, cliBody.data[0].name);
    assertEquals(data[0].href.value, cliBody.data[0].href.value);
    assertEquals(data[0].connect.mode, "direct");

    const portalDescribe = await fetchJson(`${base}/api/web/docs-web`, {
      headers: readerHeaders(),
    });
    assertEquals(portalDescribe.status, 200);
    const described = portalDescribe.body.data as {
      id: string;
      href: { value: string };
      connect: { mode: string };
    };
    assertEquals(described.id, "docs-web");
    assertEquals(described.href.value, "https://docs.example.test/portals/docs-writer");
    assertEquals(described.connect.mode, "direct");

    const html = await fetch(`${base}/`, { headers: readerHeaders() });
    assertEquals(html.status, 200);
    const page = await html.text();
    assert(page.includes("Docs Web"), "portal HTML should show the web surface name");
    assert(
      page.includes("https://docs.example.test/portals/docs-writer"),
      "portal HTML should show the authorized web href",
    );
    assert(
      page.includes('href="https://docs.example.test/portals/docs-writer"'),
      "authorized web href must be a direct link, not a Portico proxy",
    );

    const anon = await fetchJson(`${base}/api/web`);
    assertEquals(anon.status, 200);
    assertEquals(anon.body.data, []);
    const anonDescribe = await fetchJson(`${base}/api/web/docs-web`);
    assertEquals(anonDescribe.status, 404);
    assertEquals(anonDescribe.body.ok, false);
    assertEquals(anonDescribe.body.error?.code, "NOT_FOUND");
    const anonPage = await (await fetch(`${base}/`)).text();
    assert(!anonPage.includes("Docs Web"), "anonymous portal must not leak internal web names");
    assert(
      !anonPage.includes("https://docs.example.test/portals/docs-writer"),
      "anonymous portal must not leak internal web hrefs",
    );
  });
});

Deno.test("E2E: Portal web POST does not dirty the catalog file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-web-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleWebRecord())}\n`);

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
    const response = await fetchJson(`${base}/api/web`, {
      method: "POST",
      headers: { ...readerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ id: "evil-web" }),
    });
    assertEquals(response.status, 405);
    assertEquals(response.body.ok, false);
    assertEquals(response.body.error?.code, "USAGE");
  });

  assertEquals(await Deno.readTextFile(catalog), before);
});
