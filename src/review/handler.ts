import { AccessService } from "../access/mod.ts";
import { readSessionToken } from "../access/session-header.ts";
import { CatalogError, CatalogService, ErrorCode } from "../catalog/mod.ts";
import type { Actor, RegisterInput } from "../catalog/mod.ts";
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
      url.pathname !== "/review/api/submit"
    ) return new Response("Not found", { status: 404 });
    const actor = await resolveActor(request, context);
    if (request.method === "GET") {
      if (url.pathname !== "/review" && url.pathname !== "/review/") {
        return new Response("Not found", { status: 404 });
      }
      if (actor.role === "anonymous") return forbidden(401, "authentication required");
      const records = (await context.catalog.list(actor)).filter((item) =>
        item.governanceState === "pending_public"
      );
      return new Response(renderReview(actor, records), {
        headers: securityHeaders("text/html; charset=utf-8"),
      });
    }
    if (request.method !== "POST") return jsonError(405, "method not allowed");
    if (actor.role === "anonymous") return forbidden(401, "authentication required");
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
    if (url.pathname !== "/review/approve" && url.pathname !== "/review/reject") {
      return jsonError(405, "POST only at /review/approve or /review/reject");
    }
    const contentType = request.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await request.json() as { id?: unknown }
      : Object.fromEntries((await request.formData()).entries()) as { id?: unknown };
    const action = url.pathname.endsWith("/approve") ? "approve" : "reject";
    if (typeof body.id !== "string") return jsonError(400, "expected {id}");
    const result = action === "approve"
      ? await context.catalog.approve(actor, { id: body.id })
      : await context.catalog.reject(actor, { id: body.id });
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
  const token = readSessionToken(request) ?? readSessionCookie(request);
  if (token) return await context.access.resolveSession(token);
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

function anonymous(): Actor {
  return { id: "anonymous", kind: "human", role: "anonymous" };
}
/**
 * GitHub OAuth login (mira pattern, Review-only). The state token is a
 * short-lived CSRF binding held in an HttpOnly cookie, never in the URL
 * beyond the provider round-trip. Only allowlisted GitHub logins/emails
 * proceed, and only to the roster human their verified email matches —
 * GitHub never grants a role by itself.
 */
function handleOauthStart(context: ReviewContext): Response {
  if (!context.github) return jsonError(501, "github login is not configured");
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

async function handleOauthCallback(request: Request, context: ReviewContext): Promise<Response> {
  if (!context.github) return jsonError(501, "github login is not configured");
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(request, "portico_oauth_state");
  if (!code || !state || !expected || state !== expected) {
    return jsonError(400, "invalid oauth callback");
  }
  let user;
  try {
    user = await context.github.exchange(context.github.config, code);
  } catch {
    return jsonError(502, "github exchange failed");
  }
  if (!isAllowedGithubUser(user, context.github.config.allowlist)) {
    return jsonError(403, "this GitHub account is not allowlisted");
  }
  const emails = [user.email, ...user.emails].filter((email): email is string => !!email);
  let session = null;
  for (const email of emails) {
    try {
      session = await context.access.createBrowserSession(email);
      break;
    } catch {
      // Try the next verified email; a roster miss is not fatal yet.
    }
  }
  if (!session) {
    return jsonError(
      403,
      `no roster human matches this login (${
        emails[0] ?? "no email"
      }); ask the operator to bind it`,
    );
  }
  return new Response(null, {
    status: 303,
    headers: {
      "location": "/review",
      "set-cookie": [
        `portico_session=${
          encodeURIComponent(session.token)
        }; Path=/review; Secure; HttpOnly; SameSite=Lax`,
        "portico_oauth_state=; Path=/review/oauth/callback; Max-Age=0",
      ].join(", "),
    },
  });
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
    const github = context.github
      ? `<p><a href="/review/oauth/start">Sign in with GitHub</a></p>`
      : "";
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Portico review login</title>${github}<form method="post"><label>Identity <input name="id" required></label><label>One-time credential <input name="token" type="password" required></label><button>Sign in</button></form>`,
      { headers: securityHeaders("text/html; charset=utf-8") },
    );
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
      }; Path=/review; Secure; HttpOnly; SameSite=Lax`,
    },
  });
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
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
function renderReview(
  actor: Actor,
  records: Array<{ id: string; name: string; publicSubmission?: { submittedBy: { id: string } } }>,
): string {
  const cards = records.map((record) =>
    `<li><strong>${escape(record.name)}</strong> <code>${
      escape(record.id)
    }</code><br><form method="post" action="/review/approve"><input type="hidden" name="id" value="${
      escape(record.id)
    }"><button>Approve</button></form> <form method="post" action="/review/reject"><input type="hidden" name="id" value="${
      escape(record.id)
    }"><button>Reject</button></form></li>`
  ).join("");
  return `<!doctype html><meta charset="utf-8"><title>Portico review</title><main><h1>Human review</h1><p>Signed in as ${
    escape(actor.id)
  }.</p><ul>${cards || "<li>No pending public candidates.</li>"}</ul></main>`;
}
