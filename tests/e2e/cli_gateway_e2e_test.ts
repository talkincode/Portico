import { assert, assertEquals } from "../assert.ts";
import { actor, bootstrapRoster, runCli, sampleMcpRecord } from "./harness.ts";

Deno.test("CLI happy path: reader authorizes MCP; auditor sees the same direct route in audit", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-gateway-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const audit = `${dir}/gateway-audit.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(`${dir}/identities.json`);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleMcpRecord(), null, 2)}\n`);

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

  const authorized = await runCli([
    "gateway",
    "authorize",
    "--id",
    "docs-mcp",
    "--catalog",
    catalog,
    "--audit",
    audit,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(authorized.code, 0, authorized.raw || authorized.stderr);
  const route = authorized.stdout as {
    ok: boolean;
    data: {
      id: string;
      surfaceId: string;
      name: string;
      endpoint: { kind: string; value: string };
      connect: { mode: string };
    };
  };
  assertEquals(route.ok, true);
  assertEquals(route.data.surfaceId, "docs-mcp");
  assertEquals(route.data.name, "Docs MCP");
  assertEquals(route.data.endpoint.value, "https://mcp.example.test/servers/docs");
  assertEquals(route.data.connect.mode, "direct");

  const described = await runCli([
    "mcp",
    "describe",
    "--id",
    "docs-mcp",
    "--catalog",
    catalog,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(described.code, 0, described.raw || described.stderr);
  const describedBody = described.stdout as {
    ok: boolean;
    data: { endpoint: { value: string }; connect: { mode: string } };
  };
  assertEquals(describedBody.data.endpoint.value, route.data.endpoint.value);
  assertEquals(describedBody.data.connect.mode, "direct");

  const listed = await runCli([
    "gateway",
    "audit",
    "--audit",
    audit,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const auditBody = listed.stdout as {
    ok: boolean;
    data: Array<{
      id: string;
      surfaceId: string;
      decision: string;
      endpoint?: { value: string };
    }>;
  };
  assertEquals(auditBody.ok, true);
  assertEquals(auditBody.data.length, 1);
  assertEquals(auditBody.data[0].id, route.data.id);
  assertEquals(auditBody.data[0].surfaceId, "docs-mcp");
  assertEquals(auditBody.data[0].decision, "allowed");
  assertEquals(auditBody.data[0].endpoint?.value, route.data.endpoint.value);
});

Deno.test("CLI anonymous authorize of internal MCP fails; catalog unchanged; denied audit has no endpoint", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-gateway-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const audit = `${dir}/gateway-audit.json`;
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
  const before = await Deno.readTextFile(catalog);

  const denied = await runCli([
    "gateway",
    "authorize",
    "--id",
    "docs-mcp",
    "--catalog",
    catalog,
    "--audit",
    audit,
    "--actor-id",
    "anonymous",
    "--actor-kind",
    "human",
    "--actor-role",
    "anonymous",
  ]);
  assertEquals(denied.code, 1);
  const body = denied.stdout as { ok: boolean; error: { code: string; message: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "NOT_FOUND");
  assert(
    !JSON.stringify(body).includes("https://mcp.example.test/servers/docs"),
    "denied CLI authorize must not leak the endpoint",
  );
  assertEquals(await Deno.readTextFile(catalog), before);

  const listed = await runCli([
    "gateway",
    "audit",
    "--audit",
    audit,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(listed.code, 0, listed.raw || listed.stderr);
  const auditBody = listed.stdout as {
    ok: boolean;
    data: Array<{ decision: string; endpoint?: unknown }>;
  };
  assertEquals(auditBody.data.length, 1);
  assertEquals(auditBody.data[0].decision, "denied");
  assertEquals(auditBody.data[0].endpoint, undefined);
});

Deno.test("CLI maintainer cannot read gateway audit; audit file is unchanged", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-gateway-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const audit = `${dir}/gateway-audit.json`;
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

  const authorized = await runCli([
    "gateway",
    "authorize",
    "--id",
    "docs-mcp",
    "--catalog",
    catalog,
    "--audit",
    audit,
    ...actor("reader", "human:reader", "human"),
  ], env);
  assertEquals(authorized.code, 0, authorized.raw || authorized.stderr);
  const before = await Deno.readTextFile(audit);

  const forbidden = await runCli([
    "gateway",
    "audit",
    "--audit",
    audit,
    ...actor("maintainer"),
  ], env);
  assertEquals(forbidden.code, 1);
  const body = forbidden.stdout as { ok: boolean; error: { code: string } };
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "FORBIDDEN");
  assertEquals(await Deno.readTextFile(audit), before);
});

Deno.test("CLI pending public MCP stays unauthorized for anonymous until independent approve", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-gateway-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const audit = `${dir}/gateway-audit.json`;
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

  const published = await runCli([
    "catalog",
    "publish",
    "--id",
    "docs-mcp",
    "--visibility",
    "public",
    "--catalog",
    catalog,
    ...actor("maintainer"),
  ], env);
  assertEquals(published.code, 0, published.raw || published.stderr);

  const pending = await runCli([
    "gateway",
    "authorize",
    "--id",
    "docs-mcp",
    "--catalog",
    catalog,
    "--audit",
    audit,
    "--actor-id",
    "anonymous",
    "--actor-kind",
    "human",
    "--actor-role",
    "anonymous",
  ]);
  assertEquals(pending.code, 1);
  const pendingBody = pending.stdout as { ok: boolean; error: { code: string } };
  assertEquals(pendingBody.error.code, "NOT_FOUND");

  const approved = await runCli([
    "catalog",
    "approve",
    "--id",
    "docs-mcp",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(approved.code, 0, approved.raw || approved.stderr);

  const allowed = await runCli([
    "gateway",
    "authorize",
    "--id",
    "docs-mcp",
    "--catalog",
    catalog,
    "--audit",
    audit,
    "--actor-id",
    "anonymous",
    "--actor-kind",
    "human",
    "--actor-role",
    "anonymous",
  ]);
  assertEquals(allowed.code, 0, allowed.raw || allowed.stderr);
  const route = allowed.stdout as {
    ok: boolean;
    data: { surfaceId: string; connect: { mode: string }; endpoint: { value: string } };
  };
  assertEquals(route.data.surfaceId, "docs-mcp");
  assertEquals(route.data.connect.mode, "direct");
  assertEquals(route.data.endpoint.value, "https://mcp.example.test/servers/docs");
});
