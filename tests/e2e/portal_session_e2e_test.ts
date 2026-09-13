import { assert, assertEquals } from "../assert.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import { actor, bootstrapRoster, runCli, sampleRecord } from "./harness.ts";

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

async function withPortal(
  catalog: string,
  identities: string,
  sessions: string,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const server = listenPortal({
    catalogPath: catalog,
    identitiesPath: identities,
    sessionsPath: sessions,
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

Deno.test("E2E: CLI login session is visible on Portal Bearer and hidden from anonymous", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-session-e2e-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
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

  const issued = await runCli([
    "identity",
    "credential",
    "issue",
    "--sessions",
    sessions,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:reader",
  ], env);
  assertEquals(issued.code, 0, issued.raw || issued.stderr);
  const login = await runCli([
    "identity",
    "login",
    "--sessions",
    sessions,
    "--id",
    "human:reader",
    "--token",
    (issued.stdout as { data: { token: string } }).data.token,
  ], env);
  assertEquals(login.code, 0, login.raw || login.stderr);
  const sessionToken = (login.stdout as { data: { token: string } }).data.token;

  const cliList = await runCli([
    "catalog",
    "list",
    "--catalog",
    catalog,
    "--session",
    sessionToken,
    "--sessions",
    sessions,
  ], env);
  assertEquals(cliList.code, 0, cliList.raw || cliList.stderr);
  const cliBody = cliList.stdout as { data: Array<{ id: string; name: string }> };

  await withPortal(catalog, identities, sessions, async (base) => {
    const portalList = await fetchJson(`${base}/api/catalog`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    assertEquals(portalList.status, 200);
    assertEquals(portalList.body.ok, true);
    const data = portalList.body.data as Array<{ id: string; name: string }>;
    assertEquals(data.length, 1);
    assertEquals(data[0].id, cliBody.data[0].id);
    assertEquals(data[0].name, cliBody.data[0].name);

    const html = await fetch(`${base}/`, {
      headers: { "x-portico-session": sessionToken },
    });
    assertEquals(html.status, 200);
    assert((await html.text()).includes("Docs Writer"));

    const anon = await fetchJson(`${base}/api/catalog`);
    assertEquals(anon.status, 200);
    assertEquals(anon.body.data, []);

    const forged = await fetchJson(`${base}/api/catalog`, {
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "x-portico-actor-id": "human:reader",
        "x-portico-actor-kind": "human",
        "x-portico-actor-role": "auditor",
      },
    });
    assertEquals(forged.status, 403);
    assertEquals(forged.body.error?.code, "FORBIDDEN");

    const invalid = await fetchJson(`${base}/api/catalog`, {
      headers: { authorization: "Bearer pst1_nope" },
    });
    assertEquals(invalid.status, 403);
    assertEquals(invalid.body.error?.code, "FORBIDDEN");

    const posted = await fetchJson(`${base}/api/catalog`, {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    assertEquals(posted.status, 405);
  });
});
