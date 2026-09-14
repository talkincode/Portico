import { assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

Deno.test("CLI happy path: maintainer updates an internal surface; reader sees the same change", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-update-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const registerInput = `${dir}/record.json`;
  const updateInput = `${dir}/update.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(registerInput, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(
    updateInput,
    `${JSON.stringify({ description: "Updated description.", version: "1.1.0" }, null, 2)}\n`,
  );

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    registerInput,
  ], env);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  const updated = await runCli([
    "catalog",
    "update",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--id",
    "docs-writer",
    "--input",
    updateInput,
  ], env);
  assertEquals(updated.code, 0, updated.raw || updated.stderr);
  const updatedBody = updated.stdout as {
    ok: boolean;
    data: { description: string; version: string };
  };
  assertEquals(updatedBody.ok, true);
  assertEquals(updatedBody.data.description, "Updated description.");
  assertEquals(updatedBody.data.version, "1.1.0");

  const seen = await runCli([
    "catalog",
    "get",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--id",
    "docs-writer",
  ], env);
  assertEquals(seen.code, 0, seen.raw || seen.stderr);
  const seenBody = seen.stdout as { ok: boolean; data: { description: string; version: string } };
  assertEquals(seenBody.ok, true);
  assertEquals(seenBody.data.description, "Updated description.");
  assertEquals(seenBody.data.version, "1.1.0");
});

Deno.test("CLI failure path: reader cannot update; catalog and audit stay unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-update-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const registerInput = `${dir}/record.json`;
  const updateInput = `${dir}/update.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(registerInput, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
  await Deno.writeTextFile(updateInput, `${JSON.stringify({ name: "Hijacked" }, null, 2)}\n`);

  const registered = await runCli([
    "catalog",
    "register",
    "--catalog",
    catalog,
    ...actor("maintainer"),
    "--input",
    registerInput,
  ], env);
  assertEquals(registered.code, 0, registered.raw || registered.stderr);

  const denied = await runCli([
    "catalog",
    "update",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--id",
    "docs-writer",
    "--input",
    updateInput,
  ], env);
  assertEquals(denied.code, 1, denied.raw || denied.stderr);
  const deniedBody = denied.stdout as { ok: boolean; error: { code: string } };
  assertEquals(deniedBody.ok, false);
  assertEquals(deniedBody.error.code, "FORBIDDEN");

  const stillThere = await runCli([
    "catalog",
    "get",
    "--catalog",
    catalog,
    ...actor("reader", "human:auditor", "human"),
    "--id",
    "docs-writer",
  ], env);
  const stillBody = stillThere.stdout as { ok: boolean; data: { name: string } };
  assertEquals(stillBody.data.name, "Docs Writer");
});

Deno.test(
  "CLI recovery: update rejected while pending public; withdraw path lets maintainer update and republish",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "portico-update-e2e-" });
    const catalog = `${dir}/catalog.json`;
    const registerInput = `${dir}/record.json`;
    const updateInput = `${dir}/update.json`;
    const env = await bootstrapRoster(`${dir}/identities.json`);
    await Deno.writeTextFile(registerInput, `${JSON.stringify(sampleRecord(), null, 2)}\n`);
    await Deno.writeTextFile(
      updateInput,
      `${JSON.stringify({ name: "Docs Writer Renamed" }, null, 2)}\n`,
    );

    const registered = await runCli([
      "catalog",
      "register",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--input",
      registerInput,
    ], env);
    assertEquals(registered.code, 0, registered.raw || registered.stderr);

    const pending = await runCli([
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
    assertEquals(pending.code, 0, pending.raw || pending.stderr);

    const rejectedUpdate = await runCli([
      "catalog",
      "update",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--id",
      "docs-writer",
      "--input",
      updateInput,
    ], env);
    assertEquals(rejectedUpdate.code, 1, rejectedUpdate.raw || rejectedUpdate.stderr);
    const rejectedBody = rejectedUpdate.stdout as { ok: boolean; error: { code: string } };
    assertEquals(rejectedBody.error.code, "INVALID_STATE");

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

    const anon = ["--actor-id", "anonymous", "--actor-kind", "human", "--actor-role", "anonymous"];
    const publicSeen = await runCli([
      "catalog",
      "get",
      "--catalog",
      catalog,
      ...anon,
      "--id",
      "docs-writer",
    ], env);
    assertEquals((publicSeen.stdout as { data: { name: string } }).data.name, "Docs Writer");

    const stillRejected = await runCli([
      "catalog",
      "update",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--id",
      "docs-writer",
      "--input",
      updateInput,
    ], env);
    assertEquals(
      (stillRejected.stdout as { error: { code: string } }).error.code,
      "INVALID_STATE",
    );

    const withdrawn = await runCli([
      "catalog",
      "withdraw",
      "--catalog",
      catalog,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-writer",
    ], env);
    assertEquals(withdrawn.code, 0, withdrawn.raw || withdrawn.stderr);

    const updated = await runCli([
      "catalog",
      "update",
      "--catalog",
      catalog,
      ...actor("maintainer"),
      "--id",
      "docs-writer",
      "--input",
      updateInput,
    ], env);
    assertEquals(updated.code, 0, updated.raw || updated.stderr);
    assertEquals(
      (updated.stdout as { data: { name: string } }).data.name,
      "Docs Writer Renamed",
    );

    const noLongerPublic = await runCli([
      "catalog",
      "get",
      "--catalog",
      catalog,
      ...anon,
      "--id",
      "docs-writer",
    ], env);
    assertEquals(noLongerPublic.code, 1, noLongerPublic.raw || noLongerPublic.stderr);
    assertEquals(
      (noLongerPublic.stdout as { error: { code: string } }).error.code,
      "NOT_FOUND",
    );

    const republished = await runCli([
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
    assertEquals(republished.code, 0, republished.raw || republished.stderr);

    const reapproved = await runCli([
      "catalog",
      "approve",
      "--catalog",
      catalog,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "docs-writer",
    ], env);
    assertEquals(reapproved.code, 0, reapproved.raw || reapproved.stderr);

    const finalPublic = await runCli([
      "catalog",
      "get",
      "--catalog",
      catalog,
      ...anon,
      "--id",
      "docs-writer",
    ], env);
    assertEquals(finalPublic.code, 0, finalPublic.raw || finalPublic.stderr);
    assertEquals(
      (finalPublic.stdout as { data: { name: string } }).data.name,
      "Docs Writer Renamed",
    );
  },
);
