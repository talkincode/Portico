import { assert, assertEquals } from "../assert.ts";
import { gatewayUrl, listenGateway } from "../../src/gateway/mod.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import {
  actor,
  bootstrapRoster,
  runCli,
  sampleRecord,
  sessionFor,
  sessionsPathFor,
} from "./harness.ts";

interface JsonBody {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

interface AuditEvent {
  kind: string;
  action: string;
  subjectId: string;
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: JsonBody }> {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() as JsonBody };
}

function auditorHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${sessionFor("human:security-auditor")!}`,
  };
}

function readerHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${sessionFor("human:reader")!}`,
  };
}

async function withPortal(
  catalog: string,
  identities: string,
  fn: (base: string) => Promise<void>,
  gatewayAudit?: string,
): Promise<void> {
  const controller = new AbortController();
  const server = listenPortal({
    catalogPath: catalog,
    identitiesPath: identities,
    sessionsPath: sessionsPathFor(identities),
    gatewayAuditPath: gatewayAudit,
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

Deno.test("E2E: CLI register is the same catalog audit event on Portal for an auditor", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-audit-e2e-" });
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

  const cliList = await runCli([
    "audit",
    "list",
    "--catalog",
    catalog,
    ...actor("auditor", "human:security-auditor", "human"),
  ], env);
  assertEquals(cliList.code, 0, cliList.raw || cliList.stderr);
  const cliBody = cliList.stdout as { ok: boolean; data: AuditEvent[] };

  await withPortal(catalog, identities, async (base) => {
    const portalList = await fetchJson(`${base}/api/audit`, { headers: auditorHeaders() });
    assertEquals(portalList.status, 200);
    assertEquals(portalList.body.ok, true);
    assertEquals(portalList.body.data, cliBody.data);

    const asReader = await fetchJson(`${base}/api/audit`, { headers: readerHeaders() });
    assertEquals(asReader.status, 403);
    assertEquals(asReader.body.ok, false);
    assertEquals(asReader.body.error?.code, "FORBIDDEN");

    const asAnonymous = await fetchJson(`${base}/api/audit`);
    assertEquals(asAnonymous.status, 403);
    assertEquals(asAnonymous.body.error?.code, "FORBIDDEN");
  });
});

Deno.test("E2E: Portal audit writes are rejected and do not dirty catalog or identities", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-audit-write-" });
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

  await withPortal(catalog, identities, async (base) => {
    const posted = await fetchJson(`${base}/api/audit`, {
      method: "POST",
      headers: auditorHeaders(),
      body: JSON.stringify({ conclusion: "rewrite" }),
    });
    assertEquals(posted.status, 405);
    assertEquals(posted.body.ok, false);
  });

  assertEquals(await Deno.readTextFile(catalog), beforeCatalog);
  assertEquals(await Deno.readTextFile(identities), beforeIdentities);
  assert(beforeCatalog.includes("docs-writer"));
});

Deno.test("E2E: the Portal auditor timeline merges Gateway access events", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-gateway-audit-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const gatewayAudit = `${dir}/gateway-audit.json`;
  const input = `${dir}/record.json`;
  const env = await bootstrapRoster(identities);
  await Deno.writeTextFile(input, `${JSON.stringify(sampleRecord())}\n`);

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

  // Produce one denied Gateway access event.
  const controller = new AbortController();
  const gateway = listenGateway({
    catalogPath: catalog,
    identitiesPath: identities,
    auditPath: gatewayAudit,
    sessionsPath: sessionsPathFor(identities),
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
  });
  const denied = await fetch(`${gatewayUrl(gateway)}/gateway/mcp/no-such-surface/authorize`, {
    method: "POST",
  });
  assertEquals(denied.status, 404);
  controller.abort();
  await gateway.finished;

  // `audit list --audit` merges it; the Portal must not show a smaller trail.
  await withPortal(catalog, identities, async (base) => {
    const response = await fetchJson(`${base}/api/audit`, { headers: auditorHeaders() });
    assertEquals(response.status, 200);
    const events = response.body.data as AuditEvent[];
    assert(
      events.some((event) => event.kind === "gateway"),
      `the Gateway access event must appear on the Portal; got ${
        JSON.stringify(events.map((event) => event.kind))
      }`,
    );
    assert(events.some((event) => event.kind === "catalog"));
  }, gatewayAudit);
});
