import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleMcpRecord } from "./harness.ts";

async function workspace() {
  const dir = await Deno.makeTempDir({ prefix: "portico-trash-e2e-" });
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
  const env = await bootstrapRoster(identities, sessions);
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleMcpRecord(), null, 2)}\n`);
  return { dir, catalog: `${dir}/catalog.json`, identities, sessions, input, env };
}

async function ok(args: string[], env: Record<string, string>) {
  const result = await runCli(args, env);
  assertEquals(result.code, 0, result.raw || result.stderr);
  const body = result.stdout as { ok: boolean; data?: unknown };
  assertEquals(body.ok, true, result.raw);
  return body.data;
}

async function fails(args: string[], code: string, env: Record<string, string>) {
  const result = await runCli(args, env);
  assert(result.code !== 0, `expected failure but got: ${result.raw}`);
  const body = result.stdout as { ok: boolean; error?: { code: string } };
  assertEquals(body.ok, false, result.raw);
  assertEquals(body.error?.code, code, result.raw);
}

function baseArgs(ws: { catalog: string; identities: string; sessions: string }, extra: string[]) {
  return [
    ...extra,
    "--catalog",
    ws.catalog,
    "--identities",
    ws.identities,
    "--sessions",
    ws.sessions,
  ];
}

Deno.test("E2E: delete trashes, restore revives, purge destroys; the trail keeps all three", async () => {
  const ws = await workspace();
  const maintainer = actor("maintainer");
  const auditor = actor("auditor", "human:security-auditor", "human");
  await ok(baseArgs(ws, ["catalog", "register", ...maintainer, "--input", ws.input]), ws.env);

  // Delete is soft: the record leaves live reads but waits in the trash.
  await ok(baseArgs(ws, ["catalog", "remove", ...maintainer, "--id", "docs-mcp"]), ws.env);
  assertEquals(await ok(baseArgs(ws, ["catalog", "list", ...maintainer]), ws.env), []);
  const trashed = await ok(baseArgs(ws, ["catalog", "trash", ...maintainer]), ws.env) as Array<{
    record: { id: string };
    previousState: string;
  }>;
  assertEquals(trashed.length, 1);
  assertEquals(trashed[0].record.id, "docs-mcp");
  assertEquals(trashed[0].previousState, "internal");

  // A public candidate cannot be deleted; reject it first, then delete.
  // (This record is internal, so restore revives it directly.)
  const restored = await ok(
    baseArgs(ws, ["catalog", "restore", ...maintainer, "--id", "docs-mcp"]),
    ws.env,
  ) as {
    governanceState: string;
  };
  assertEquals(restored.governanceState, "internal");

  // Purge is auditor-only and permanent.
  await ok(baseArgs(ws, ["catalog", "remove", ...maintainer, "--id", "docs-mcp"]), ws.env);
  await fails(
    baseArgs(ws, ["catalog", "purge", ...maintainer, "--id", "docs-mcp"]),
    "FORBIDDEN",
    ws.env,
  );
  await ok(baseArgs(ws, ["catalog", "purge", ...auditor, "--id", "docs-mcp"]), ws.env);
  assertEquals(await ok(baseArgs(ws, ["catalog", "trash", ...auditor]), ws.env), []);

  const trail = await ok(
    baseArgs(ws, ["audit", "list", ...actor("auditor", "human:security-auditor", "human")]),
    ws.env,
  ) as Array<{ kind: string; action: string; subjectId: string }>;
  assertEquals(
    trail
      .filter((item) => item.kind === "catalog" && item.subjectId === "docs-mcp")
      .map((item) => item.action),
    ["register", "remove", "restore", "remove", "purge"],
  );
});
