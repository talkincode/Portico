import { assert } from "../assert.ts";
import { PORTAL_PERMS } from "../../src/perms.ts";
import { ROOT } from "./harness.ts";
import { bootEntrypoint } from "./process.ts";

/**
 * The declaration has to survive the process boundary: an operator sets
 * `PORTICO_REVIEW_ORIGIN` in the deployment, and the served HTML must agree
 * with it. Unit tests cover the parser; only booting `src/portal/main.ts`
 * covers the env plumbing that actually decides what a deployment publishes.
 */

const PORTAL = `${ROOT}src/portal/main.ts`;

async function bootPortal(env: Record<string, string>) {
  const dir = await Deno.makeTempDir({ prefix: "portico-review-entry-" });
  return await bootEntrypoint<{ url: string }>(PORTAL, {
    PORTICO_CATALOG_PATH: `${dir}/catalog.json`,
    PORTICO_IDENTITIES_PATH: `${dir}/identities.json`,
    ...env,
  }, PORTAL_PERMS);
}

Deno.test("E2E: a Portal deployed without a Review entrance serves no review link", async () => {
  const server = await bootPortal({ PORTICO_REVIEW_ORIGIN: "off" });
  try {
    const response = await fetch(`${server.body.data.url}/`);
    const body = await response.text();
    assert(response.status === 200, `the discovery page still renders (got ${response.status})`);
    assert(!body.includes('href="/review'), "the entry must not survive the declaration");
    assert(!body.includes("审核登录"), "no review login label without a review entrance");
  } finally {
    await server.stop();
  }
});

Deno.test("E2E: a Portal deployed with a declared Review origin links to it", async () => {
  const server = await bootPortal({ PORTICO_REVIEW_ORIGIN: "https://review.example.test" });
  try {
    const response = await fetch(`${server.body.data.url}/`);
    const body = await response.text();
    assert(response.status === 200, `the discovery page still renders (got ${response.status})`);
    assert(
      body.includes('href="https://review.example.test/login"'),
      "an anonymous caller gets the login entry on the declared origin",
    );
    assert(!body.includes('href="/review'), "the relative link must be replaced, not duplicated");
  } finally {
    await server.stop();
  }
});
