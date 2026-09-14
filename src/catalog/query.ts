import { CatalogError, ErrorCode } from "./errors.ts";
import type { AgentSurface, Channel, GovernanceState } from "./types.ts";

/** Longest `q` a caller may send. Discovery is a filter, not a dump. */
export const CATALOG_QUERY_MAX_Q = 120;

export const CATALOG_CHANNELS: readonly Channel[] = ["cli", "mcp", "web"];
export const CATALOG_GOVERNANCE_STATES: readonly GovernanceState[] = [
  "draft",
  "internal",
  "pending_public",
  "approved_public",
  "rejected",
];

export interface CatalogQuery {
  q?: string;
  channel?: Channel;
  governanceState?: GovernanceState;
}

/**
 * Shared list filter for CLI / Portal / MCP.
 *
 * Visibility is applied *before* this runs (`CatalogService.list`). Querying
 * never searches entry URLs or package coordinates, so a guess at an internal
 * endpoint cannot confirm it exists.
 */
export function parseCatalogQuery(input: {
  q?: unknown;
  channel?: unknown;
  state?: unknown;
  governanceState?: unknown;
}): CatalogQuery {
  const query: CatalogQuery = {};
  const q = optionalString(input.q, "q");
  if (q !== undefined) query.q = q;
  const channel = optionalChannel(input.channel);
  if (channel !== undefined) query.channel = channel;
  const fromState = optionalGovernanceState(input.state, "state");
  const fromGovernance = optionalGovernanceState(input.governanceState, "governanceState");
  if (fromState && fromGovernance && fromState !== fromGovernance) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      "state and governanceState must agree when both are set",
    );
  }
  const governanceState = fromState ?? fromGovernance;
  if (governanceState !== undefined) query.governanceState = governanceState;
  return query;
}

export function applyCatalogQuery(
  surfaces: AgentSurface[],
  query: CatalogQuery,
): AgentSurface[] {
  const needle = query.q?.toLowerCase();
  return surfaces.filter((surface) => {
    if (query.channel && !surface.channels.includes(query.channel)) return false;
    if (query.governanceState && surface.governanceState !== query.governanceState) {
      return false;
    }
    if (!needle) return true;
    return [surface.id, surface.name, surface.description].some((field) =>
      field.toLowerCase().includes(needle)
    );
  });
}

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > CATALOG_QUERY_MAX_Q) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `${field} must be at most ${CATALOG_QUERY_MAX_Q} characters`,
    );
  }
  if (hasControlChars(trimmed)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `${field} must not contain control characters`,
    );
  }
  return trimmed;
}

function optionalChannel(value: unknown): Channel | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "channel must be a string");
  }
  if (value.trim() === "") return undefined;
  if (!CATALOG_CHANNELS.includes(value as Channel)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `channel must be one of: ${CATALOG_CHANNELS.join(", ")}`,
    );
  }
  return value as Channel;
}

function optionalGovernanceState(
  value: unknown,
  field: string,
): GovernanceState | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `${field} must be a string`);
  }
  if (value.trim() === "") return undefined;
  if (!CATALOG_GOVERNANCE_STATES.includes(value as GovernanceState)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `${field} must be one of: ${CATALOG_GOVERNANCE_STATES.join(", ")}`,
    );
  }
  return value as GovernanceState;
}
