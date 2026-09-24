import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS, portalPerms, readOnlyHttpPerms } from "../../src/perms.ts";
import { actor, bootstrapRoster, ROOT, runCli } from "./harness.ts";
import { bootEntrypoint, JsonBody } from "./process.ts";

/**
 * Process-level smoke tests for the shipped entrypoints.
 *
 * Every other Portal/Gateway test in this suite imports `listenPortal` /
 * `listenGateway` and calls them directly. That covers the routing logic but
 * never covers the thing a user actually runs: the process, its env parsing,
 * its bind policy, and its startup announcement. `src/gateway/main.ts` shipped
 * unable to start at all while 275 tests were green, because none of them ever
 * executed it. These tests are the guard against that class of regression.
 *
 * The permission sets are imported from `src/perms.ts`, so these tests also
 * assert that the Portal genuinely boots without write access.
 */

const GATEWAY = `${ROOT}src/gateway/main.ts`;
const MCP = `${ROOT}src/mcp/main.ts`;
const CLI = `${ROOT}src/cli/main.ts`;
const PORTAL = `${ROOT}src/portal/main.ts`;

Deno.test("E2E: the Gateway audits a denial under a file-scoped write grant", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-boot-scoped-" });
  const audit = `${dir}/gateway-audit.json`;
  // The deployed scripts grant write access to exactly these two paths — not to
  // the directory that contains them. An implementation that unconditionally
  // `mkdir`s the parent dies here with `Requires write access to "<dir>"`,
  // which surfaced in production as a 500 on the deny path instead of a 404.
  const scoped = [
    `--allow-read=${dir}`,
    `--allow-write=${audit},${audit}.tmp`,
    "--allow-env",
    "--allow-net=127.0.0.1",
  ];
  const server = await bootEntrypoint<{ url: string }>(GATEWAY, {
    PORTICO_CATALOG_PATH: `${dir}/catalog.json`,
    PORTICO_IDENTITIES_PATH: `${dir}/identities.json`,
    PORTICO_GATEWAY_AUDIT_PATH: audit,
    PORTICO_PORT: "0",
  }, scoped);
  try {
    const denied = await fetch(
      `${server.body.data.url}/gateway/mcp/missing-surface/authorize`,
      { method: "POST" },
    );
    assertEquals(denied.status, 404, "a denied authorize must not surface as 500");
    const body = await denied.json() as JsonBody;
    assertEquals(body.error?.code, "NOT_FOUND");

    // A denial that cannot be audited is itself a governance failure.
    const written = JSON.parse(await Deno.readTextFile(audit)) as {
      records: Array<{ decision: string; reason: string }>;
    };
    assert(
      written.records.some((record) => record.decision === "denied"),
      "the denial must be appended to the audit file",
    );
  } finally {
    await server.stop();
  }
});

Deno.test("E2E: the shipped MCP entrypoint starts and speaks JSON-RPC 2.0", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-boot-mcp-" });
  const server = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: `${dir}/catalog.json`,
    PORTICO_IDENTITIES_PATH: `${dir}/identities.json`,
    PORTICO_SESSIONS_PATH: `${dir}/sessions.json`,
    PORTICO_PORT: "0",
  }, MCP_PERMS);
  try {
    const { url } = server.body.data;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", clientInfo: { name: "boot", version: "1" } },
      }),
    });
    assertEquals(response.status, 200);
    const body = await response.json() as {
      result?: { serverInfo?: { name: string }; capabilities?: { tools?: unknown } };
    };
    assertEquals(body.result?.serverInfo?.name, "portico");
    assert(body.result?.capabilities?.tools, "the server must advertise tools");

    // GET is not a JSON-RPC transport here.
    const get = await fetch(url);
    assertEquals(get.status, 405);
  } finally {
    await server.stop();
  }
});

