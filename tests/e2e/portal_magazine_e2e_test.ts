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
