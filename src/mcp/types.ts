/** MCP protocol constants and JSON-RPC shapes. */

import denoConfig from "../../deno.json" with { type: "json" };

export const JSON_RPC_VERSION = "2.0";

/**
 * Version negotiation: echo the client's version when we know it, otherwise
 * answer with our newest. Announcing a version we do not actually implement is
 * worse than a visible mismatch, because the client then trusts a contract
 * nobody kept.
 */
export const LATEST_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2024-11-05",
  "2025-03-26",
  LATEST_PROTOCOL_VERSION,
];

export const SERVER_NAME = "portico";

/** Single source of truth: the version in `deno.json`. */
export const SERVER_VERSION: string = denoConfig.version;

export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** A protocol-level JSON-RPC failure, as opposed to a tool that ran and failed. */
export class McpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "McpRpcError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
