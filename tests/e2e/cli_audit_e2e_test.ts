import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

interface AuditEvent {
  id: string;
  kind: "catalog" | "grant" | "approval" | "gateway";
  at: string;
  action: string;
  subjectId: string;
  summary: string;
  actor: { id: string; kind: string; role?: string };
}

Deno.test("CLI happy path: auditor sees grants, catalog change, and approval on audit list", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-audit-e2e-" });
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

  const listed = await runCli([
    "audit",
    "list",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const body = listed.stdout as { ok: boolean; data: AuditEvent[] };
  assertEquals(body.ok, true);
  const kinds = body.data.map((item) => item.kind);
  assert(kinds.includes("grant"));
  assert(kinds.includes("catalog"));
  assert(kinds.includes("approval"));
  assertEquals(
    body.data.some((item) => item.action === "register" && item.subjectId === "docs-writer"),
    true,
  );
  assertEquals(
    body.data.some((item) => item.kind === "approval" && item.action === "approved"),
    true,
  );
});

Deno.test("CLI maintainer cannot read audit; catalog and identities stay unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-audit-forbidden-" });
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

  const beforeCatalog = await Deno.readTextFile(catalog);
  const beforeIdentities = await Deno.readTextFile(identities);

  const denied = await runCli([
    "audit",
    "list",
    "--catalog",
    catalog,
    ...actor("maintainer"),
  ], env);
  assertEquals(denied.code, 1, denied.raw || denied.stderr);
  const body = denied.stdout as { ok: boolean; error?: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error?.code, "FORBIDDEN");

  assertEquals(await Deno.readTextFile(catalog), beforeCatalog);
  assertEquals(await Deno.readTextFile(identities), beforeIdentities);
});

Deno.test("CLI failed public register leaves no catalog file; auditor timeline has no catalog event", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-audit-fail-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(
    input,
    `${JSON.stringify({ ...sampleRecord(), visibility: "public" }, null, 2)}\n`,
  );

  const failed = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    input,
  ], env);
  assertEquals(failed.code, 1, failed.raw || failed.stderr);

  let present = true;
  try {
    await Deno.stat(catalog);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assertEquals(present, false);

  const listed = await runCli([
    "audit",
    "list",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const body = listed.stdout as { ok: boolean; data: AuditEvent[] };
  assertEquals(body.data.filter((item) => item.kind === "catalog"), []);
  assert(body.data.some((item) => item.kind === "grant"));
});
