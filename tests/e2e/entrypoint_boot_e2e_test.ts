import { assert, assertEquals } from "../assert.ts";
import { MCP_PERMS } from "../../src/perms.ts";
import { ROOT } from "./harness.ts";
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

const MCP = `${ROOT}src/mcp/main.ts`;
const CLI = `${ROOT}src/cli/main.ts`;

Deno.test("E2E: the shipped MCP entrypoint starts and speaks JSON-RPC 2.0", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-boot-mcp-" });
  const server = await bootEntrypoint<{ url: string }>(MCP, {
    PORTICO_CATALOG_PATH: `${dir}/catalog.json`,
    PORTICO_IDENTITIES_PATH: `${dir}/identities.json`,
    PORTICO_SESSIONS_PATH: `${dir}/sessions.json`,
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
