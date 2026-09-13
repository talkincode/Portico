import { assert, assertEquals } from "../assert.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const CLI = `${ROOT}src/cli/main.ts`;

interface CliResult {
  code: number;
  stdout: unknown;
  raw: string;
  stderr: string;
}

async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<CliResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      CLI,
      ...args,
    ],
    cwd: ROOT,
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const raw = new TextDecoder().decode(output.stdout).trim();
  const stderr = new TextDecoder().decode(output.stderr);
  let stdout: unknown = null;
  if (raw) {
    try {
      stdout = JSON.parse(raw);
    } catch {
      stdout = raw;
    }
  }
  return { code: output.code, stdout, raw, stderr };
}

function sampleRecord() {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function actor(role: string, id = "agent:docs-bot", kind = "agent") {
  return [
    "--actor-id",
    id,
    "--actor-kind",
    kind,
    "--actor-role",
    role,
  ];
}

Deno.test("CLI happy path: draft stays hidden, internal publish is visible to reader", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-publish-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);

  const drafted = await runCli([
    "catalog",
    "draft",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ]);
  assertEquals(drafted.code, 0, drafted.raw || drafted.stderr);
  const draftBody = drafted.stdout as {
    ok: boolean;
    data: { id: string; governanceState: string };
  };
  assertEquals(draftBody.ok, true);
  assertEquals(draftBody.data.id, "docs-writer");
  assertEquals(draftBody.data.governanceState, "draft");

  const hidden = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
  ]);
  assertEquals(hidden.code, 0, hidden.raw || hidden.stderr);
  const hiddenBody = hidden.stdout as { ok: boolean; data: unknown[] };
  assertEquals(hiddenBody.ok, true);
  assertEquals(hiddenBody.data, []);

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
  ]);
  assertEquals(published.code, 0, published.raw || published.stderr);
  const publishedBody = published.stdout as {
    ok: boolean;
    data: { governanceState: string; visibility: string };
  };
  assertEquals(publishedBody.ok, true);
  assertEquals(publishedBody.data.governanceState, "internal");
  assertEquals(publishedBody.data.visibility, "internal");

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
  ]);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as {
    ok: boolean;
    data: Array<{ id: string; governanceState: string }>;
  };
  assertEquals(listBody.ok, true);
  assertEquals(listBody.data.length, 1);
  assertEquals(listBody.data[0].id, "docs-writer");
  assertEquals(listBody.data[0].governanceState, "internal");
});

Deno.test("CLI public publish is pending and hidden from anonymous", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-publish-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ]);
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
  ]);
  assertEquals(published.code, 0, published.raw || published.stderr);
  const body = published.stdout as {
    ok: boolean;
    data: { visibility: string; governanceState: string };
  };
  assertEquals(body.ok, true);
  assertEquals(body.data.visibility, "public");
  assertEquals(body.data.governanceState, "pending_public");

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as { ok: boolean; data: unknown[] };
  assertEquals(listBody.ok, true);
  assertEquals(listBody.data, []);

  const readerGot = await runCli([
    "catalog",
    "get",
    "--id",
    "docs-writer",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
  ]);
  assertEquals(readerGot.code, 0, readerGot.raw || readerGot.stderr);
  const gotBody = readerGot.stdout as {
    ok: boolean;
    data: { governanceState: string };
  };
  assertEquals(gotBody.ok, true);
  assertEquals(gotBody.data.governanceState, "pending_public");
});

Deno.test("CLI reader cannot publish; existing internal record is unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-publish-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ]);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  const result = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--id",
    "docs-writer",
    "--visibility",
    "public",
  ]);
  assertEquals(result.code, 1);
  const body = result.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "FORBIDDEN");

  const file = JSON.parse(await Deno.readTextFile(catalog)) as {
    records: Array<{ visibility: string; governanceState: string }>;
  };
  assertEquals(file.records.length, 1);
  assertEquals(file.records[0].visibility, "internal");
  assertEquals(file.records[0].governanceState, "internal");
});

Deno.test("CLI reader draft does not create the catalog file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-publish-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);

  const result = await runCli([
    "catalog",
    "draft",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--input",
    input,
  ]);
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
  assert(!present, "forbidden draft must not create the catalog file");
});
