import { assert, assertEquals } from "./assert.ts";
import { type RosterFixture, signedInRoster } from "./fixtures.ts";
import { CatalogService, MemoryCatalogStore } from "../src/catalog/mod.ts";
import { handlePortalRequest, parseReviewEntry, reviewHref } from "../src/portal/mod.ts";
import type { ReviewEntry } from "../src/portal/mod.ts";

/**
 * The Portal is a discovery surface: it may only advertise an entrance this
 * deployment actually serves. A three-entrance deployment has no Review behind
 * the chrome, so linking to one would be a 404 dressed up as a governance
 * path. These tests pin the declaration, its fail-closed parsing, and the
 * three planes that render the entry.
 */

Deno.test("PORTICO_REVIEW_ORIGIN parses to the declared Review entrance", () => {
  assertEquals(parseReviewEntry({}), { kind: "same-origin" });
  assertEquals(parseReviewEntry({ PORTICO_REVIEW_ORIGIN: "" }), { kind: "same-origin" });
  assertEquals(parseReviewEntry({ PORTICO_REVIEW_ORIGIN: "   " }), { kind: "same-origin" });
  for (const raw of ["off", "OFF", " Off "]) {
    assertEquals(parseReviewEntry({ PORTICO_REVIEW_ORIGIN: raw }), { kind: "none" }, raw);
  }
  assertEquals(parseReviewEntry({ PORTICO_REVIEW_ORIGIN: "https://review.example.test" }), {
    kind: "origin",
    origin: "https://review.example.test",
  });
  // A path is kept, a trailing slash is not.
  assertEquals(
    parseReviewEntry({ PORTICO_REVIEW_ORIGIN: "http://127.0.0.1:8791/review/" }),
    { kind: "origin", origin: "http://127.0.0.1:8791/review" },
  );
});

Deno.test("an unusable PORTICO_REVIEW_ORIGIN hides the entry instead of advertising it", () => {
  for (
    const raw of [
      "javascript:alert(1)",
      "ftp://review.example.test",
      "https://reviewer:twelve@review.example.test",
      "https://review.example.test/?q=1",
      "https://review.example.test/#fragment",
      "review.example.test",
      "//review.example.test",
    ]
  ) {
    assertEquals(parseReviewEntry({ PORTICO_REVIEW_ORIGIN: raw }), { kind: "none" }, raw);
  }
});

Deno.test("the review href follows the declaration and the caller", () => {
  assertEquals(reviewHref(undefined, false), "/review/login");
  assertEquals(reviewHref(undefined, true), "/review");
  assertEquals(reviewHref({ kind: "same-origin" }, false), "/review/login");
  assertEquals(reviewHref({ kind: "same-origin" }, true), "/review");
  const origin: ReviewEntry = { kind: "origin", origin: "https://review.example.test/review" };
  assertEquals(reviewHref(origin, false), "https://review.example.test/review/login");
  assertEquals(reviewHref(origin, true), "https://review.example.test/review");
  assertEquals(reviewHref({ kind: "none" }, false), undefined);
  assertEquals(reviewHref({ kind: "none" }, true), undefined);
});

let roster: RosterFixture;

async function portalContext(reviewEntry?: ReviewEntry) {
  roster = await signedInRoster();
  return {
    catalog: new CatalogService(new MemoryCatalogStore()),
    access: roster.access,
    reviewEntry,
  };
}

const AUDITOR = "human:security-auditor";

async function page(
  path: string,
  context: Awaited<ReturnType<typeof portalContext>>,
): Promise<string> {
  const response = await handlePortalRequest(
    new Request(`http://portico.local${path}`, { headers: roster.headersFor(AUDITOR) }),
    context as never,
  );
  return await response.text();
}

Deno.test("a deployment that serves no Review advertises none on any plane", async () => {
  const context = await portalContext({ kind: "none" });
  for (
    const path of ["/", "/public", "/internal", "/internal/pending", "/internal/audit", "/missing"]
  ) {
    const body = await page(path, context);
    assert(!body.includes('href="/review'), `${path} must not link to a Review entrance`);
    assert(!body.includes("去审核"), `${path} must not offer the review label`);
    assert(!body.includes("审核登录"), `${path} must not offer the review login label`);
  }
});

Deno.test("the same-origin default does not keep a parallel Review entry", async () => {
  const context = await portalContext();
  const home = await page("/", context);
  assert(!home.includes('href="/review"'), "discovery does not jump to a second review UI");
  assert(!home.includes(">审核<"), "the header does not offer 审核");
  assert(home.includes("登出"), "a signed-in caller can leave");
  const public_ = await page("/public", context);
  assert(!public_.includes('href="/review"'), "the public plane does not offer review");
  assert(public_.includes("登出"), "the public plane shows logout when signed in");
});

Deno.test("a declared origin is not advertised as primary chrome", async () => {
  const context = await portalContext({
    kind: "origin",
    origin: "https://review.example.test/review",
  });
  const home = await page("/", context);
  assert(!home.includes("review.example.test"), "the magazine does not point at a review origin");
  assert(!home.includes('href="/review'), "no relative review link survives");
  const public_ = await page("/public", context);
  assert(!public_.includes("review.example.test"), "the public plane does not point at review");
});
