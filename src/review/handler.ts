import { AccessService } from "../access/mod.ts";
import { BROWSER_SESSION_COOKIE_MAX_AGE, readSessionToken } from "../access/session-header.ts";
import { CatalogError, CatalogService, ErrorCode } from "../catalog/mod.ts";
import type { Actor, RegisterInput } from "../catalog/mod.ts";
import { esc, prefersDark, renderShell, resolvePageTheme } from "../portal/design/mod.ts";
import {
  type ExchangeGithubCode,
  githubAuthorizeUrl,
  type GithubOauthConfig,
  isAllowedGithubUser,
} from "./github.ts";

export interface ReviewContext {
  catalog: CatalogService;
  access: AccessService;
  /**
   * Optional Review-only Cloudflare Access mapping. Same contract as the
   * Portal: a verified JWT maps to a roster human, never writes a session,
   * and a presented Portico session always outranks it. Absent means off.
   */
  cfAccess?: ReviewCfAccess;
  /**
   * Optional Review GitHub OAuth login (mira pattern). Verified,
   * allowlisted GitHub users mint a normal Portico browser session for the
   * roster human their email matches. Absent means off.
   */
  github?: ReviewGithub;
}

export interface ReviewGithub {
  config: GithubOauthConfig;
  exchange: ExchangeGithubCode;
}

export interface ReviewCfAccess {
  verify(assertion: string): Promise<{ email: string } | null>;
}

