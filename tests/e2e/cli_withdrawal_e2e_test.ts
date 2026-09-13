import { assert, assertEquals } from "../assert.ts";
import { gatewayUrl, listenGateway } from "../../src/gateway/mod.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import { actor, bootstrapRoster, runCli, sampleMcpRecord } from "./harness.ts";

interface JsonBody {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: JsonBody }> {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() as JsonBody };
}

function anon(): string[] {
  return ["--actor-id", "anonymous", "--actor-kind", "human", "--actor-role", "anonymous"];
}

function auditorHeaders(): HeadersInit {
  return {
    "x-portico-actor-id": "human:security-auditor",
    "x-portico-actor-kind": "human",
    "x-portico-actor-role": "auditor",
  };
}

interface Workspace {
  dir: string;
  catalog: string;
  identities: string;
  gatewayAudit: string;
  input: string;
  env: Record<string, string>;
}

async function workspace(): Promise<Workspace> {
  const dir = await Deno.makeTempDir({ prefix: "portico-withdraw-e2e-" });
  const identities = `${dir}/identities.json`;
  const env = await bootstrapRoster(identities);
  const input = `${dir}/record.json`;
  await Deno.writeTextFile(input, `${JSON.stringify(sampleMcpRecord(), null, 2)}\n`);
  return {
    dir,
    catalog: `${dir}/catalog.json`,
    identities,
    gatewayAudit: `${dir}/gateway-audit.json`,
    input,
    env,
  };
}

async function expectOk(
  args: string[],
  env: Record<string, string> = {},
): Promise<JsonBody> {
  const result = await runCli(args, env);
  assertEquals(result.code, 0, result.raw || result.stderr);
  const body = result.stdout as JsonBody;
  assertEquals(body.ok, true, result.raw);
  return body;
}

async function expectCode(
  args: string[],
  code: string,
  env: Record<string, string> = {},
): Promise<JsonBody> {
  const result = await runCli(args, env);
  assert(result.code !== 0, `expected failure but got: ${result.raw}`);
  const body = result.stdout as JsonBody;
  assertEquals(body.ok, false, result.raw);
  assertEquals(body.error?.code, code, result.raw);
  return body;
}

async function approveMcp(ws: Workspace): Promise<void> {
  await expectOk([
    "catalog",
    "register",
    "--catalog",
    ws.catalog,
    ...actor("maintainer"),
    "--input",
    ws.input,
  ], ws.env);
  await expectOk([
    "catalog",
    "publish",
    "--id",
    "docs-mcp",
    "--visibility",
    "public",
    "--catalog",
    ws.catalog,
    ...actor("maintainer"),
  ], ws.env);
  await expectOk([
    "catalog",
    "approve",
    "--id",
    "docs-mcp",
    "--catalog",
    ws.catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], ws.env);
}

async function withPortal(
  ws: Workspace,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const server = listenPortal({
    catalogPath: ws.catalog,
    identitiesPath: ws.identities,
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
  });
  try {
    await fn(portalUrl(server));
  } finally {
    controller.abort();
    await server.finished;
  }
}

async function withGatewayOn(
  ws: Workspace,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const server = listenGateway({
    catalogPath: ws.catalog,
    identitiesPath: ws.identities,
    auditPath: ws.gatewayAudit,
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
  });
  try {
    await fn(gatewayUrl(server));
  } finally {
    controller.abort();
    await server.finished;
  }
}

