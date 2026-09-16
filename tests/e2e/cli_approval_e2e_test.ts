import { assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

async function registerAndSubmitPublic(
  catalog: string,
  input: string,
  env: Record<string, string>,
): Promise<void> {
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
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--id",
    "docs-writer",
    "--visibility",
    "public",
  ], env);
  assertEquals(published.code, 0, published.raw || published.stderr);
}

Deno.test("CLI happy path: independent auditor approves; anonymous then lists the same record", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approval-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await registerAndSubmitPublic(catalog, input, env);

  const approved = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
    "--note",
    "Package coordinate reviewed.",
  ], env);
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
  ], env);
  assertEquals(approvals.code, 0, approvals.raw || approvals.stderr);
  const approvalBody = approvals.stdout as {
    ok: boolean;
    data: Array<{
      surfaceId: string;
      decision: string;
      submittedBy: { id: string };
      reviewedBy: { id: string; kind: string };
      note?: string;
    }>;
  };
  assertEquals(approvalBody.ok, true);
  assertEquals(approvalBody.data.length, 1);
  assertEquals(approvalBody.data[0].surfaceId, "docs-writer");
  assertEquals(approvalBody.data[0].decision, "approved");
  assertEquals(approvalBody.data[0].submittedBy.id, "agent:docs-bot");
  assertEquals(approvalBody.data[0].reviewedBy.id, "human:security-auditor");
  assertEquals(approvalBody.data[0].reviewedBy.kind, "human");
  assertEquals(approvalBody.data[0].note, "Package coordinate reviewed.");
});

Deno.test("CLI self-approval fails; anonymous still sees nothing and catalog stays pending", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approval-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const record = sampleRecord();
  record.maintainers = [{ id: "human:docs-owner", kind: "human" }];
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(record)}\n`);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer", "human:docs-owner", "human"),
    "--input",
    input,
  ], env);
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
  ], env);
  assertEquals(published.code, 0, published.raw || published.stderr);

  const promoted = await runCli([
    "identity",
    "grant",
    "--identities",
    `${dir}/identities.json`,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:docs-owner",
    "--kind",
    "human",
    "--role",
    "auditor",
  ]);
  assertEquals(promoted.code, 0, promoted.raw || promoted.stderr);

  const result = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("auditor", "human:docs-owner", "human"),
    "--id",
    "docs-writer",
  ], env);
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
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);
  await registerAndSubmitPublic(catalog, input, env);

  const result = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--id",
    "docs-writer",
  ], env);
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
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);
  await registerAndSubmitPublic(catalog, input, env);

  const rejected = await runCli([
    "catalog",
    "reject",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
  ], env);
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
  ], env);
  assertEquals(readerGot.code, 0, readerGot.raw || readerGot.stderr);
  const gotBody = readerGot.stdout as {
    ok: boolean;
    data: { governanceState: string };
  };
  assertEquals(gotBody.data.governanceState, "rejected");
});

Deno.test("CLI: a rejected surface can be fixed and resubmitted; the id is not poisoned", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approval-resubmit-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const fix = `${dir}/fix.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);
  await registerAndSubmitPublic(catalog, input, env);

  const rejected = await runCli([
    "catalog",
    "reject",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
  ], env);
  assertEquals(rejected.code, 0, rejected.raw || rejected.stderr);

  // The documented recovery path: fix it, then resubmit for a *fresh*
  // independent review. Leaving `rejected` terminal made this impossible and
  // permanently poisoned the id — `update` said "reject first", and rejecting
  // was the thing that made it uneditable.
  await Deno.writeTextFile(fix, `${JSON.stringify({ description: "Corrected description." })}\n`);
  const updated = await runCli([
    "catalog",
    "update",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--id",
    "docs-writer",
    "--input",
    fix,
  ], env);
  assertEquals(updated.code, 0, updated.raw || updated.stderr);

  const resubmitted = await runCli([
    "catalog",
    "publish",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--id",
    "docs-writer",
    "--visibility",
    "public",
  ], env);
  assertEquals(resubmitted.code, 0, resubmitted.raw || resubmitted.stderr);

  // Still not reachable until a second, independent approval.
  const hidden = await runCli(["catalog", "list", "--catalog", catalog], env);
  assertEquals((hidden.stdout as { data: unknown[] }).data, []);

  const approved = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
  ], env);
  assertEquals(approved.code, 0, approved.raw || approved.stderr);

  const visible = await runCli(["catalog", "list", "--catalog", catalog], env);
  const listed = visible.stdout as { data: Array<{ id: string; description: string }> };
  assertEquals(listed.data.length, 1);
  assertEquals(listed.data[0].description, "Corrected description.");
});

Deno.test("CLI invalid approval note does not write; pending public stays pending", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-approval-note-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await registerAndSubmitPublic(catalog, input, env);
  const before = await Deno.readFile(catalog);

  const tooLong = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
    "--note",
    "x".repeat(501),
  ], env);
  assertEquals(tooLong.code, 1);
  const tooLongBody = tooLong.stdout as { ok: boolean; error: { code: string } };
  assertEquals(tooLongBody.ok, false);
  assertEquals(tooLongBody.error.code, "INVALID_INPUT");

  const control = await runCli([
    "catalog",
    "reject",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
    "--note",
    "line\nbreak",
  ], env);
  assertEquals(control.code, 1);
  const controlBody = control.stdout as { ok: boolean; error: { code: string } };
  assertEquals(controlBody.ok, false);
  assertEquals(controlBody.error.code, "INVALID_INPUT");

  assertEquals(await Deno.readFile(catalog), before);

  const listed = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    ...actor("anonymous", "anonymous", "human"),
  ]);
  assertEquals((listed.stdout as { data: unknown[] }).data, []);
});
