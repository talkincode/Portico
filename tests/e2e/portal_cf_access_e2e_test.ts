import { assert, assertEquals } from "../assert.ts";
import { CfAccessVerifier, parseCfAccessEnv } from "../../src/access/mod.ts";
import { gatewayUrl, listenGateway } from "../../src/gateway/mod.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import { generateRs256, mintJwt } from "../cf_access_helpers.ts";
import {
  actor,
  bootstrapRoster,
  runCli,
  sampleRecord,
  sessionFor,
  sessionsPathFor,
} from "./harness.ts";

const TEAM = "example";
const AUD = "test-audience-tag";
const ISSUER = "https://example.cloudflareaccess.com";
const EMAIL = "reader@example.invalid";

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

function listenJwks(jwks: unknown, signal: AbortSignal): Deno.HttpServer {
  return Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal,
    onListen: () => {},
  }, () =>
    new Response(JSON.stringify(jwks), {
      headers: { "content-type": "application/json" },
    }));
}

function jwksUrl(server: Deno.HttpServer): string {
  const addr = server.addr;
  if (!("hostname" in addr) || !("port" in addr)) {
    throw new Error("jwks server is not a TCP listener");
  }
  return `http://${addr.hostname}:${addr.port}/certs`;
}

Deno.test("E2E: a verified CF Access JWT sees the same Portal catalog as a session and writes nothing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-cf-access-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const sessions = sessionsPathFor(identities);
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

  const granted = await runCli([
    "identity",
    "grant",
    "--identities",
    identities,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:reader",
    "--kind",
    "human",
    "--role",
    "reader",
    "--email",
    EMAIL,
  ], env);
  assertEquals(granted.code, 0, granted.raw || granted.stderr);

  const keys = await generateRs256();
  const jwksController = new AbortController();
  const jwksServer = listenJwks(keys.jwks, jwksController.signal);
  const cf = parseCfAccessEnv({
    PORTICO_CF_ACCESS_ENABLED: "true",
    PORTICO_CF_ACCESS_TEAM: TEAM,
    PORTICO_CF_ACCESS_AUD: AUD,
    PORTICO_CF_ACCESS_JWKS_URL: jwksUrl(jwksServer),
  });
  assertEquals(cf.enabled, true);
  if (!cf.enabled) throw new Error("expected CF Access config");

  const now = Math.floor(Date.now() / 1000);
  const valid = await mintJwt(
    keys.privateKey,
    { alg: "RS256", kid: keys.kid, typ: "JWT" },
    { aud: AUD, iss: ISSUER, exp: now + 600, iat: now - 10, email: "Reader@example.invalid" },
  );
  const expired = await mintJwt(
    keys.privateKey,
    { alg: "RS256", kid: keys.kid, typ: "JWT" },
    { aud: AUD, iss: ISSUER, exp: now - 30, iat: now - 90, email: EMAIL },
  );
  const unknown = await mintJwt(
    keys.privateKey,
    { alg: "RS256", kid: keys.kid, typ: "JWT" },
    { aud: AUD, iss: ISSUER, exp: now + 600, iat: now - 10, email: "nobody@example.invalid" },
  );

  const identitiesBefore = await Deno.readFile(identities);
  const sessionsBefore = await Deno.readFile(sessions);

  const portalController = new AbortController();
  const gatewayController = new AbortController();
  const portal = listenPortal({
    catalogPath: catalog,
    identitiesPath: identities,
    sessionsPath: sessions,
    hostname: "127.0.0.1",
    port: 0,
    signal: portalController.signal,
    cfAccess: new CfAccessVerifier(cf),
  });
  const gateway = listenGateway({
    catalogPath: catalog,
    identitiesPath: identities,
    sessionsPath: sessions,
    auditPath: `${dir}/gateway-audit.json`,
    hostname: "127.0.0.1",
    port: 0,
    signal: gatewayController.signal,
  });

  try {
    const base = portalUrl(portal);
    const viaSession = await fetchJson(`${base}/api/catalog`, {
      headers: { "x-portico-session": sessionFor("human:reader")! },
    });
    const viaJwt = await fetchJson(`${base}/api/catalog`, {
      headers: { "cf-access-jwt-assertion": valid },
    });
    assertEquals(viaJwt.status, 200);
    assertEquals(viaJwt.body.data, viaSession.body.data);
    const records = viaJwt.body.data as Array<{ id: string }>;
    assertEquals(records.length, 1);
    assertEquals(records[0].id, "docs-writer");

    const html = await fetch(`${base}/internal`, {
      headers: { "cf-access-jwt-assertion": valid },
    });
    assertEquals(html.status, 200);
    assert((await html.text()).includes("Docs Writer"));

    const asReaderAudit = await fetchJson(`${base}/api/audit`, {
      headers: { "cf-access-jwt-assertion": valid },
    });
    assertEquals(asReaderAudit.status, 403);
    assertEquals(asReaderAudit.body.error?.code, "FORBIDDEN");

    const forgedHtml = await fetch(`${base}/internal`, {
      headers: {
        "cf-access-jwt-assertion": expired,
        "cf-access-authenticated-user-email": EMAIL,
      },
    });
    assertEquals(forgedHtml.status, 404);
    assert(!(await forgedHtml.text()).includes("Docs Writer"));

    const unknownHtml = await fetch(`${base}/internal`, {
      headers: { "cf-access-jwt-assertion": unknown },
    });
    assertEquals(unknownHtml.status, 404);

    const gatewayJson = await fetchJson(
      `${gatewayUrl(gateway)}/gateway/mcp/docs-writer/authorize`,
      {
        method: "POST",
        headers: { "cf-access-jwt-assertion": valid },
      },
    );
    assertEquals(gatewayJson.status, 404);

    assertEquals(await Deno.readFile(identities), identitiesBefore);
    assertEquals(await Deno.readFile(sessions), sessionsBefore);
  } finally {
    portalController.abort();
    gatewayController.abort();
    jwksController.abort();
    await portal.finished;
    await gateway.finished;
    await jwksServer.finished;
  }
});