Deno.test("E2E: withdrawing an approved public surface closes CLI, Portal and Gateway at once", async () => {
  const ws = await workspace();
  await approveMcp(ws);

  const listedBefore = await expectOk([
    "catalog",
    "list",
    "--catalog",
    ws.catalog,
    ...anon(),
  ]);
  const before = listedBefore.data as Array<{ id: string; governanceState: string }>;
  assertEquals(before.length, 1);
  assertEquals(before[0].id, "docs-mcp");
  assertEquals(before[0].governanceState, "approved_public");

  await withPortal(ws, async (base) => {
    const catalog = await fetchJson(`${base}/api/catalog`);
    assertEquals(catalog.status, 200);
    assertEquals((catalog.body.data as Array<{ id: string }>).length, 1);

    const mcp = await fetchJson(`${base}/api/mcp/docs-mcp`);
    assertEquals(mcp.status, 200);

    const withdrawn = await expectOk([
      "catalog",
      "withdraw",
      "--id",
      "docs-mcp",
      "--catalog",
      ws.catalog,
      ...actor("auditor", "human:security-auditor", "human"),
    ], ws.env);
    const record = withdrawn.data as {
      governanceState: string;
      visibility: string;
      publicSubmission?: unknown;
    };
    assertEquals(record.governanceState, "internal");
    assertEquals(record.visibility, "internal");
    assertEquals(record.publicSubmission, undefined);

    const afterCatalog = await fetchJson(`${base}/api/catalog`);
    assertEquals(afterCatalog.status, 200);
    assertEquals(afterCatalog.body.data, []);

    const afterMcpList = await fetchJson(`${base}/api/mcp`);
    assertEquals(afterMcpList.body.data, []);

    const afterMcp = await fetchJson(`${base}/api/mcp/docs-mcp`);
    assertEquals(afterMcp.status, 404);
    assertEquals(afterMcp.body.error?.code, "NOT_FOUND");

    const afterItem = await fetchJson(`${base}/api/catalog/docs-mcp`);
    assertEquals(afterItem.status, 404);

    const audit = await fetchJson(`${base}/api/audit`, { headers: auditorHeaders() });
    assertEquals(audit.status, 200);
    const events = audit.body.data as Array<
      { action: string; actor: { id: string }; subjectId: string }
    >;
    const withdrawal = events.filter((event) => event.action === "withdrawn");
    assertEquals(withdrawal.length, 1);
    assertEquals(withdrawal[0].actor.id, "human:security-auditor");
    assertEquals(withdrawal[0].subjectId, "docs-mcp");
  });

  const anonList = await expectOk([
    "catalog",
    "list",
    "--catalog",
    ws.catalog,
    ...anon(),
  ]);
  assertEquals(anonList.data, []);
  await expectCode(
    [
      "catalog",
      "get",
      "--id",
      "docs-mcp",
      "--catalog",
      ws.catalog,
      ...anon(),
    ],
    "NOT_FOUND",
    ws.env,
  );
  const anonMcp = await expectOk([
    "mcp",
    "list",
    "--catalog",
    ws.catalog,
    ...anon(),
  ]);
  assertEquals(anonMcp.data, []);

  const readerGet = await expectOk([
    "catalog",
    "get",
    "--id",
    "docs-mcp",
    "--catalog",
    ws.catalog,
    ...actor("reader", "human:reader", "human"),
  ], ws.env);
  assertEquals((readerGet.data as { governanceState: string }).governanceState, "internal");

  await withGatewayOn(ws, async (base) => {
    const denied = await fetchJson(`${base}/gateway/mcp/docs-mcp/authorize`, { method: "POST" });
    assertEquals(denied.status, 404);
    assertEquals(denied.body.error?.code, "NOT_FOUND");
    assert(
      !JSON.stringify(denied.body).includes("https://mcp.example.test/servers/docs"),
      "a withdrawn surface must not leak its endpoint to anonymous callers",
    );

    const events = await fetchJson(`${base}/gateway/audit`, { headers: auditorHeaders() });
    const records = events.body.data as Array<{ decision: string; surfaceId: string }>;
    assertEquals(records.length, 1);
    assertEquals(records[0].decision, "denied");
    assertEquals(records[0].surfaceId, "docs-mcp");
  });
});

