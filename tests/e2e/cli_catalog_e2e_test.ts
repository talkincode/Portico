import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleRecord, sampleWebRecord } from "./harness.ts";

Deno.test("CLI happy path: maintainer registers, reader lists and gets the same record", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer", "agent:docs-bot", "agent"),
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);
  const created = registered.stdout as {
    ok: boolean;
    data: { id: string; visibility: string; governanceState: string };
  };
  assertEquals(created.ok, true);
  assertEquals(created.data.id, "docs-writer");
  assertEquals(created.data.visibility, "internal");
  assertEquals(created.data.governanceState, "internal");

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
  ], env);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as {
    ok: boolean;
    data: Array<{ id: string; name: string }>;
  };
  assertEquals(listBody.ok, true);
  assertEquals(listBody.data.length, 1);
  assertEquals(listBody.data[0].id, "docs-writer");
  assertEquals(listBody.data[0].name, "Docs Writer");

  const got = await runCli([
    "catalog",
    "get",
    "--id",
    "docs-writer",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
  ], env);
  assertEquals(got.code, 0, got.raw || got.stderr);
  const getBody = got.stdout as {
    ok: boolean;
    data: { id: string; governanceState: string };
  };
  assertEquals(getBody.ok, true);
  assertEquals(getBody.data.id, "docs-writer");
  assertEquals(getBody.data.governanceState, "internal");
});

Deno.test("CLI reader cannot register; catalog file is not created", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);

  const result = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--input",
    input,
  ], env);
  assertEquals(result.code, 1);
  const body = result.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "FORBIDDEN");

  let present = true;
  try {
    await Deno.stat(catalog);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assert(!present, "forbidden register must not create the catalog file");
});

Deno.test("CLI public register fails and does not dirty the catalog", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const payload = sampleRecord();
  payload.visibility = "public";
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(payload)}\n`);

  const result = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer", "agent:docs-bot", "agent"),
    "--input",
    input,
  ], env);
  assertEquals(result.code, 1);
  const body = result.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "PUBLIC_REQUIRES_APPROVAL");

  let present = true;
  try {
    await Deno.stat(catalog);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assert(!present, "failed public register must not create the catalog file");
});

Deno.test("CLI catalog list filters visible records and does not search entry URLs", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const writerInput = `${dir}/writer.json`;
  const webInput = `${dir}/web.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(writerInput, `${JSON.stringify(sampleRecord())}\n`);
  await Deno.writeTextFile(webInput, `${JSON.stringify(sampleWebRecord())}\n`);

  assertEquals(
    (await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer", "agent:docs-bot", "agent"),
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
      ...actor("maintainer", "agent:docs-bot", "agent"),
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
      ...actor("maintainer", "agent:docs-bot", "agent"),
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

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--q",
    "Writer",
  ], env);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listedBody = listed.stdout as { ok: boolean; data: Array<{ id: string }> };
  assertEquals(listedBody.data.map((item) => item.id), ["docs-writer"]);

  const byUrl = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--q",
    "jsr:@example/docs-writer",
  ], env);
  assertEquals((byUrl.stdout as { data: unknown[] }).data, []);

  const byChannel = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--channel",
    "web",
  ], env);
  assertEquals(
    (byChannel.stdout as { data: Array<{ id: string }> }).data.map((item) => item.id),
    ["docs-web"],
  );

  const byState = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--state",
    "internal",
  ], env);
  assertEquals(
    (byState.stdout as { data: Array<{ id: string }> }).data.map((item) => item.id),
    ["docs-writer"],
  );

  const anonInternal = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--q",
    "Writer",
  ]);
  assertEquals((anonInternal.stdout as { data: unknown[] }).data, []);

  const anonPublic = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--q",
    "Web",
  ]);
  assertEquals(
    (anonPublic.stdout as { data: Array<{ id: string }> }).data.map((item) => item.id),
    ["docs-web"],
  );

  const before = await Deno.readFile(catalog);
  const bad = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--channel",
    "carrier-pigeon",
  ], env);
  assertEquals(bad.code, 1);
  assertEquals((bad.stdout as { error: { code: string } }).error.code, "INVALID_INPUT");
  assertEquals(
    await Deno.readFile(catalog),
    before,
    "invalid list query must not rewrite the catalog",
  );
});

Deno.test("CLI anonymous list hides internal records", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer", "agent:docs-bot", "agent"),
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const body = listed.stdout as { ok: boolean; data: unknown[] };
  assertEquals(body.ok, true);
  assertEquals(body.data, []);
});
