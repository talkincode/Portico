import { AccessService } from "../access/mod.ts";
import { AuditService } from "../audit/mod.ts";
import {
  type Actor,
  type ActorKind,
  type ActorRole,
  CatalogError,
  CatalogService,
  ErrorCode,
} from "../catalog/mod.ts";
import type { GatewayService } from "../gateway/mod.ts";
import { dashboardFrom, renderDiscoveryPage } from "./html.ts";

export interface PortalContext {
  catalog: CatalogService;
  access: AccessService;
  gateway?: GatewayService;
}

const ACTOR_KINDS = new Set<ActorKind>(["human", "agent"]);
const ACTOR_ROLES = new Set<ActorRole>(["reader", "maintainer", "auditor", "anonymous"]);

export async function handlePortalRequest(
  request: Request,
  context: PortalContext,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const actor = await resolveActor(request, context.access);
    if (request.method !== "GET") {
      return jsonError(405, ErrorCode.USAGE, "method not allowed");
    }
    if (url.pathname === "/api/catalog") {
      return jsonOk(await context.catalog.list(actor));
    }
    const catalogItem = url.pathname.match(/^\/api\/catalog\/([a-z][a-z0-9-]{1,62})$/);
    if (catalogItem) {
      return jsonOk(await context.catalog.get(actor, catalogItem[1]));
    }
    if (url.pathname === "/api/mcp") {
      return jsonOk(await context.catalog.listMcp(actor));
    }
    const mcpItem = url.pathname.match(/^\/api\/mcp\/([a-z][a-z0-9-]{1,62})$/);
    if (mcpItem) {
      return jsonOk(await context.catalog.describeMcp(actor, mcpItem[1]));
    }
    if (url.pathname === "/api/audit") {
      const audit = new AuditService(context.catalog, context.access, context.gateway);
      return jsonOk(await audit.list(actor));
    }
    if (url.pathname === "/api/dashboard") {
      const surfaces = await context.catalog.list(actor);
      return jsonOk(dashboardFrom(surfaces));
    }
    if (url.pathname === "/") {
      const surfaces = await context.catalog.list(actor);
      return html(renderDiscoveryPage(dashboardFrom(surfaces)));
    }
    return jsonError(404, ErrorCode.NOT_FOUND, "not found");
  } catch (error) {
    return fail(error);
  }
}

async function resolveActor(request: Request, access: AccessService): Promise<Actor> {
  const id = request.headers.get("x-portico-actor-id");
  const kind = request.headers.get("x-portico-actor-kind");
  const role = request.headers.get("x-portico-actor-role");
  if (!id && !kind && !role) {
    return { id: "anonymous", kind: "human", role: "anonymous" };
  }
  if (!id || !kind || !role) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "actor headers must include id, kind, and role together",
    );
  }
  if (!ACTOR_KINDS.has(kind as ActorKind) || !ACTOR_ROLES.has(role as ActorRole)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "actor kind or role is invalid");
  }
  const claimed: Actor = {
    id,
    kind: kind as ActorKind,
    role: role as ActorRole,
  };
  if (claimed.role === "anonymous") return claimed;
  return await access.resolve(claimed);
}

function jsonOk(data: unknown): Response {
  return json(200, { ok: true, data });
}

function jsonError(status: number, code: string, message: string): Response {
  return json(status, { ok: false, error: { code, message } });
}

function fail(error: unknown): Response {
  if (error instanceof CatalogError) {
    const status = statusFor(error.code);
    return jsonError(status, error.code, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return jsonError(500, "INTERNAL", message);
}

function statusFor(code: string): number {
  if (code === ErrorCode.NOT_FOUND) return 404;
  if (code === ErrorCode.FORBIDDEN || code === ErrorCode.SELF_APPROVAL) return 403;
  if (code === ErrorCode.USAGE) return 405;
  return 400;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: securityHeaders("application/json; charset=utf-8"),
  });
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: securityHeaders("text/html; charset=utf-8"),
  });
}

function securityHeaders(contentType: string): HeadersInit {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  };
}
