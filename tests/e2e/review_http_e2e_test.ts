import { assert, assertEquals } from "../assert.ts";
import { CfAccessVerifier, parseCfAccessEnv } from "../../src/access/mod.ts";
import { listenMcp, mcpUrl } from "../../src/mcp/mod.ts";
import { listenPortal, portalUrl } from "../../src/portal/mod.ts";
import { listenReview, reviewUrl } from "../../src/review/mod.ts";
import { generateRs256, mintJwt } from "../cf_access_helpers.ts";
import {
  actor,
  bootstrapRoster,
  runCli,
  sampleRecord,
  sessionFor,
  sessionsPathFor,
} from "./harness.ts";

/**
 * The human review boundary, as an operator actually meets it.
 *
 * `tests/review_handler_test.ts` drives the handler against a stub catalog;
 * this file starts the real `listenReview` server over the same files the CLI
 * and the read-only entrances read, and asks whether the *governance* claim
 * holds across entrances: a submission stays invisible everywhere until an
 * independent human auditor decides it here — and a caller who cannot prove
 * they are that auditor cannot move it, or leave a trace of having tried.
 */

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

/** A JSON request that proves an identity with a session, not a claim. */
function asSession(session: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-portico-session": session },
    body: JSON.stringify(body),
  };
}

/** The `name=value` pair of a `Set-Cookie` response, as a browser would send it. */
function cookieValue(setCookie: string): string {
  const pair = setCookie.split(";")[0];
  assert(pair.includes("="), `not a cookie: ${setCookie}`);
  return pair;
}

const TEAM = "example";
const AUD = "test-audience-tag";
const ISSUER = "https://example.cloudflareaccess.com";
const AUDITOR_EMAIL = "auditor@example.invalid";

/** `portico_list` over MCP, read as an envelope so any role can be asked. */
async function mcpList(
  base: string,
  session?: string,
): Promise<Array<{ id: string }>> {
  const response = await fetch(base, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session ? { "x-portico-session": session } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "portico_list", arguments: {} },
    }),
  });
  const body = await response.json() as { result?: { content?: Array<{ text: string }> } };
  const envelope = JSON.parse(body.result?.content?.[0]?.text ?? "null") as {
    ok: boolean;
    data?: Array<{ id: string }>;
  };
  return envelope.data ?? [];
}