export async function handleReviewRequest(
  request: Request,
  context: ReviewContext,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.pathname === "/review/login") return await handleLogin(request, context);
    if (url.pathname === "/review/oauth/start") return handleOauthStart(context);
    if (url.pathname === "/review/oauth/callback") {
      return await handleOauthCallback(request, context);
    }
    if (
      url.pathname !== "/review" && url.pathname !== "/review/" &&
      url.pathname !== "/review/approve" && url.pathname !== "/review/reject" &&
      url.pathname !== "/review/withdraw" && url.pathname !== "/review/remove" &&
      url.pathname !== "/review/restore" && url.pathname !== "/review/purge" &&
      url.pathname !== "/review/api/submit"
    ) return new Response("Not found", { status: 404 });
    const actor = await resolveActor(request, context);
    if (request.method === "GET") {
      if (url.pathname !== "/review" && url.pathname !== "/review/") {
        return new Response("Not found", { status: 404 });
      }
      // Browser-first login wall: a real navigation (Accept: text/html)
      // without proof lands on the Portal login page (the canonical human
      // entry) instead of a JSON 401 it cannot act on. The Portal sets the
      // session cookie at Path=/, which covers /review/* too. API-style
      // callers keep the machine-readable 401, so the documented 401/403
      // split across entrances does not fork.
      if (actor.role === "anonymous") {
        if (wantsHtml(request)) {
          return new Response(null, {
            status: 303,
            headers: {
              "location": `/login?next=${encodeURIComponent("/internal?state=pending_public")}`,
            },
          });
        }
        return jsonError(401, "authentication required");
      }
      // The review queue is no longer a second workbench. Day-to-day
      // approve / withdraw / delete lives on the internal content detail.
      return new Response(null, {
        status: 303,
        headers: { "location": "/internal?state=pending_public" },
      });
    }
    if (request.method !== "POST") return jsonError(405, "method not allowed");
    const contentType = request.headers.get("content-type") ?? "";
    const jsonBody = contentType.includes("application/json");
    const browserForm = !jsonBody && wantsHtml(request);
    if (actor.role === "anonymous") {
      // A browser without proof goes back to login and returns afterwards;
      // API callers keep the machine-readable 401.
      if (browserForm) {
        // The record id travels in the form body, which is still unread:
        // peek at a clone so the later parse is unaffected.
        let back = "/internal?state=pending_public";
        try {
          const probe = Object.fromEntries(
            (await request.clone().formData()).entries(),
          ) as { id?: unknown };
          if (typeof probe.id === "string" && /^[a-z][a-z0-9-]{1,62}$/.test(probe.id)) {
            back = `/internal?id=${probe.id}`;
          }
        } catch {
          // Unreadable body: the pending queue is still a useful landing.
        }
        return new Response(null, {
          status: 303,
          headers: { "location": `/login?next=${encodeURIComponent(back)}` },
        });
      }
      return forbidden(401, "authentication required");
    }
    if (url.pathname === "/review/api/submit") {
      if (actor.role !== "maintainer") {
        return forbidden(403, "only an authenticated maintainer may submit");
      }
      const body = await request.json() as
        & { input?: RegisterInput; action?: unknown }
        & Partial<RegisterInput>;
      const input = body.input ?? (() => {
        const { action: _action, input: _input, ...register } = body;
        return register as RegisterInput;
      })();
      if (!input || typeof input !== "object" || typeof input.id !== "string") {
        return jsonError(400, "expected a RegisterInput (optionally wrapped as {input, action})");
      }
      const submitted = await context.catalog.register(actor, input);
      if (body.action === "public") {
        await context.catalog.publish(actor, { id: submitted.id, visibility: "public" });
      }
      return new Response(
        JSON.stringify({ ok: true, data: await context.catalog.get(actor, submitted.id) }),
        {
          headers: securityHeaders("application/json; charset=utf-8"),
        },
      );
    }
    if (actor.kind !== "human" || actor.role !== "auditor") {
      return forbidden(403, "only a human auditor may review");
    }
    const action = reviewAction(url.pathname);
    if (!action) {
      return jsonError(
        405,
        "POST only at /review/approve, /review/reject, /review/withdraw, /review/remove, /review/restore or /review/purge",
      );
    }
    const body = jsonBody
      ? await request.json() as { id?: unknown; note?: unknown }
      : Object.fromEntries((await request.formData()).entries()) as {
        id?: unknown;
        note?: unknown;
      };
    if (typeof body.id !== "string") return jsonError(400, "expected {id}");
    const note = typeof body.note === "string" && body.note !== "" ? body.note : undefined;
    const backBase = action === "remove" || action === "purge"
      ? "/internal/trash"
      : `/internal?id=${encodeURIComponent(body.id)}`;
    const back = (suffix: string) =>
      backBase.includes("?") ? `${backBase}&${suffix}` : `${backBase}?${suffix}`;
    if (browserForm) {
      try {
        await dispatchReview(context, actor, action, body.id, note);
      } catch (error) {
        // The browser stays on the record and sees what failed; API callers
        // keep the machine-readable error below.
        const code = error instanceof CatalogError ? error.code : "INTERNAL";
        return new Response(null, {
          status: 303,
          headers: { location: back(`reviewError=${encodeURIComponent(code)}`) },
        });
      }
      return new Response(null, {
        status: 303,
        headers: { location: back(`review=${action}`) },
      });
    }
    const result = await dispatchReview(context, actor, action, body.id, note);
    return new Response(JSON.stringify({ ok: true, data: result }), {
      headers: securityHeaders("application/json; charset=utf-8"),
    });
  } catch (error) {
    if (error instanceof CatalogError) {
      return jsonError(statusFor(error.code), error.message, error.code);
    }
    return jsonError(500, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Review callers prove who they are with a session, or with a verified
 * Cloudflare Access JWT when the operator enabled the mapping. Session
 * always outranks JWT; a forged assertion or an email outside the roster
 * fails closed to anonymous. The plaintext
 * `Cf-Access-Authenticated-User-Email` header is never proof.
 */
async function resolveActor(request: Request, context: ReviewContext): Promise<Actor> {
  const headerToken = readSessionToken(request);
  if (headerToken) {
    // API-style proof must throw on invalid sessions: the caller explicitly
    // presented proof and it is wrong, so FORBIDDEN is the right answer.
    return await context.access.resolveSession(headerToken);
  }
  const cookieToken = readSessionCookie(request);
  if (cookieToken) {
    // Browser flow parity with the Portal: a stale cookie from a previous
    // login falls back instead of failing hard, so an expired session sends
    // the browser back to login rather than answering FORBIDDEN.
    try {
      return await context.access.resolveSession(cookieToken);
    } catch {
      // Invalid or expired cookie session: fall through to anonymous or CF Access.
    }
  }
  if (context.cfAccess) {
    const assertion = request.headers.get("cf-access-jwt-assertion");
    if (assertion) {
      try {
        const verified = await context.cfAccess.verify(assertion);
        if (verified?.email) {
          const mapped = await context.access.lookupHumanByEmail(verified.email);
          if (mapped) return mapped;
        }
      } catch {
        // Fail closed to anonymous.
      }
    }
  }
  return anonymous();
}

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.split(",").some((part) => part.split(";")[0].trim().toLowerCase() === "text/html");
}

function anonymous(): Actor {
  return { id: "anonymous", kind: "human", role: "anonymous" };
}
/**
 * GitHub OAuth login (mira pattern). When Portal owns the callback URL, we
 * redirect there so one callback serves both surfaces. Otherwise the state
 * token is a short-lived CSRF binding held in an HttpOnly cookie. Only
 * allowlisted GitHub logins/emails proceed, and only to the roster human
 * their verified email matches — GitHub never grants a role by itself.
 */
function handleOauthStart(context: ReviewContext): Response {
  if (!context.github) return jsonError(501, "github login is not configured");
  // If Portal owns the callback (URL ends with /oauth/callback, not /review/oauth/callback),
  // redirect to Portal's /oauth/start so users go through the unified login.
  if (isPortalCallback(context.github.config.callbackUrl)) {
    return new Response(null, {
      status: 303,
      headers: { "location": "/oauth/start" },
    });
  }
  const state = randomState();
  return new Response(null, {
    status: 303,
    headers: {
      "location": githubAuthorizeUrl(context.github.config, state),
      "set-cookie":
        `portico_oauth_state=${state}; Path=/review/oauth/callback; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
}

/** True when the callback URL ends at Portal's /oauth/callback, not Review's. */
function isPortalCallback(callbackUrl: string): boolean {
  try {
    const url = new URL(callbackUrl);
    return url.pathname === "/oauth/callback";
  } catch {
    return false;
  }
}

async function handleOauthCallback(request: Request, context: ReviewContext): Promise<Response> {
  if (!context.github) return jsonError(501, "github login is not configured");
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(request, "portico_oauth_state");
  // Browser flow: failures re-render the login page with the reason inline
  // (a raw JSON body strands the user), and log one line for the operator.
  // Status stays non-2xx so machines can still tell success apart.
  const fail = (status: number, reason: string, log: string): Response => {
    console.error(`[review/oauth] ${log}`);
    return new Response(renderLoginPage(request, true, reason), {
      status,
      headers: securityHeaders("text/html; charset=utf-8"),
    });
  };
  if (!code || !state || !expected || state !== expected) {
    return fail(400, "GitHub 回调校验失败，请重新点击登录。", "state mismatch or missing code");
  }
  let user;
  try {
    user = await context.github.exchange(context.github.config, code);
  } catch {
    return fail(502, "GitHub 换 token 失败，请重试。", "github exchange failed");
  }
  if (!isAllowedGithubUser(user, context.github.config.allowlist)) {
    console.error(`[review/oauth] allowlist deny login=${user.login}`);
    return fail(403, `GitHub 账号 ${user.login} 不在 allowlist 中。`, "allowlist deny");
  }
  const emails = [user.email, ...user.emails].filter((email): email is string => !!email);
  for (const email of emails) {
    try {
      const session = await context.access.createBrowserSession(email);
      return new Response(null, { status: 303, headers: oauthSessionHeaders(session.token) });
    } catch {
      // Try the next verified email; a roster miss is not fatal yet.
    }
  }
  console.error(`[review/oauth] roster miss login=${user.login} emails=${emails.join(",")}`);
  return fail(
    403,
    `GitHub 登录成功，但名册里没有 ${emails[0] ?? "你的邮箱"}，请联系管理员绑定。`,
    "roster miss",
  );
}

function oauthSessionHeaders(sessionToken: string): Headers {
  const headers = new Headers({ "location": "/review" });
  headers.append(
    "set-cookie",
    `portico_session=${
      encodeURIComponent(sessionToken)
    }; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${BROWSER_SESSION_COOKIE_MAX_AGE}`,
  );
  headers.append("set-cookie", "portico_oauth_state=; Path=/review/oauth/callback; Max-Age=0");
  return headers;
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(cookies);
  return match ? decodeURIComponent(match[1]) : null;
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readSessionCookie(request: Request): string | null {
  return readCookie(request, "portico_session");
}
async function handleLogin(request: Request, context: ReviewContext): Promise<Response> {
  if (request.method === "GET") {
    return html(renderLoginPage(request, context.github !== undefined));
  }
  if (request.method !== "POST") return jsonError(405, "method not allowed");
  const contentType = request.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await request.json() as { id?: unknown; token?: unknown }
    : Object.fromEntries((await request.formData()).entries());
  if (typeof body.id !== "string" || typeof body.token !== "string") {
    return jsonError(400, "id and token are required");
  }
  const session = await context.access.login({ id: body.id, token: body.token });
  if (session.actor.kind !== "human") {
    return forbidden(403, "browser review login is for humans only");
  }
  return new Response(null, {
    status: 303,
    headers: {
      "location": "/review",
      "set-cookie": `portico_session=${
        encodeURIComponent(session.token)
      }; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${BROWSER_SESSION_COOKIE_MAX_AGE}`,
    },
  });
}
type ReviewAction = "approve" | "reject" | "withdraw" | "remove" | "restore" | "purge";

function reviewAction(pathname: string): ReviewAction | undefined {
  if (pathname === "/review/approve") return "approve";
  if (pathname === "/review/reject") return "reject";
  if (pathname === "/review/withdraw") return "withdraw";
  if (pathname === "/review/remove") return "remove";
  if (pathname === "/review/restore") return "restore";
  if (pathname === "/review/purge") return "purge";
  return undefined;
}

async function dispatchReview(
  context: ReviewContext,
  actor: Actor,
  action: ReviewAction,
  id: string,
  note: string | undefined,
): Promise<unknown> {
  if (action === "approve") return await context.catalog.approve(actor, { id, note });
  if (action === "reject") return await context.catalog.reject(actor, { id, note });
  if (action === "withdraw") return await context.catalog.withdraw(actor, { id, note });
  if (action === "restore") return await context.catalog.restore(actor, { id });
  if (action === "purge") return await context.catalog.purge(actor, { id });
  return await context.catalog.remove(actor, { id });
}

function statusFor(code: string): number {
  if (code === ErrorCode.FORBIDDEN) return 403;
  if (code === ErrorCode.SELF_APPROVAL) return 409;
  if (code === ErrorCode.NOT_FOUND) return 404;
  if (code === ErrorCode.INVALID_INPUT || code === ErrorCode.USAGE) return 400;
  return 422;
}
function jsonError(status: number, message: string, code = "HTTP_ERROR"): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: securityHeaders("application/json; charset=utf-8"),
  });
}

/**
 * An authorization refusal.
 *
 * It carries `FORBIDDEN` instead of the generic `HTTP_ERROR` so this entrance
 * reports machine-readably what the CLI, Portal and MCP entrances report for
 * the same class of refusal; a client should not have to special-case which
 * door it knocked on. The HTTP status still separates "prove yourself" (401)
 * from "you proved yourself and it is not enough" (403).
 */
function forbidden(status: number, message: string): Response {
  return jsonError(status, message, ErrorCode.FORBIDDEN);
}
function securityHeaders(contentType: string): HeadersInit {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
  };
}
function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: securityHeaders("text/html; charset=utf-8"),
  });
}

/** Same shell and token vocabulary as the internal console. */
function shell(
  request: Request,
  title: string,
  body: string,
): string {
  return renderShell({
    title,
    tone: "internal",
    theme: resolvePageTheme("internal", null, prefersDark(request.headers)),
    path: new URL(request.url).pathname,
    head: `<style>${REVIEW_CSS}</style>`,
    body,
  });
}

const REVIEW_CSS = `
.rv-wrap{min-height:72vh;display:flex;align-items:center;justify-content:center;padding:32px 16px}
.rv-card{max-width:400px;width:100%;padding:28px}
.rv-card h1{font-size:1.25rem;margin:6px 0 4px}
.rv-card .tk-meta{margin:0}
.rv-github{display:block;text-align:center;text-decoration:none;font-weight:600;font-size:0.9rem;color:#f0f3f6;background:#24292f;border:1px solid #444c56;border-radius:8px;padding:10px;margin:16px 0 4px}
.rv-github:hover{background:#2f363d}
.rv-div{display:flex;align-items:center;gap:10px;color:var(--tk-muted);font-size:0.78rem;margin:18px 0 6px}
.rv-div::before,.rv-div::after{content:"";flex:1;border-top:1px solid var(--tk-border, #2a2f36)}
.rv-field{margin:12px 0}
.rv-field label{display:block;font-size:0.8rem;color:var(--tk-muted);margin-bottom:6px}
.rv-field input{display:block;width:100%;box-sizing:border-box;font-size:0.9rem;color:var(--tk-ink);background:var(--tk-sunken);border:1px solid var(--tk-border, #2a2f36);border-radius:8px;padding:9px 10px}
.rv-card .tk-btn{width:100%;margin-top:14px;padding:10px}
.rv-main{max-width:880px;margin:0 auto;padding:32px 20px 64px}
.rv-main h1{font-size:1.4rem;margin:6px 0 4px}
.rv-table td form{display:inline;margin-right:8px}
.rv-empty{color:var(--tk-muted);padding:28px 0}
`;

function renderLoginPage(request: Request, githubEnabled: boolean, error?: string): string {
  const github = githubEnabled
    ? `<a class="rv-github" href="/review/oauth/start">使用 GitHub 登录</a><div class="rv-div"><span>或一次性凭证</span></div>`
    : "";
  const alert = error ? `<p class="tk-note" role="alert">${esc(error)}</p>` : "";
  return shell(
    request,
    "审核登录",
    `  <main class="rv-wrap">
    <div class="tk-panel rv-card">
      <p class="tk-meta">PORTICO · 人工审核</p>
      <h1>审核登录</h1>
      ${alert}
      ${github}
      <form method="post">
        <div class="rv-field"><label for="rv-id">身份</label><input id="rv-id" name="id" autocomplete="username" required></div>
        <div class="rv-field"><label for="rv-token">一次性凭证</label><input id="rv-token" name="token" type="password" autocomplete="current-password" required></div>
        <button class="tk-btn" type="submit">登录</button>
      </form>
      <p class="tk-note" style="margin-top:16px">仅 allowlisted 账号可登录；能审批什么由名册决定。</p>
    </div>
  </main>`,
  );
}
