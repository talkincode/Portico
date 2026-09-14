import { assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

/**
 * Identity is proven, not claimed.
 *
 * These tests used to show a caller *asserting* a role and being checked
 * against the roster. That is not proof: the roster ids are published in the
 * README, so an agent maintainer could type `human:security-auditor` and
 * approve its own public submission. Now every non-anonymous command runs on a
 * login session, and `--actor-*` on its own is refused outright.
 */

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
    ...actor("maintainer", "agent:docs-bot"),
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

Deno.test("CLI refuses a claimed auditor outright; catalog and approvals stay untouched", async () => {
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
    ...actor("maintainer", "agent:docs-bot"),
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
    ...actor("maintainer", "agent:docs-bot"),
    "--id",
    "docs-writer",
    "--visibility",
    "public",
  ]);
  assertEquals(published.code, 0, published.raw || published.stderr);

  // The exact string an agent would copy out of the README, with no session.
  const claimed = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    "--identities",
    identities,
    "--actor-id",
    "human:security-auditor",
    "--actor-kind",
    "human",
    "--actor-role",
    "auditor",
    "--id",
    "docs-writer",
  ]);
  assertEquals(claimed.code, 1);
  const body = claimed.stdout as { ok: boolean; error: { code: string; message: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "USAGE");

  const file = JSON.parse(await Deno.readTextFile(catalog)) as {
    records: Array<{ governanceState: string }>;
    approvals?: unknown[];
  };
  assertEquals(file.records[0].governanceState, "pending_public");
  assertEquals(file.approvals ?? [], []);
});

Deno.test("CLI maintainer session cannot approve; only an auditor session can", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-access-e2e-" });
  const identities = `${dir}/identities.json`;
  const catalog = `${dir}/catalog.json`;
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);
  await bootstrapRoster(identities);

  for (
    const args of [
      ["catalog", "register", "--input", input],
      ["catalog", "publish", "--id", "docs-writer", "--visibility", "public"],
    ]
  ) {
    const result = await runCli([
      ...args,
      "--catalog",
      catalog,
      "--identities",
      identities,
      ...actor("maintainer", "agent:docs-bot"),
    ]);
    assertEquals(result.code, 0, result.raw || result.stderr);
  }

  const refused = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("maintainer", "agent:docs-bot"),
    "--id",
    "docs-writer",
  ]);
  assertEquals(refused.code, 1);
  const body = refused.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.error.code, "FORBIDDEN");

  const allowed = await runCli([
    "catalog",
    "approve",
    "--catalog",
    catalog,
    "--identities",
    identities,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "docs-writer",
  ]);
  assertEquals(allowed.code, 0, allowed.raw || allowed.stderr);
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
    ...actor("maintainer", "agent:docs-bot"),
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

Deno.test("CLI anonymous cannot register; catalog file is absent", async () => {
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