Deno.test("E2E: only a human auditor may withdraw; refused attempts leave catalog and exposure untouched", async () => {
  const ws = await workspace();
  await approveMcp(ws);

  const snapshot = await Deno.readTextFile(ws.catalog);

  const attempts: Array<[string, string[]]> = [
    ["agent maintainer", actor("maintainer")],
    ["human maintainer", actor("maintainer", "human:docs-owner", "human")],
    ["reader", actor("reader", "human:reader", "human")],
    ["anonymous", anon()],
  ];
  for (const [label, who] of attempts) {
    await expectCode(
      [
        "catalog",
        "withdraw",
        "--id",
        "docs-mcp",
        "--catalog",
        ws.catalog,
        ...who,
      ],
      "FORBIDDEN",
      ws.env,
    );
    assert(label.length > 0);
  }

  await expectCode(
    [
      "catalog",
      "withdraw",
      "--id",
      "ghost-surface",
      "--catalog",
      ws.catalog,
      ...actor("auditor", "human:security-auditor", "human"),
    ],
    "NOT_FOUND",
    ws.env,
  );

  assertEquals(
    await Deno.readTextFile(ws.catalog),
    snapshot,
    "refused withdrawals must not write to the catalog file",
  );

  const stillPublic = await expectOk([
    "catalog",
    "list",
    "--catalog",
    ws.catalog,
    ...anon(),
  ]);
  const listed = stillPublic.data as Array<{ governanceState: string }>;
  assertEquals(listed.length, 1);
  assertEquals(listed[0].governanceState, "approved_public");

  const internalInput = `${ws.dir}/internal.json`;
  await Deno.writeTextFile(
    internalInput,
    `${JSON.stringify({ ...sampleMcpRecord(), id: "internal-mcp" }, null, 2)}\n`,
  );
  await expectOk([
    "catalog",
    "register",
    "--catalog",
    ws.catalog,
    ...actor("maintainer"),
    "--input",
    internalInput,
  ], ws.env);

  const pendingInput = `${ws.dir}/pending.json`;
  await Deno.writeTextFile(
    pendingInput,
    `${JSON.stringify({ ...sampleMcpRecord(), id: "pending-mcp" }, null, 2)}\n`,
  );
  await expectOk([
    "catalog",
    "register",
    "--catalog",
    ws.catalog,
    ...actor("maintainer"),
    "--input",
    pendingInput,
  ], ws.env);
  await expectOk([
    "catalog",
    "publish",
    "--id",
    "pending-mcp",
    "--visibility",
    "public",
    "--catalog",
    ws.catalog,
    ...actor("maintainer"),
  ], ws.env);

  for (const id of ["internal-mcp", "pending-mcp"]) {
    await expectCode(
      [
        "catalog",
        "withdraw",
        "--id",
        id,
        "--catalog",
        ws.catalog,
        ...actor("auditor", "human:security-auditor", "human"),
      ],
      "INVALID_STATE",
      ws.env,
    );
  }

  for (
    const [id, state] of [["internal-mcp", "internal"], ["pending-mcp", "pending_public"]] as const
  ) {
    const got = await expectOk([
      "catalog",
      "get",
      "--id",
      id,
      "--catalog",
      ws.catalog,
      ...actor("maintainer"),
    ], ws.env);
    assertEquals((got.data as { governanceState: string }).governanceState, state);
  }

  const approvals = await expectOk([
    "catalog",
    "approvals",
    "--catalog",
    ws.catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], ws.env);
  assertEquals(
    (approvals.data as Array<{ decision: string }>).map((record) => record.decision),
    ["approved"],
    "a refused withdrawal must not append an approval record",
  );
});

Deno.test("E2E: a withdrawn surface stays internal until a fresh independent approval", async () => {
  const ws = await workspace();
  await approveMcp(ws);

  await expectOk([
    "catalog",
    "withdraw",
    "--id",
    "docs-mcp",
    "--catalog",
    ws.catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], ws.env);

  const closed = await expectOk(["catalog", "list", "--catalog", ws.catalog, ...anon()]);
  assertEquals(closed.data, []);

  const republication = await expectOk([
    "catalog",
    "publish",
    "--id",
    "docs-mcp",
    "--visibility",
    "public",
    "--catalog",
    ws.catalog,
    ...actor("maintainer"),
  ], ws.env);
  assertEquals(
    (republication.data as { governanceState: string }).governanceState,
    "pending_public",
  );

  const stillClosed = await expectOk(["catalog", "list", "--catalog", ws.catalog, ...anon()]);
  assertEquals(stillClosed.data, []);

  await withGatewayOn(ws, async (base) => {
    const denied = await fetchJson(`${base}/gateway/mcp/docs-mcp/authorize`, { method: "POST" });
    assertEquals(denied.status, 404);
  });

  await expectCode(
    [
      "catalog",
      "approve",
      "--id",
      "docs-mcp",
      "--catalog",
      ws.catalog,
      ...actor("maintainer"),
    ],
    "FORBIDDEN",
    ws.env,
  );

  const reopened = await expectOk([
    "catalog",
    "approve",
    "--id",
    "docs-mcp",
    "--catalog",
    ws.catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], ws.env);
  assertEquals((reopened.data as { governanceState: string }).governanceState, "approved_public");

  const open = await expectOk(["catalog", "list", "--catalog", ws.catalog, ...anon()]);
  assertEquals((open.data as Array<{ id: string }>).length, 1);

  const approvals = await expectOk([
    "catalog",
    "approvals",
    "--catalog",
    ws.catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], ws.env);
  assertEquals(
    (approvals.data as Array<{ decision: string }>).map((record) => record.decision),
    ["approved", "withdrawn", "approved"],
    "the withdrawal must stay visible in the approval trail",
  );

  await withGatewayOn(ws, async (base) => {
    const allowed = await fetchJson(`${base}/gateway/mcp/docs-mcp/authorize`, { method: "POST" });
    assertEquals(allowed.status, 200);
    assertEquals(allowed.body.ok, true);
  });
});