Deno.test("the first documented CLI command works on an empty checkout", async () => {
  // `data/` is gitignored, so a fresh clone has no such directory. The first
  // README command writes into it and used to die with a raw OS error.
  const dir = await Deno.makeTempDir({ prefix: "portico-boot-fresh-" });
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      CLI,
      "identity",
      "grant",
      "--identities",
      `${dir}/data/identities.json`,
      "--id",
      "human:security-auditor",
      "--kind",
      "human",
      "--role",
      "auditor",
    ],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const body = JSON.parse(new TextDecoder().decode(output.stdout).trim()) as JsonBody;
  assertEquals(output.code, 0);
  assertEquals(body.ok, true);
});

/**
 * Browser login is a write, and only the deployment knows whether this process
 * has it.
 *
 * `POST /login` mints a row in the session store. When the Portal ran without
 * that one scoped grant — every deployment without GitHub OAuth before
 * `portalPerms` stopped gating it, and the read-only container in
 * `deploy/run-portal.sh` — the write was denied and the reader got `403
 * 登录失败`: indistinguishable from a wrong credential, and the only documented
 * way into `/internal` from a browser was dead. These two runs pin both sides:
 * the grant makes login work, and its absence is stated instead of disguised.
 */
Deno.test("E2E: the Portal's session grant makes browser login work, and its absence is stated", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-boot-login-" });
  const catalog = `${dir}/catalog.json`;
  const identities = `${dir}/identities.json`;
  const sessions = `${dir}/sessions.json`;
  await bootstrapRoster(identities, sessions);

  // A credential the browser can present, issued by the auditor's own session.
  const issued = await runCli([
    "identity",
    "credential",
    "issue",
    "--identities",
    identities,
    "--sessions",
    sessions,
    ...actor("auditor", "human:security-auditor", "human"),
    "--id",
    "human:security-auditor",
  ]);
  assertEquals(issued.code, 0, issued.raw || issued.stderr);
  const token = (issued.stdout as { data: { token: string } }).data.token;

  const env = {
    PORTICO_CATALOG_PATH: catalog,
    PORTICO_IDENTITIES_PATH: identities,
    PORTICO_SESSIONS_PATH: sessions,
    PORTICO_PORT: "0",
  };
  // `redirect: "manual"`: the answer under test is the 303 and its Set-Cookie,
  // and following it would fetch /internal without a cookie jar and land on the
  // login page instead — a 200 that hides whether the login worked.
  const form = (url: string) =>
    fetch(`${url}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id: "human:security-auditor", token }),
    });

  // 1. Without the grant: no form that cannot work, and the refusal names why.
  const readOnly = await bootEntrypoint<{ url: string }>(PORTAL, env, readOnlyHttpPerms());
  try {
    const { url } = readOnly.body.data;
    const page = await (await fetch(`${url}/login`)).text();
    assert(
      page.includes('data-login="unavailable"'),
      "a deployment that cannot mint a session must say so on the login page",
    );
    assert(
      !page.includes('action="/login"'),
      "a login form that cannot succeed must not be rendered",
    );
    const refused = await form(url);
    assertEquals(refused.status, 403);
    assert(
      (await refused.text()).includes("写权限"),
      "the refusal must name the missing permission, not blame the credential",
    );
  } finally {
    await readOnly.stop();
  }

  // 2. With the scoped grant `up` now hands the Portal: a real session cookie.
  const writable = await bootEntrypoint<{ url: string }>(
    PORTAL,
    env,
    portalPerms("127.0.0.1", false, { sessions }),
  );
  try {
    const accepted = await form(writable.body.data.url);
    assertEquals(
      accepted.status,
      303,
      `the documented browser login must succeed: ${accepted.status} ${await accepted.clone()
        .text()}`,
    );
    assertEquals(accepted.headers.get("location"), "/internal");
    assert(
      accepted.headers.get("set-cookie")?.includes("portico_session="),
      "a successful login must set the session cookie",
    );
  } finally {
    await writable.stop();
  }
});
