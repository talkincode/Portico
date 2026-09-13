import { assertEquals } from "../assert.ts";

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

function actor(role: string, id: string, kind: string) {
  return [
    "--actor-id",
    id,
    "--actor-kind",
    kind,
    "--actor-role",
    role,
  ];
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

async function bootstrapRoster(identities: string): Promise<void> {
  const first = await runCli([
    "identity",
    "grant",
    "--identities",
    identities,
    "--id",
    "human:security-auditor",
    "--kind",
    "human",
    "--role",
    "auditor",
  ]);
  assertEquals(first.code, 0, first.raw || first.stderr);

  const maintainer = await runCli([
    "identity",
    "grant",
    "--identities",
    identities,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "agent:docs-bot",
    "--kind",
    "agent",
    "--role",
    "maintainer",
  ]);
  assertEquals(maintainer.code, 0, maintainer.raw || maintainer.stderr);

  const reader = await runCli([
    "identity",
    "grant",
    "--identities",
    identities,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:reader",
    "--kind",
    "human",
    "--role",
    "reader",
  ]);
  assertEquals(reader.code, 0, reader.raw || reader.stderr);
}

Deno.test("CLI happy path: granted maintainer registers; reader lists the same record", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-access-e2e-" });
  const identities = `${dir}/identities.json`;
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await bootstrapRoster(identities);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("maintainer", "agent:docs-bot", "agent"),
    "--input",
    input,
  ]);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);
  const created = registered.stdout as { ok: boolean; data: { id: string } };
  assertEquals(created.ok, true);
  assertEquals(created.data.id, "docs-writer");

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("reader", "human:reader", "human"),
  ]);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as {
    ok: boolean;
    data: Array<{ id: string }>;
  };
  assertEquals(listBody.ok, true);
  assertEquals(listBody.data.length, 1);
  assertEquals(listBody.data[0].id, "docs-writer");
});

Deno.test("CLI maintainer cannot claim auditor; identities and catalog stay unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-access-e2e-" });
  const identities = `${dir}/identities.json`;
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);
  await bootstrapRoster(identities);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("maintainer", "agent:docs-bot", "agent"),
    "--input",
    input,
  ]);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  const published = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("maintainer", "agent:docs-bot", "agent"),
    "--id",
    "docs-writer",
    "--visibility",
    "public",
  ]);
  assertEquals(published.code, 0, published.raw || published.stderr);

  const claimed = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("auditor", "agent:docs-bot", "agent"),
    "--id",
    "docs-writer",
  ]);
  assertEquals(claimed.code, 1);
  const body = claimed.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "FORBIDDEN");

  const file = JSON.parse(await Deno.readTextFile(catalog)) as {
    records: Array<{ governanceState: string }>;
    approvals?: unknown[];
  };
  assertEquals(file.records[0].governanceState, "pending_public");
  assertEquals(file.approvals ?? [], []);
});

Deno.test("CLI maintainer cannot grant self auditor; identity file is not rewritten", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-access-e2e-" });
  const identities = `${dir}/identities.json`;
  await bootstrapRoster(identities);
  const before = await Deno.readTextFile(identities);

  const result = await runCli([
    "identity",
    "grant",
    "--identities",
    identities,
    ...actor("maintainer", "agent:docs-bot", "agent"),
    "--id",
    "agent:docs-bot",
    "--kind",
    "agent",
    "--role",
    "auditor",
  ]);
  assertEquals(result.code, 1);
  const body = result.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "FORBIDDEN");
  assertEquals(await Deno.readTextFile(identities), before);
});

Deno.test("CLI unknown identity cannot register; catalog file is absent", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-access-e2e-" });
  const identities = `${dir}/identities.json`;
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);
  await bootstrapRoster(identities);

  const result = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("maintainer", "agent:stranger", "agent"),
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
  assertEquals(present, false);
});
