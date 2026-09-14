import { assert } from "../assert.ts";
import { GATEWAY_PERMS, PORTAL_PERMS } from "../../src/perms.ts";
import { ROOT } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * The shipped entrypoints must be runnable as processes and must announce a
 * loopback URL without touching an uninitialised `server` binding. These tests
 * exist because `src/gateway/main.ts` once read `server` from inside
 * `onListen` — the temporal dead zone killed it before it ever listened, while
 * every gateway test passed, because none of them executed the entrypoint.
 *
 * The spawn/announce plumbing lives in `process.ts` so this file and
 * `entrypoint_boot_e2e_test.ts` cannot drift apart.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;
const GATEWAY = `${ROOT}src/gateway/main.ts`;

Deno.test("E2E: portal main listens on loopback without touching server before init", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-portal-main-" });
  const server = await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: `${dir}/catalog.json`,
    PORTICO_IDENTITIES_PATH: `${dir}/identities.json`,
    PORTICO_SESSIONS_PATH: `${dir}/sessions.json`,
  }, PORTAL_PERMS);
  try {
    assert(server.body.data.url.startsWith("http://127.0.0.1:"), server.body.data.url);
  } finally {
    await server.stop();
  }
});

Deno.test("E2E: gateway main listens on loopback without touching server before init", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-gateway-main-" });
  const server = await bootEntrypoint<{ url: string }>(GATEWAY, {
    PORTICO_CATALOG_PATH: `${dir}/catalog.json`,
    PORTICO_IDENTITIES_PATH: `${dir}/identities.json`,
    PORTICO_SESSIONS_PATH: `${dir}/sessions.json`,
    PORTICO_GATEWAY_AUDIT_PATH: `${dir}/gateway-audit.json`,
  }, GATEWAY_PERMS);
  try {
    assert(server.body.data.url.startsWith("http://127.0.0.1:"), server.body.data.url);
  } finally {
    await server.stop();
  }
});
