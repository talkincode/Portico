import { assert } from "./assert.ts";

/**
 * The public handbook is the operator-facing seam for Cloudflare Access.
 * It must describe the Portico-side contract that `src/access/cf-access.ts`
 * already implements, without turning the repo into an IdP or a tunnel kit.
 */

const ROOT = new URL("../", import.meta.url).pathname;

const REQUIRED_ENV = [
  "PORTICO_CF_ACCESS_ENABLED",
  "PORTICO_CF_ACCESS_TEAM",
  "PORTICO_CF_ACCESS_AUD",
] as const;

const FORBIDDEN = [
  "cloudflared tunnel",
  "TUNNEL_TOKEN",
];

Deno.test("cf-access handbook describes the Portico-side contract without secrets or tunnels", async () => {
  const text = await Deno.readTextFile(`${ROOT}docs/access/cf-access.md`);
  for (const name of REQUIRED_ENV) {
    assert(text.includes(name), `handbook must name ${name}`);
  }
  assert(
    text.includes("example.invalid"),
    "handbook emails must use the example.invalid placeholder",
  );
  assert(
    text.includes("Cf-Access-Jwt-Assertion"),
    "handbook must name the signed assertion header",
  );
  assert(
    /fail-closed|匿名/.test(text),
    "handbook must state fail-closed / anonymous behavior",
  );
  assert(
    text.includes("example.cloudflareaccess.com") ||
      text.includes("example.invalid"),
    "handbook must not invent a real team domain",
  );
  for (const leak of FORBIDDEN) {
    assert(
      !text.includes(leak),
      `public handbook must not contain ${leak}`,
    );
  }
  const ips = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
  for (const ip of ips) {
    assert(
      ip === "127.0.0.1",
      `handbook must not contain a non-loopback address (${ip})`,
    );
  }
});

Deno.test("cf-access handbook is linked from the access index and SUMMARY", async () => {
  const summary = await Deno.readTextFile(`${ROOT}docs/SUMMARY.md`);
  const index = await Deno.readTextFile(`${ROOT}docs/access/README.md`);
  assert(
    summary.includes("access/cf-access.md"),
    "SUMMARY.md must link the handbook",
  );
  assert(
    index.includes("cf-access.md"),
    "docs/access/README.md must link the handbook",
  );
});
