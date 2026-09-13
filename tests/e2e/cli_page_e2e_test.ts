import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

Deno.test("CLI happy path: maintainer sets page; reader gets the same catalog_card", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-page-e2e-" });
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

  const set = await runCli([
    "page",
    "set",
    "--page",
    page,
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    pageInput,
  ], env);
  assertEquals(set.code, 0, set.raw || set.stderr);

  const got = await runCli([
    "page",
    "get",
    "--page",
    page,
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(got.code, 0, got.raw || got.stderr);
  const body = got.stdout as {
    ok: boolean;
    data: { components: Array<{ kind: string; id?: string; name?: string; role?: string }> };
  };
  assertEquals(body.data.components.length, 2);
  assertEquals(body.data.components[0].kind, "catalog_card");
  assertEquals(body.data.components[0].id, "docs-writer");
  assertEquals(body.data.components[0].name, "Docs Writer");
  assertEquals(body.data.components[1].kind, "permission_hint");
  assertEquals(body.data.components[1].role, "reader");
});

Deno.test("CLI reader cannot set page; page file is absent", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-page-forbidden-e2e-" });
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

  const set = await runCli([
    "page",
    "set",
    "--page",
    page,
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
    "--input",
    pageInput,
  ], env);
  assertEquals(set.code, 1);
  const body = set.stdout as { ok: boolean; error?: { code: string } };
  assertEquals(body.error?.code, "FORBIDDEN");

  let present = true;
  try {
    await Deno.stat(page);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assert(!present, "failed page set must not create the page file");
});

Deno.test("CLI custom component kind fails and does not write the page file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-page-cms-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const page = `${dir}/page.json`;
  const input = `${dir}/record.json`;
  const pageInput = `${dir}/page-input.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(
    pageInput,
    `${JSON.stringify({ components: [{ kind: "hero_banner", html: "<h1>x</h1>" }] }, null, 2)}\n`,
  );

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

  const set = await runCli([
    "page",
    "set",
    "--page",
    page,
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    pageInput,
  ], env);
  assertEquals(set.code, 1);
  const body = set.stdout as { ok: boolean; error?: { code: string } };
  assertEquals(body.error?.code, "INVALID_INPUT");

  let present = true;
  try {
    await Deno.stat(page);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assert(!present, "CMS-style page set must not create the page file");
});

Deno.test("CLI anonymous page get omits internal cards until independent approve", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-page-public-e2e-" });
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

  const pending = await runCli([
    "page",
    "get",
    "--page",
    page,
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ], env);
  assertEquals(pending.code, 0, pending.raw || pending.stderr);
  const pendingBody = pending.stdout as { data: { components: unknown[] } };
  assertEquals(pendingBody.data.components, []);

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

  const approved = await runCli([
    "page",
    "get",
    "--page",
    page,
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ], env);
  assertEquals(approved.code, 0, approved.raw || approved.stderr);
  const approvedBody = approved.stdout as {
    data: { components: Array<{ id: string; governanceState: string }> };
  };
  assertEquals(approvedBody.data.components.length, 1);
  assertEquals(approvedBody.data.components[0].id, "docs-writer");
  assertEquals(approvedBody.data.components[0].governanceState, "approved_public");
});
