import { assertEquals } from "./assert.ts";
import { handleReviewRequest } from "../src/review/handler.ts";
import { isAllowedGithubUser, parseAllowlist, parseGithubEnv } from "../src/review/github.ts";

const pending = { id: "candidate", name: "Candidate", governanceState: "pending_public" };
function context(
  actor: { id: string; kind: "human"; role: "auditor" | "reader" } = {
    id: "human:auditor",
    kind: "human",
    role: "auditor",
  },
) {
  const calls: string[] = [];
  const catalog = {
    list: () => Promise.resolve([pending]),
    approve: () => {
      calls.push("approve");
      return Promise.resolve({ ...pending, governanceState: "approved_public" });
    },
    reject: () => {
      calls.push("reject");
      return Promise.resolve({ ...pending, governanceState: "rejected" });
    },
  };
  const access = { resolveSession: () => Promise.resolve(actor) };
  return { context: { catalog, access } as never, calls };
}
const request = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1${path}`, init);

Deno.test("review rejects unauthenticated GET and non-auditor POST", async () => {
  const get = await handleReviewRequest(
    request("/review"),
    {
      catalog: {} as never,
      access: { resolveSession: () => Promise.reject(new Error("not used")) },
    } as never,
  );
  assertEquals(get.status, 401);
  const reader = context({ id: "human:reader", kind: "human", role: "reader" });
  const response = await handleReviewRequest(
    request("/review/approve", {
      method: "POST",
      headers: { "x-portico-session": "s", "content-type": "application/json" },
      body: JSON.stringify({ id: "candidate" }),
    }),
    reader.context,
  );
  assertEquals(response.status, 403);
});

Deno.test("review maps a verified Access JWT to a roster human; session outranks it", async () => {
  const auditor = { id: "human:auditor", kind: "human", role: "auditor" } as const;
  const calls: string[] = [];
  const catalog = {
    list: () => Promise.resolve([pending]),
    approve: () => {
      calls.push("approve");
      return Promise.resolve({ ...pending, governanceState: "approved_public" });
    },
    reject: () => {
      calls.push("reject");
      return Promise.resolve({ ...pending, governanceState: "rejected" });
    },
  };
  const verified = { email: "jamiesun@example.com" };
  const cfAccess = { verify: (_assertion: string) => Promise.resolve(verified) };
  const access = {
    resolveSession: (token: string) =>
      Promise.resolve(
        token === "reader-session"
          ? { id: "human:reader", kind: "human", role: "reader" }
          : { ...auditor },
      ),
    lookupHumanByEmail: (email: string) =>
      Promise.resolve(email === verified.email ? { ...auditor } : null),
  };
  const contextWithAccess = { catalog, access, cfAccess } as never;
  // JWT-mapped auditor approves without any session header.
  const approve = await handleReviewRequest(
    request("/review/approve", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": "good", "content-type": "application/json" },
      body: JSON.stringify({ id: "candidate" }),
    }),
    contextWithAccess,
  );
  assertEquals(approve.status, 200);
  assertEquals(calls, ["approve"]);
  // A forged assertion fails closed to anonymous.
  const forged = await handleReviewRequest(
    request("/review", { headers: { "cf-access-jwt-assertion": "bad" } }),
    { catalog, access, cfAccess: { verify: () => Promise.resolve(null) } } as never,
  );
  assertEquals(forged.status, 401);
  // An email outside the roster fails closed to anonymous.
  const stranger = await handleReviewRequest(
    request("/review", { headers: { "cf-access-jwt-assertion": "good" } }),
    {
      catalog,
      access: { ...access, lookupHumanByEmail: () => Promise.resolve(null) },
      cfAccess,
    } as never,
  );
  assertEquals(stranger.status, 401);
  // A presented session outranks the JWT: reader session + auditor JWT stays 403.
  const shadowed = await handleReviewRequest(
    request("/review/approve", {
      method: "POST",
      headers: {
        "x-portico-session": "reader-session",
        "cf-access-jwt-assertion": "good",
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: "candidate" }),
    }),
    contextWithAccess,
  );
  assertEquals(shadowed.status, 403);
});

Deno.test("review POST routes approve and reject and GET is HTML", async () => {
  const state = context();
  const headers = { "x-portico-session": "s", "content-type": "application/json" };
  const approve = await handleReviewRequest(
    request("/review/approve", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "candidate" }),
    }),
    state.context,
  );
  assertEquals(approve.status, 200);
  assertEquals(state.calls, ["approve"]);
  const reject = await handleReviewRequest(
    request("/review/reject", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "candidate" }),
    }),
    state.context,
  );
  assertEquals(reject.status, 200);
  assertEquals(state.calls, ["approve", "reject"]);
  const page = await handleReviewRequest(
    request("/review", { headers: { "x-portico-session": "s" } }),
    state.context,
  );
  assertEquals(page.status, 200);
  assertEquals((await page.text()).includes("Human review"), true);
});

Deno.test("review github login is allowlisted and mints a session for the roster human", async () => {
  const auditor = { id: "human:auditor", kind: "human", role: "auditor" } as const;
  const sessions: string[] = [];
  const access = {
    resolveSession: () => Promise.reject(new Error("no session")),
    lookupHumanByEmail: (email: string) =>
      Promise.resolve(email === "jamiesun@example.com" ? { ...auditor } : null),
    createBrowserSession: (email: string) => {
      sessions.push(email);
      return Promise.resolve({
        sessionId: "ses-1",
        token: "pst1_test",
        actor: { ...auditor },
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      });
    },
  };
  const exchange = (_config: unknown, code: string) => {
    if (code !== "good-code") throw new Error("bad code");
    return Promise.resolve({
      login: "jamiesun",
      email: "jamiesun@example.com",
      emails: ["jamiesun@example.com"],
    });
  };
  const github = { config: { allowlist: ["jamiesun"] }, exchange } as never;
  const context = { catalog: {}, access, github } as never;
  // Start redirects to github.com with the callback and a state cookie.
  const start = await handleReviewRequest(
    new Request("http://127.0.0.1/review/oauth/start"),
    context,
  );
  assertEquals(start.status, 303);
  const location = start.headers.get("location") ?? "";
  assertEquals(location.startsWith("https://github.com/login/oauth/authorize"), true);
  const stateCookie = start.headers.get("set-cookie") ?? "";
  const state = /portico_oauth_state=([0-9a-f]+)/.exec(stateCookie)?.[1] ?? "";
  assertEquals(state.length, 32);
  // Callback with a stranger login is rejected even with a valid code.
  const strangerExchange = () =>
    Promise.resolve({
      login: "mallory",
      email: "mallory@example.com",
      emails: ["mallory@example.com"],
    });
  const stranger = await handleReviewRequest(
    new Request(`http://127.0.0.1/review/oauth/callback?code=good-code&state=${state}`, {
      headers: { cookie: `portico_oauth_state=${state}` },
    }),
    {
      catalog: {},
      access,
      github: { config: { allowlist: ["jamiesun"] }, exchange: strangerExchange },
    } as never,
  );
  assertEquals(stranger.status, 403);
  assertEquals(sessions.length, 0);
  // Callback with mismatched state is rejected before any exchange.
  let exchanged = false;
  const counting = () => {
    exchanged = true;
    return exchange(null, "good-code");
  };
  const badState = await handleReviewRequest(
    new Request("http://127.0.0.1/review/oauth/callback?code=good-code&state=wrong", {
      headers: { cookie: `portico_oauth_state=${state}` },
    }),
    {
      catalog: {},
      access,
      github: { config: { allowlist: ["jamiesun"] }, exchange: counting },
    } as never,
  );
  assertEquals(badState.status, 400);
  assertEquals(exchanged, false);
  // Happy path mints one session and sets the cookie.
  const done = await handleReviewRequest(
    new Request(`http://127.0.0.1/review/oauth/callback?code=good-code&state=${state}`, {
      headers: { cookie: `portico_oauth_state=${state}` },
    }),
    context,
  );
  assertEquals(done.status, 303);
  assertEquals(done.headers.get("location"), "/review");
  assertEquals(sessions, ["jamiesun@example.com"]);
  const cookies = done.headers.getSetCookie();
  assertEquals(cookies.some((value) => value.startsWith("portico_session=pst1_test")), true);
});

