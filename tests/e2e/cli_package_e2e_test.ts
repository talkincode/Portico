import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleMcpRecord, sampleRecord } from "./harness.ts";

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

Deno.test("CLI happy path: maintainer registers package; reader list/describe the same coordinate", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-pkg-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
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
  const created = registered.stdout as {
    ok: boolean;
    data: { id: string; channels: string[]; entry: { kind: string; value: string } };
  };
  assertEquals(created.ok, true);
  assertEquals(created.data.id, "docs-writer");
  assertEquals(created.data.channels, ["cli"]);
  assertEquals(created.data.entry.kind, "package");

  const listed = await runCli([
    "cli",
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
      package: { kind: string; value: string };
      connect: { mode: string };
    }>;
  };
  assertEquals(listBody.ok, true);
  assertEquals(listBody.data.length, 1);
  assertEquals(listBody.data[0].id, "docs-writer");
  assertEquals(listBody.data[0].name, "Docs Writer");
  assertEquals(listBody.data[0].package.value, "jsr:@example/docs-writer");
  assertEquals(listBody.data[0].connect.mode, "coordinate");

  const described = await runCli([
    "cli",
    "describe",
    "--id",
    "docs-writer",
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(described.code, 0, described.raw || described.stderr);
  const describeBody = described.stdout as {
    ok: boolean;
    data: { id: string; package: { value: string }; connect: { mode: string } };
  };
  assertEquals(describeBody.ok, true);
  assertEquals(describeBody.data.id, "docs-writer");
  assertEquals(describeBody.data.package.value, "jsr:@example/docs-writer");
  assertEquals(describeBody.data.connect.mode, "coordinate");
});

Deno.test("CLI package list hides MCP-only surfaces", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-pkg-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleMcpRecord())}\n`);

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
    "cli",
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

Deno.test("CLI anonymous cannot list or describe an internal package surface", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-pkg-e2e-" });
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
    "cli",
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
  const listBody = listed.stdout as { ok: boolean; data: unknown[] };
  assertEquals(listBody.data, []);

  const described = await runCli([
    "cli",
    "describe",
    "--id",
    "docs-writer",
    "--catalog",
    catalog,
    "--actor-id",
    "anonymous",
    "--actor-kind",
    "human",
    "--actor-role",
    "anonymous",
  ]);
  assertEquals(described.code, 1);
  const describeBody = described.stdout as { ok: boolean; error: { code: string } };
  assertEquals(describeBody.ok, false);
  assertEquals(describeBody.error.code, "NOT_FOUND");
});

Deno.test("CLI command-style package is rejected and does not create the catalog", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-pkg-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  const payload = sampleRecord();
  payload.entry = { kind: "package", value: "npx -y @example/docs-writer" };
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
  assert(!(await fileExists(catalog)), "failed CLI register must not create the catalog file");
});

Deno.test("CLI public package publish stays hidden from anonymous until independent approve", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-pkg-e2e-" });
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

  const published = await runCli([
    "catalog",
    "publish",
    "--id",
    "docs-writer",
    "--visibility",
    "public",
    "--catalog",
    catalog,
    ...actor("maintainer"),
  ], env);
  assertEquals(published.code, 0, published.raw || published.stderr);

  const anonPending = await runCli([
    "cli",
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
  assertEquals(anonPending.code, 0, anonPending.raw || anonPending.stderr);
  const pendingBody = anonPending.stdout as { ok: boolean; data: unknown[] };
  assertEquals(pendingBody.data, []);

  const approved = await runCli([
    "catalog",
    "approve",
    "--id",
    "docs-writer",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(approved.code, 0, approved.raw || approved.stderr);

  const anonApproved = await runCli([
    "cli",
    "describe",
    "--id",
    "docs-writer",
    "--catalog",
    catalog,
    "--actor-id",
    "anonymous",
    "--actor-kind",
    "human",
    "--actor-role",
    "anonymous",
  ]);
  assertEquals(anonApproved.code, 0, anonApproved.raw || anonApproved.stderr);
  const describeBody = anonApproved.stdout as {
    ok: boolean;
    data: { id: string; governanceState: string; package: { value: string } };
  };
  assertEquals(describeBody.data.id, "docs-writer");
  assertEquals(describeBody.data.governanceState, "approved_public");
  assertEquals(describeBody.data.package.value, "jsr:@example/docs-writer");
});
