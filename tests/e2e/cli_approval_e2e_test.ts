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

async function registerAndSubmitPublic(catalog: string, input: string): Promise<void> {
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
}

Deno.test("CLI happy path: independent auditor approves; anonymous then lists the same record", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approval-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await registerAndSubmitPublic(catalog, input);

  const approved = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
  ]);
  assertEquals(approved.code, 0, approved.raw || approved.stderr);
  const approvedBody = approved.stdout as {
    ok: boolean;
    data: { governanceState: string; visibility: string };
  };
  assertEquals(approvedBody.ok, true);
  assertEquals(approvedBody.data.governanceState, "approved_public");
  assertEquals(approvedBody.data.visibility, "public");

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as {
    ok: boolean;
    data: Array<{ id: string; governanceState: string }>;
  };
  assertEquals(listBody.ok, true);
  assertEquals(listBody.data.length, 1);
  assertEquals(listBody.data[0].id, "docs-writer");
  assertEquals(listBody.data[0].governanceState, "approved_public");

  const approvals = await runCli([
    "catalog",
    "approvals",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ]);
  assertEquals(approvals.code, 0, approvals.raw || approvals.stderr);
  const approvalBody = approvals.stdout as {
    ok: boolean;
    data: Array<{
      surfaceId: string;
      decision: string;
      submittedBy: { id: string };
      reviewedBy: { id: string; kind: string };
    }>;
  };
  assertEquals(approvalBody.ok, true);
  assertEquals(approvalBody.data.length, 1);
  assertEquals(approvalBody.data[0].surfaceId, "docs-writer");
  assertEquals(approvalBody.data[0].decision, "approved");
  assertEquals(approvalBody.data[0].submittedBy.id, "agent:docs-bot");
  assertEquals(approvalBody.data[0].reviewedBy.id, "human:security-auditor");
  assertEquals(approvalBody.data[0].reviewedBy.kind, "human");
});

Deno.test("CLI self-approval fails; anonymous still sees nothing and catalog stays pending", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approval-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const record = sampleRecord();
  record.maintainers = [{ id: "human:docs-owner", kind: "human" }];
  await Deno.writeTextFile(input, `${JSON.stringify(record)}\n`);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer", "human:docs-owner", "human"),
    "--input",
    input,
  ]);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  const published = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    ...actor("maintainer", "human:docs-owner", "human"),
    "--id",
    "docs-writer",
    "--visibility",
    "public",
  ]);
  assertEquals(published.code, 0, published.raw || published.stderr);

  const result = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("auditor", "human:docs-owner", "human"),
    "--id",
    "docs-writer",
  ]);
  assertEquals(result.code, 1);
  const body = result.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "SELF_APPROVAL");

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as { ok: boolean; data: unknown[] };
  assertEquals(listBody.data, []);

  const file = JSON.parse(await Deno.readTextFile(catalog)) as {
    records: Array<{ governanceState: string }>;
    approvals?: unknown[];
  };
  assertEquals(file.records[0].governanceState, "pending_public");
  assertEquals(file.approvals ?? [], []);
});

Deno.test("CLI maintainer cannot approve; catalog is not dirtied", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approval-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);
  await registerAndSubmitPublic(catalog, input);

  const result = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--id",
    "docs-writer",
  ]);
  assertEquals(result.code, 1);
  const body = result.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "FORBIDDEN");

  const file = JSON.parse(await Deno.readTextFile(catalog)) as {
    records: Array<{ governanceState: string }>;
    approvals?: unknown[];
  };
  assertEquals(file.records[0].governanceState, "pending_public");
  assertEquals(file.approvals ?? [], []);
});

Deno.test("CLI reject keeps anonymous empty; reader sees rejected", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approval-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);
  await registerAndSubmitPublic(catalog, input);

  const rejected = await runCli([
    "catalog",
    "reject",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
  ]);
  assertEquals(rejected.code, 0, rejected.raw || rejected.stderr);
  const rejectedBody = rejected.stdout as {
    ok: boolean;
    data: { governanceState: string };
  };
  assertEquals(rejectedBody.ok, true);
  assertEquals(rejectedBody.data.governanceState, "rejected");

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const listBody = listed.stdout as { ok: boolean; data: unknown[] };
  assertEquals(listBody.data, []);

  const readerGot = await runCli([
    "catalog",
    "get",
    "--id",
    "docs-writer",
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ]);
  assertEquals(readerGot.code, 0, readerGot.raw || readerGot.stderr);
  const gotBody = readerGot.stdout as {
    ok: boolean;
    data: { governanceState: string };
  };
  assertEquals(gotBody.data.governanceState, "rejected");
});