Deno.test(
  "E2E: a public candidate stays invisible until an independent human auditor approves it in Review",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "portico-review-e2e-" });
    const catalog = `${dir}/catalog.json`;
    const identities = `${dir}/identities.json`;
    const sessions = sessionsPathFor(identities);
    const env = await bootstrapRoster(identities, sessions);
    const identitiesBefore = await Deno.readFile(identities);

    const reviewController = new AbortController();
    const portalController = new AbortController();
    const mcpController = new AbortController();
    const review = listenReview({
      catalogPath: catalog,
      identitiesPath: identities,
      sessionsPath: sessions,
      hostname: "127.0.0.1",
      port: 0,
      signal: reviewController.signal,
    });
    const portal = listenPortal({
      catalogPath: catalog,
      identitiesPath: identities,
      sessionsPath: sessions,
      hostname: "127.0.0.1",
      port: 0,
      signal: portalController.signal,
    });
    const mcp = listenMcp({
      catalogPath: catalog,
      identitiesPath: identities,
      sessionsPath: sessions,
      hostname: "127.0.0.1",
      port: 0,
      signal: mcpController.signal,
    });

    try {
      const base = reviewUrl(review);
      const portalBase = portalUrl(portal);
      const mcpBase = mcpUrl(mcp);

      // ── the maintainer submits a public candidate from inside Review ──
      const submitted = await fetchJson(
        `${base}/review/api/submit`,
        asSession(sessionFor("agent:docs-bot")!, {
          input: sampleRecord(),
          action: "public",
        }),
      );
      assertEquals(submitted.status, 200, JSON.stringify(submitted.body));
      const candidate = submitted.body.data as {
        governanceState: string;
        visibility: string;
        publicSubmission?: { submittedBy: { id: string } };
      };
      assertEquals(candidate.governanceState, "pending_public");
      assertEquals(candidate.visibility, "public");
      assertEquals(candidate.publicSubmission?.submittedBy.id, "agent:docs-bot");

      // ── being a submission is not being public ──────────────────────────
      const anonPortal = await fetchJson(`${portalBase}/api/catalog`);
      assertEquals(anonPortal.body.data, []);
      assertEquals(
        (await fetch(`${portalBase}/public/s/docs-writer`)).status,
        404,
        "an unapproved candidate has no public reading page",
      );
      const anonCli = await runCli(["catalog", "list", "--catalog", catalog], env);
      assertEquals((anonCli.stdout as { data?: unknown }).data, []);
      assertEquals(await mcpList(mcpBase), []);

      // …and it is not in the public queue either: Review itself is closed to
      // anonymous callers, and its body must not leak the candidate.
      const anonReview = await fetchJson(`${base}/review`);
      assertEquals(anonReview.status, 401);
      assert(!JSON.stringify(anonReview.body).includes("Docs Writer"));

      // ── only a human auditor may decide, and never the submitter ────────
      const maintainer = await fetchJson(
        `${base}/review/approve`,
        asSession(sessionFor("agent:docs-bot")!, { id: "docs-writer" }),
      );
      assertEquals(maintainer.status, 403);
      assertEquals(maintainer.body.error?.code, "FORBIDDEN");

      // A human maintainer is still a maintainer, not an auditor.
      const humanMaintainer = await fetchJson(
        `${base}/review/approve`,
        asSession(sessionFor("human:docs-owner")!, { id: "docs-writer" }),
      );
      assertEquals(humanMaintainer.status, 403);

      const reader = await fetchJson(
        `${base}/review/reject`,
        asSession(sessionFor("human:reader")!, { id: "docs-writer" }),
      );
      assertEquals(reader.status, 403);

      // An unknown session is not a weaker session; it is nobody. A presented
      // but invalid credential is refused exactly as the Portal and MCP
      // entrances refuse one (403 FORBIDDEN), while presenting nothing at all
      // is 401 — the status separates "prove yourself" from "that proof is
      // worthless".
      const unknown = await fetchJson(
        `${base}/review/approve`,
        asSession("not-a-session", { id: "docs-writer" }),
      );
      assertEquals(unknown.status, 403);
      assertEquals(unknown.body.error?.code, "FORBIDDEN");

      // A malformed credential is refused as such on a real route, not silently
      // treated as anonymous: shape validation happens where the credential is
      // read, so a junk `Authorization` header cannot masquerade as nobody.
      const malformed = await fetchJson(`${base}/review`, {
        headers: { authorization: "Basic dXNlcjpwYXNz" },
      });
      assertEquals(malformed.status, 400);
      assertEquals(malformed.body.error?.code, "INVALID_INPUT");
      assert(
        !(await fetch(`${portalBase}/public/s/docs-writer`)).ok,
        "a failed approval must not open the public plane",
      );

      // ── the auditor signs in the way a browser does ─────────────────────
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
      ], env);
      assertEquals(issued.code, 0, issued.raw || issued.stderr);
      const credential = (issued.stdout as { data?: { token?: string } }).data?.token ?? "";

      const login = await fetch(`${base}/review/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id: "human:security-auditor", token: credential }),
        redirect: "manual",
      });
      assertEquals(login.status, 303);
      const setCookie = login.headers.get("set-cookie") ?? "";
      assert(setCookie.includes("portico_session="), "login must hand back a session cookie");
      assert(setCookie.includes("HttpOnly"), "the session cookie must not be readable by script");
      assert(setCookie.includes("Secure"), "the session cookie must be HTTPS-only");
      assert(setCookie.includes("SameSite=Lax"), "the session cookie must be same-site");
      assert(
        setCookie.includes("Path=/"),
        "the session cookie must roam the whole Portal",
      );
      assert(
        !setCookie.includes("Path=/review"),
        "the session cookie must not be scoped to /review alone",
      );
      assert(
        !setCookie.includes(credential),
        "the login response must not echo the one-time token",
      );

      const cookie = cookieValue(setCookie);
      const queue = await fetch(`${base}/review`, { headers: { cookie }, redirect: "manual" });
      assertEquals(queue.status, 303);
      assertEquals(
        queue.headers.get("location"),
        "/internal?state=pending_public",
        "the old review queue redirects into the content workbench",
      );

      const readerQueue = await fetch(`${base}/review`, {
        headers: { "x-portico-session": sessionFor("human:reader")! },
        redirect: "manual",
      });
      assertEquals(readerQueue.status, 303);

      // ── the independent auditor approves, from the browser form ────────
      const approved = await fetch(`${base}/review/approve`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
        body: new URLSearchParams({ id: "docs-writer" }),
      });
      assertEquals(approved.status, 200);

      // ── and now, and only now, all three entrances agree it is public ──
      const publicPage = await fetch(`${portalBase}/public/s/docs-writer`);
      assertEquals(publicPage.status, 200);
      assert((await publicPage.text()).includes("Docs Writer"));

      const portalAfter = await fetchJson(`${portalBase}/api/catalog`);
      assertEquals((portalAfter.body.data as Array<{ id: string }>).map((r) => r.id), [
        "docs-writer",
      ]);
      const cliAfter = await runCli(["catalog", "list", "--catalog", catalog], env);
      assertEquals(
        ((cliAfter.stdout as { data?: Array<{ id: string }> }).data ?? []).map((r) => r.id),
        ["docs-writer"],
      );
      assertEquals((await mcpList(mcpBase)).map((r) => r.id), ["docs-writer"]);

      // The decision is attributable to the auditor who made it, not to the
      // maintainer who asked for it.
      const trail = await runCli(
        [
          "catalog",
          "approvals",
          "--catalog",
          catalog,
          ...actor("auditor", "human:security-auditor", "human"),
        ],
        env,
      );
      assertEquals(trail.code, 0, trail.raw || trail.stderr);
      const approvals = (trail.stdout as {
        data?: Array<{ decision: string; reviewedBy: { id: string }; submittedBy: { id: string } }>;
      }).data ?? [];
      assertEquals(approvals.length, 1);
      assertEquals(approvals[0].decision, "approved");
      assertEquals(approvals[0].reviewedBy.id, "human:security-auditor");
      assertEquals(approvals[0].submittedBy.id, "agent:docs-bot");

      // Review writes catalog and sessions; it must never rewrite the roster.
      assertEquals(await Deno.readFile(identities), identitiesBefore);
    } finally {
      reviewController.abort();
      portalController.abort();
      mcpController.abort();
      await review.finished;
      await portal.finished;
      await mcp.finished;
    }
  },
);

Deno.test(
  "E2E: a caller who cannot prove they are the auditor moves nothing, and the candidate survives",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "portico-review-refused-e2e-" });
    const catalog = `${dir}/catalog.json`;
    const identities = `${dir}/identities.json`;
    const sessions = sessionsPathFor(identities);
    const env = await bootstrapRoster(identities, sessions);

    // The auditor is the one roster human with an Access-mapped address, so a
    // verified assertion — and nothing weaker — can stand in for a session.
    // It is a second auditor, not the bootstrapped one: an identity cannot
    // grant or change its own role, and that refusal is itself the boundary
    // this file relies on.
    const granted = await runCli([
      "identity",
      "grant",
      "--identities",
      identities,
      ...actor("auditor", "human:security-auditor", "human"),
      "--id",
      "human:review-auditor",
      "--kind",
      "human",
      "--role",
      "auditor",
      "--email",
      AUDITOR_EMAIL,
    ], env);
    assertEquals(granted.code, 0, granted.raw || granted.stderr);

    const keys = await generateRs256();
    const jwksController = new AbortController();
    const jwks = Deno.serve({
      hostname: "127.0.0.1",
      port: 0,
      signal: jwksController.signal,
      onListen: () => {},
    }, () =>
      new Response(JSON.stringify(keys.jwks), {
        headers: { "content-type": "application/json" },
      }));
    const jwksAddr = jwks.addr;
    if (!("hostname" in jwksAddr) || !("port" in jwksAddr)) {
      throw new Error("jwks server is not a TCP listener");
    }
    const cf = parseCfAccessEnv({
      PORTICO_CF_ACCESS_ENABLED: "true",
      PORTICO_CF_ACCESS_TEAM: TEAM,
      PORTICO_CF_ACCESS_AUD: AUD,
      PORTICO_CF_ACCESS_JWKS_URL: `http://${jwksAddr.hostname}:${jwksAddr.port}/certs`,
    });
    if (!cf.enabled) throw new Error("expected CF Access config");

    const now = Math.floor(Date.now() / 1000);
    const expired = await mintJwt(
      keys.privateKey,
      { alg: "RS256", kid: keys.kid, typ: "JWT" },
      { aud: AUD, iss: ISSUER, exp: now - 30, iat: now - 90, email: AUDITOR_EMAIL },
    );
    const outsider = await mintJwt(
      keys.privateKey,
      { alg: "RS256", kid: keys.kid, typ: "JWT" },
      { aud: AUD, iss: ISSUER, exp: now + 600, iat: now - 10, email: "nobody@example.invalid" },
    );
    const valid = await mintJwt(
      keys.privateKey,
      { alg: "RS256", kid: keys.kid, typ: "JWT" },
      { aud: AUD, iss: ISSUER, exp: now + 600, iat: now - 10, email: AUDITOR_EMAIL },
    );

    const reviewController = new AbortController();
    const portalController = new AbortController();
    const review = listenReview({
      catalogPath: catalog,
      identitiesPath: identities,
      sessionsPath: sessions,
      hostname: "127.0.0.1",
      port: 0,
      signal: reviewController.signal,
      cfAccess: new CfAccessVerifier(cf),
    });
    const portal = listenPortal({
      catalogPath: catalog,
      identitiesPath: identities,
      sessionsPath: sessions,
      hostname: "127.0.0.1",
      port: 0,
      signal: portalController.signal,
    });

    try {
      const base = reviewUrl(review);
      const portalBase = portalUrl(portal);

      const submitted = await fetchJson(
        `${base}/review/api/submit`,
        asSession(sessionFor("agent:docs-bot")!, {
          input: sampleRecord(),
          action: "public",
        }),
      );
      assertEquals(submitted.status, 200);

      const catalogBefore = await Deno.readFile(catalog);
      const identitiesBefore = await Deno.readFile(identities);
      const sessionsBefore = await Deno.readFile(sessions);

      // A forged or stale assertion with a hand-written email header is not a
      // login: the plaintext header was never proof, and the mapping adds
      // nothing when the assertion itself is dead.
      const forged = await fetchJson(`${base}/review/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-access-jwt-assertion": expired,
          "cf-access-authenticated-user-email": AUDITOR_EMAIL,
        },
        body: JSON.stringify({ id: "docs-writer" }),
      });
      assertEquals(forged.status, 401);

      // A perfectly valid assertion for somebody outside the roster is still
      // nobody.
      const stranger = await fetchJson(`${base}/review/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-access-jwt-assertion": outsider },
        body: JSON.stringify({ id: "docs-writer" }),
      });
      assertEquals(stranger.status, 401);

      const anonQueue = await fetchJson(`${base}/review`);
      assertEquals(anonQueue.status, 401);

      // The JWT path maps a roster human; it must not mint a session or touch
      // the roster while doing it.
      assertEquals(await Deno.readFile(sessions), sessionsBefore);
      assertEquals(await Deno.readFile(identities), identitiesBefore);

      // Malformed and misdirected requests are refused without a decision.
      const noId = await fetchJson(
        `${base}/review/approve`,
        asSession(sessionFor("human:security-auditor")!, {}),
      );
      assertEquals(noId.status, 400);

      const unknownId = await fetchJson(
        `${base}/review/approve`,
        asSession(sessionFor("human:security-auditor")!, { id: "never-registered" }),
      );
      assertEquals(unknownId.status, 404);
      assertEquals(unknownId.body.error?.code, "NOT_FOUND");

      assertEquals((await fetch(`${base}/review/approve`)).status, 404);
      assertEquals((await fetch(`${base}/review/nope`)).status, 404);
      assertEquals(
        (await fetch(`${base}/review/reject`, { method: "PUT" })).status,
        405,
      );

      // Signing an Agent in through the browser door is not a thing.
      const agentLogin = await runCli([
        "identity",
        "credential",
        "issue",
        "--identities",
        identities,
        "--sessions",
        sessions,
        ...actor("auditor", "human:security-auditor", "human"),
        "--id",
        "agent:docs-bot",
      ], env);
      const agentToken = (agentLogin.stdout as { data?: { token?: string } }).data?.token ?? "";
      const agentBrowser = await fetch(`${base}/review/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id: "agent:docs-bot", token: agentToken }),
        redirect: "manual",
      });
      assertEquals(agentBrowser.status, 403);

      // None of that moved a byte of governance state, and the candidate is
      // still exactly where it was: refused callers do not consume a review.
      assertEquals(await Deno.readFile(catalog), catalogBefore);
      assertEquals(await Deno.readFile(identities), identitiesBefore);
      assertEquals((await fetch(`${portalBase}/public/s/docs-writer`)).status, 404);

      // ── the real auditor can still decide it, with a verified assertion ──
      const approved = await fetchJson(`${base}/review/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-access-jwt-assertion": valid },
        body: JSON.stringify({ id: "docs-writer" }),
      });
      assertEquals(approved.status, 200, JSON.stringify(approved.body));
      assertEquals(
        (await fetch(`${portalBase}/public/s/docs-writer`)).status,
        200,
        "the candidate must not be poisoned by the refused attempts",
      );
      assertEquals(await Deno.readFile(identities), identitiesBefore);
    } finally {
      reviewController.abort();
      portalController.abort();
      jwksController.abort();
      await review.finished;
      await portal.finished;
      await jwks.finished;
    }
  },
);
