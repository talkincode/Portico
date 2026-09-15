import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleRecord, sampleWebRecord } from "./harness.ts";

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

Deno.test("CLI happy path: maintainer registers web; reader list/describe the same href", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-web-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
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
  const created = registered.stdout as {
    ok: boolean;
    data: { id: string; channels: string[]; entry: { kind: string; value: string } };
  };
  assertEquals(created.ok, true);
  assertEquals(created.data.id, "docs-web");
  assertEquals(created.data.channels, ["web"]);
  assertEquals(created.data.entry.kind, "url");

  const listed = await runCli([
    "web",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as {
    ok: boolean;
    data: Array<{
      id: string;
      name: string;
      href: { kind: string; value: string };
      connect: { mode: string };
    }>;
  };
  assertEquals(listBody.ok, true);
  assertEquals(listBody.data.length, 1);
  assertEquals(listBody.data[0].id, "docs-web");
  assertEquals(listBody.data[0].name, "Docs Web");
  assertEquals(listBody.data[0].href.value, "https://docs.example.test/portals/docs-writer");
  assertEquals(listBody.data[0].connect.mode, "direct");

  const described = await runCli([
    "web",
    "describe",
    "--id",
    "docs-web",
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(described.code, 0, described.raw || described.stderr);
  const describeBody = described.stdout as {
    ok: boolean;
    data: { id: string; href: { value: string }; connect: { mode: string } };
  };
  assertEquals(describeBody.ok, true);
  assertEquals(describeBody.data.id, "docs-web");
  assertEquals(describeBody.data.href.value, "https://docs.example.test/portals/docs-writer");
  assertEquals(describeBody.data.connect.mode, "direct");
});

Deno.test("CLI web list hides CLI-only surfaces", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-web-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);

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

  const listed = await runCli([
    "web",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const body = listed.stdout as { ok: boolean; data: unknown[] };
  assertEquals(body.ok, true);
  assertEquals(body.data, []);
});

Deno.test("CLI anonymous cannot list or describe an internal web surface", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-web-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
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

  const listed = await runCli([
    "web",
    "list",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as { ok: boolean; data: unknown[] };
  assertEquals(listBody.data, []);

  const described = await runCli([
    "web",
    "describe",
    "--id",
    "docs-web",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(described.code, 1);
  const describeBody = described.stdout as { ok: boolean; error: { code: string } };
  assertEquals(describeBody.ok, false);
  assertEquals(describeBody.error.code, "NOT_FOUND");
});

Deno.test("CLI web URL with a secret query is rejected and does not create the catalog", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-web-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  const payload = sampleWebRecord();
  payload.entry = {
    kind: "url",
    value: "https://docs.example.test/portals/docs-writer?token=not-a-real-secret",
  };
  await Deno.writeTextFile(input, `${JSON.stringify(payload)}\n`);

  const result = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ], env);
  assertEquals(result.code, 1);
  const body = result.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "INVALID_INPUT");
  assert(!(await fileExists(catalog)), "failed web register must not create the catalog file");
});

Deno.test("CLI register rejects a web entry that points at Portico's own reading page", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-web-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const payload = sampleWebRecord();
  payload.entry = { kind: "url", value: "http://127.0.0.1:8788/s/docs-web" };
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(payload)}\n`);

  const result = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ], env);
  assertEquals(result.code, 1);
  const body = result.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "INVALID_INPUT");
  assert(!(await fileExists(catalog)), "self-reading web entry must not create the catalog file");
});

Deno.test("CLI public web publish stays hidden from anonymous until independent approve", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-web-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
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

  const published = await runCli([
    "catalog",
    "publish",
    "--id",
    "docs-web",
    "--visibility",
    "public",
    "--catalog",
    catalog,
    ...actor("maintainer"),
  ], env);
  assertEquals(published.code, 0, published.raw || published.stderr);

  const anonPending = await runCli([
    "web",
    "list",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(anonPending.code, 0, anonPending.raw || anonPending.stderr);
  const pendingBody = anonPending.stdout as { ok: boolean; data: unknown[] };
  assertEquals(pendingBody.data, []);

  const approved = await runCli([
    "catalog",
    "approve",
    "--id",
    "docs-web",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(approved.code, 0, approved.raw || approved.stderr);

  const anonApproved = await runCli([
    "web",
    "describe",
    "--id",
    "docs-web",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(anonApproved.code, 0, anonApproved.raw || anonApproved.stderr);
  const describeBody = anonApproved.stdout as {
    ok: boolean;
    data: { id: string; governanceState: string; href: { value: string } };
  };
  assertEquals(describeBody.data.id, "docs-web");
  assertEquals(describeBody.data.governanceState, "approved_public");
  assertEquals(describeBody.data.href.value, "https://docs.example.test/portals/docs-writer");
});
