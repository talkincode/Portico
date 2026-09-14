import { AccessService } from "../access/mod.ts";
import { readSessionToken } from "../access/session-header.ts";
import { type Actor, CatalogError, ErrorCode } from "../catalog/mod.ts";
import type { GatewayService } from "./service.ts";

export interface GatewayContext {
  access: AccessService;
  gateway: GatewayService;
}

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

/**
 * Gateway callers prove who they are with a session, or they are anonymous.
 * No `X-Portico-Actor-*` path: a header is not proof of an identity.
 */
async function resolveActor(request: Request, access: AccessService): Promise<Actor> {
  return await access.resolveRequestActor({
    sessionToken: readSessionToken(request),
  });
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
