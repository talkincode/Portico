import { assert, assertEquals } from "../assert.ts";
import { bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

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
    "--actor-id",
    "agent:docs-bot",
    "--actor-kind",
    "agent",
    "--actor-role",
    "maintainer",
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
    "--actor-id",
    "human:auditor",
    "--actor-kind",
    "human",
    "--actor-role",
    "reader",
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
    "--actor-id",
    "human:auditor",
    "--actor-kind",
    "human",
    "--actor-role",
    "reader",
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
    "--actor-id",
    "human:auditor",
    "--actor-kind",
    "human",
    "--actor-role",
    "reader",
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
    "--actor-id",
    "agent:docs-bot",
    "--actor-kind",
    "agent",
    "--actor-role",
    "maintainer",
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
    "--actor-id",
    "agent:docs-bot",
    "--actor-kind",
    "agent",
    "--actor-role",
    "maintainer",
    "--input",
    input,
  ], env);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--actor-id",
    "anonymous",
    "--actor-kind",
    "human",
    "--actor-role",
    "anonymous",
  ]);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const body = listed.stdout as { ok: boolean; data: unknown[] };
  assertEquals(body.ok, true);
  assertEquals(body.data, []);
});