Deno.test("review github env parses allowlist and fails closed", () => {
  assertEquals(parseGithubEnv({}).enabled, false);
  assertEquals(parseGithubEnv({ PORTICO_REVIEW_GITHUB_ENABLED: "true" }).enabled, false);
  assertEquals(
    parseGithubEnv({
      PORTICO_REVIEW_GITHUB_ENABLED: "true",
      PORTICO_REVIEW_GITHUB_CLIENT_ID: "id",
      PORTICO_REVIEW_GITHUB_CLIENT_SECRET: "secret",
      PORTICO_REVIEW_GITHUB_CALLBACK: "http://callback.invalid/review/oauth/callback",
    }).enabled,
    false,
  );
  const parsed = parseGithubEnv({
    PORTICO_REVIEW_GITHUB_ENABLED: "yes",
    PORTICO_REVIEW_GITHUB_CLIENT_ID: "id",
    PORTICO_REVIEW_GITHUB_CLIENT_SECRET: "secret",
    PORTICO_REVIEW_GITHUB_CALLBACK: "https://portico.talkincode.net/review/oauth/callback",
    PORTICO_REVIEW_ALLOWLIST: "jamiesun, Friend@example.com",
  });
  assertEquals(parsed.enabled, true);
  if (parsed.enabled) assertEquals(parsed.allowlist, ["jamiesun", "friend@example.com"]);
  assertEquals(parseAllowlist("Jamiesun;; friend@example.com\n"), [
    "jamiesun",
    "friend@example.com",
  ]);
  assertEquals(isAllowedGithubUser({ login: "jamiesun", emails: [] }, ["jamiesun"]), true);
  assertEquals(isAllowedGithubUser({ login: "mallory", emails: [] }, ["jamiesun"]), false);
  assertEquals(
    isAllowedGithubUser({ login: "mallory", emails: ["Jamiesun@Example.com"] }, [
      "jamiesun@example.com",
    ]),
    true,
  );
  assertEquals(isAllowedGithubUser({ login: "jamiesun", emails: [] }, []), false);
});
