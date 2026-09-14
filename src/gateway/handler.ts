import { AccessService } from "../access/mod.ts";
import { readSessionToken } from "../access/session-header.ts";
import {
  type Actor,
  type ActorKind,
  type ActorRole,
  CatalogError,
  ErrorCode,
} from "../catalog/mod.ts";
import type { GatewayService } from "./service.ts";

export interface GatewayContext {
  access: AccessService;
  gateway: GatewayService;
}

const ACTOR_KINDS = new Set<ActorKind>(["human", "agent"]);
const ACTOR_ROLES = new Set<ActorRole>(["reader", "maintainer", "auditor", "anonymous"]);
const AUTHORIZE = /^\/gateway\/mcp\/([a-z][a-z0-9-]{1,62})\/authorize$/;

export async function handleGatewayRequest(
  request: Request,
  context: GatewayContext,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (isToolExecution(request, url.pathname)) {
      return jsonError(405, ErrorCode.USAGE, "gateway does not execute tools");
    }

    const actor = await resolveActor(request, context.access);
    const authorize = url.pathname.match(AUTHORIZE);
    if (authorize) {
      if (request.method !== "POST") {
        return jsonError(405, ErrorCode.USAGE, "method not allowed");
      }
      return jsonOk(await context.gateway.authorize(actor, authorize[1]));
    }
    if (url.pathname === "/gateway/audit") {
      if (request.method !== "GET") {
        return jsonError(405, ErrorCode.USAGE, "method not allowed");
      }
      return jsonOk(await context.gateway.listAudit(actor));
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError(405, ErrorCode.USAGE, "gateway does not execute tools");
    }
    return jsonError(404, ErrorCode.NOT_FOUND, "not found");
  } catch (error) {
    return fail(error);
  }
}

function isToolExecution(request: Request, pathname: string): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  if (pathname.endsWith("/authorize") || pathname === "/gateway/audit") return false;
  return true;
}

async function resolveActor(request: Request, access: AccessService): Promise<Actor> {
  return await access.resolveRequestActor({
    sessionToken: readSessionToken(request),
    claimed: readClaimedActor(request),
  });
}

function readClaimedActor(request: Request): Actor | null {
  const id = request.headers.get("x-portico-actor-id");
  const kind = request.headers.get("x-portico-actor-kind");
  const role = request.headers.get("x-portico-actor-role");
  if (!id && !kind && !role) return null;
  if (!id || !kind || !role) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "actor headers must include id, kind, and role together",
    );
  }
  if (!ACTOR_KINDS.has(kind as ActorKind) || !ACTOR_ROLES.has(role as ActorRole)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "actor kind or role is invalid");
  }
  return {
    id,
    kind: kind as ActorKind,
    role: role as ActorRole,
  };
}

function jsonOk(data: unknown): Response {
  return json(200, { ok: true, data });
}

function jsonError(status: number, code: string, message: string): Response {
  return json(status, { ok: false, error: { code, message } });
}

function fail(error: unknown): Response {
  if (error instanceof CatalogError) {
    return jsonError(statusFor(error.code), error.code, error.message);
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
