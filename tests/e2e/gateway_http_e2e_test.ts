import { assert, assertEquals } from "../assert.ts";
import { gatewayUrl, listenGateway } from "../../src/gateway/mod.ts";
import {
  actor,
  bootstrapRoster,
  runCli,
  sampleMcpRecord,
  sessionFor,
  sessionsPathFor,
} from "./harness.ts";

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

function readerHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${sessionFor("human:reader")!}`,
  };
}

function auditorHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${sessionFor("human:security-auditor")!}`,
  };
}

async function withGateway(
  catalog: string,
  identities: string,
  audit: string,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const server = listenGateway({
    catalogPath: catalog,
    identitiesPath: identities,
    sessionsPath: sessionsPathFor(identities),
    auditPath: audit,
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

Deno.test("E2E: CLI-registered MCP authorizes on Gateway HTTP with the same direct route", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-gateway-http-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const audit = `${dir}/gateway-audit.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
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

  await withGateway(catalog, identities, audit, async (base) => {
    const authorized = await fetchJson(`${base}/gateway/mcp/docs-mcp/authorize`, {
      method: "POST",
      headers: readerHeaders(),
    });
    assertEquals(authorized.status, 200);
    assertEquals(authorized.body.ok, true);
    const route = authorized.body.data as {
      surfaceId: string;
      endpoint: { value: string };
      connect: { mode: string };
    };
    assertEquals(route.surfaceId, "docs-mcp");
    assertEquals(route.endpoint.value, "https://mcp.example.test/servers/docs");
    assertEquals(route.connect.mode, "direct");

    const events = await fetchJson(`${base}/gateway/audit`, { headers: auditorHeaders() });
    assertEquals(events.status, 200);
    const records = events.body.data as Array<{ decision: string; surfaceId: string }>;
    assertEquals(records.length, 1);
    assertEquals(records[0].decision, "allowed");
    assertEquals(records[0].surfaceId, "docs-mcp");

    const anon = await fetchJson(`${base}/gateway/mcp/docs-mcp/authorize`, { method: "POST" });
    assertEquals(anon.status, 404);
    assertEquals(anon.body.error?.code, "NOT_FOUND");
    assert(
      !JSON.stringify(anon.body).includes("https://mcp.example.test/servers/docs"),
      "anonymous HTTP authorize must not leak the endpoint",
    );
  });
});

Deno.test("E2E: Gateway HTTP tool call is refused and does not dirty the catalog file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-gateway-http-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const audit = `${dir}/gateway-audit.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
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

  await withGateway(catalog, identities, audit, async (base) => {
    const refused = await fetchJson(`${base}/gateway/mcp/docs-mcp`, {
      method: "POST",
      headers: { ...readerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search" },
      }),
    });
    assertEquals(refused.status, 405);
    assertEquals(refused.body.error?.code, "USAGE");
    assert(
      refused.body.error?.message.includes("does not execute"),
      "HTTP refusal must say the gateway does not execute tools",
    );
  });

  assertEquals(await Deno.readTextFile(catalog), before);
});
