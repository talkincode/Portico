import { AccessService } from "../access/mod.ts";
import { readSessionToken } from "../access/session-header.ts";
import { AuditService, type ConclusionService } from "../audit/mod.ts";
import { type Actor, CatalogError, CatalogService } from "../catalog/mod.ts";
import type { GatewayService } from "../gateway/mod.ts";
import type { PageService } from "../ui/mod.ts";
import { callTool, isTool, TOOLS } from "./tools.ts";
import {
  isRecord,
  JSON_RPC_VERSION,
  JsonRpcErrorCode,
  LATEST_PROTOCOL_VERSION,
  McpRpcError,
  SERVER_NAME,
  SERVER_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "./types.ts";

/**
 * JSON-RPC 2.0 dispatch for the MCP entrance, over HTTP.
 *
 * Authentication is session-only: a network caller must present a login
 * session (`Authorization: Bearer` / `X-Portico-Session`). Portico's own
 * identities are never taken from a claimed header here, because a header is
 * not proof of an identity.
 */

export interface McpContext {
  catalog: CatalogService;
  access: AccessService;
  /** Present when a Gateway audit path is configured; feeds `portico_audit`. */
  gateway?: GatewayService;
  /** Present when a page path is configured; feeds `portico_page`. */
  pages?: PageService;
  /** Present when a conclusion path is configured; feeds `portico_conclusions`. */
  conclusions?: ConclusionService;
}

export async function handleMcpRequest(
  request: Request,
  context: McpContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return rpcFailure(
      null,
      JsonRpcErrorCode.INVALID_REQUEST,
      "the MCP entrance accepts JSON-RPC over POST",
      405,
    );
  }

  let actor: Actor;
  try {
    actor = await context.access.resolveRequestActor({
      sessionToken: readSessionToken(request),
      claimed: null,
    });
  } catch (error) {
    const message = error instanceof CatalogError ? error.message : "session is not valid";
    return rpcFailure(null, JsonRpcErrorCode.INVALID_REQUEST, message, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpcFailure(null, JsonRpcErrorCode.PARSE_ERROR, "request body must be JSON", 400);
  }
  if (Array.isArray(payload)) {
    return rpcFailure(
      null,
      JsonRpcErrorCode.INVALID_REQUEST,
      "batched requests are not supported",
      400,
    );
  }
  if (!isRecord(payload) || payload.jsonrpc !== JSON_RPC_VERSION) {
    return rpcFailure(
      null,
      JsonRpcErrorCode.INVALID_REQUEST,
      `jsonrpc must be "${JSON_RPC_VERSION}"`,
      400,
    );
  }
  if (typeof payload.method !== "string") {
    return rpcFailure(null, JsonRpcErrorCode.INVALID_REQUEST, "method is required", 400);
  }

  const id = payload.id ?? null;
  const notification = payload.id === undefined;

  try {
    const result = await dispatch(payload.method, payload.params, actor, context);
    // A notification has no reply by definition; 202 is the only honest answer.
    if (notification) {
      return new Response(null, { status: 202, headers: baseHeaders() });
    }
    return jsonRpc(200, { jsonrpc: JSON_RPC_VERSION, id, result });
  } catch (error) {
    if (error instanceof McpRpcError) {
      return jsonRpc(200, {
        jsonrpc: JSON_RPC_VERSION,
        id,
        error: { code: error.code, message: error.message },
      });
    }
    return jsonRpc(200, {
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: {
        code: JsonRpcErrorCode.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function dispatch(
  method: string,
  params: unknown,
  actor: Actor,
  context: McpContext,
): Promise<unknown> {
  switch (method) {
    case "initialize":
      return initialize(params);
    case "notifications/initialized":
      return {};
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call":
      return await toolsCall(actor, params, context);
    default:
      throw new McpRpcError(
        JsonRpcErrorCode.METHOD_NOT_FOUND,
        `unknown method '${method}'`,
      );
  }
}

function initialize(params: unknown): unknown {
  const requested = isRecord(params) && typeof params.protocolVersion === "string"
    ? params.protocolVersion
    : undefined;
  const protocolVersion = requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, title: "Portico", version: SERVER_VERSION },
    instructions:
      "Portico 是 Agent 的治理门户：Agent 不在这里运行，只在这里被登记、发现、授权和访问。这些工具只读；公开可见性来自独立的人类审计审批。",
  };
}

async function toolsCall(
  actor: Actor,
  params: unknown,
  context: McpContext,
): Promise<unknown> {
  if (!isRecord(params) || typeof params.name !== "string") {
    throw new McpRpcError(JsonRpcErrorCode.INVALID_PARAMS, "tools/call requires a 'name'");
  }
  const name = params.name;
  if (!isTool(name)) {
    throw new McpRpcError(JsonRpcErrorCode.INVALID_PARAMS, `unknown tool '${name}'`);
  }

  // The tool result is the same `{ok,data}` / `{ok,error:{code,message}}`
  // envelope the CLI prints, so "the three entrances agree" is checkable by
  // comparing payloads rather than by reading three implementations.
  try {
    const data = await callTool(actor, name, params.arguments, {
      catalog: context.catalog,
      audit: new AuditService(context.catalog, context.access, context.gateway),
      access: context.access,
      pages: context.pages,
      gateway: context.gateway,
      conclusions: context.conclusions,
    });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }) }] };
  } catch (error) {
    const code = error instanceof CatalogError ? error.code : "INTERNAL";
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code, message } }) }],
      isError: true,
    };
  }
}

function baseHeaders(): HeadersInit {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'",
  };
}

function jsonRpc(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...baseHeaders(), "content-type": "application/json; charset=utf-8" },
  });
}

function rpcFailure(
  id: string | number | null,
  code: number,
  message: string,
  status: number,
): Response {
  return jsonRpc(status, { jsonrpc: JSON_RPC_VERSION, id, error: { code, message } });
}
