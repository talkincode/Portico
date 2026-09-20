import { AccessService } from "../access/mod.ts";
import { readSessionToken } from "../access/session-header.ts";
import { CatalogError, CatalogService, ErrorCode } from "../catalog/mod.ts";
import type { Actor, RegisterInput } from "../catalog/mod.ts";

export interface ReviewContext {
  catalog: CatalogService;
  access: AccessService;
}

export async function handleReviewRequest(
  request: Request,
  context: ReviewContext,
): Promise<Response> {
  try {
    const token = readSessionToken(request) ?? readSessionCookie(request);
    const url = new URL(request.url);
    if (url.pathname === "/review/login") return await handleLogin(request, context);
    if (
      url.pathname !== "/review" && url.pathname !== "/review/" &&
      url.pathname !== "/review/approve" && url.pathname !== "/review/reject" &&
      url.pathname !== "/review/api/submit"
    ) return new Response("Not found", { status: 404 });
    const actor = token ? await context.access.resolveSession(token) : anonymous();
    if (request.method === "GET") {
      if (url.pathname !== "/review" && url.pathname !== "/review/") {
        return new Response("Not found", { status: 404 });
      }
      if (actor.role === "anonymous") return jsonError(401, "authentication required");
      const records = (await context.catalog.list(actor)).filter((item) =>
        item.governanceState === "pending_public"
      );
      return new Response(renderReview(actor, records), {
        headers: securityHeaders("text/html; charset=utf-8"),
      });
    }
    if (request.method !== "POST") return jsonError(405, "method not allowed");
    if (actor.role === "anonymous") return jsonError(401, "authentication required");
    if (url.pathname === "/review/api/submit") {
      if (actor.role !== "maintainer") {
        return jsonError(403, "only an authenticated maintainer may submit");
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
      return new Response(JSON.stringify({ ok: true, data: await context.catalog.get(actor, submitted.id) }), {
        headers: securityHeaders("application/json; charset=utf-8"),
      });
    }
    if (actor.kind !== "human" || actor.role !== "auditor") {
      return jsonError(403, "only a human auditor may review");
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

function anonymous(): Actor {
  return { id: "anonymous", kind: "human", role: "anonymous" };
}
function readSessionCookie(request: Request): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)portico_session=([^;]+)/.exec(cookies);
  return match ? decodeURIComponent(match[1]) : null;
}
async function handleLogin(request: Request, context: ReviewContext): Promise<Response> {
  if (request.method === "GET") {
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Portico review login</title><form method="post"><label>Identity <input name="id" required></label><label>One-time credential <input name="token" type="password" required></label><button>Sign in</button></form>`,
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
    return jsonError(403, "browser review login is for humans only");
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
  }.</p><ul>${
    cards || "<li>No pending public candidates.</li>"
  }</ul></main>`;
}
