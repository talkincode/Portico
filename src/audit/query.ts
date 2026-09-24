import { CatalogError, ErrorCode } from "../catalog/errors.ts";
import { parseAsOf, withinAsOf } from "./instant.ts";
import type { AuditEvent, AuditKind } from "./types.ts";

/** Longest `q` or `subject` a caller may send. The timeline is a filter, not a dump. */
export const AUDIT_QUERY_MAX_Q = 120;

export const AUDIT_KINDS: readonly AuditKind[] = [
  "catalog",
  "grant",
  "revoke",
  "credential",
  "approval",
  "gateway",
];

export const AUDIT_ACTIONS: readonly string[] = [
  "grant",
  "revoke",
  "revoke_credential",
  "register",
  "draft",
  "publish_internal",
  "publish_public_candidate",
  "update",
  "remove",
  "approved",
  "rejected",
  "withdrawn",
  "allowed",
  "denied",
];

export interface AuditQuery {
  q?: string;
  kind?: AuditKind;
  action?: string;
  subject?: string;
  /** Canonical instant; the timeline ends here. See `parseAsOf`. */
  asOf?: string;
}

/**
 * Shared timeline filter for CLI / Portal / MCP.
 *
 * The auditor check happens *before* this runs (`AuditService.list`). Querying
 * never searches entry URLs or package coordinates, so a guess at an internal
 * endpoint cannot confirm it exists on the audit trail either.
 */
export function parseAuditQuery(input: {
  q?: unknown;
  kind?: unknown;
  action?: unknown;
  subject?: unknown;
  asOf?: unknown;
}): AuditQuery {
  const query: AuditQuery = {};
  const q = optionalString(input.q, "q");
  if (q !== undefined) query.q = q;
  const kind = optionalKind(input.kind);
  if (kind !== undefined) query.kind = kind;
  const action = optionalAction(input.action);
  if (action !== undefined) query.action = action;
  const subject = optionalString(input.subject, "subject");
  if (subject !== undefined) query.subject = subject;
  const asOf = parseAsOf(input.asOf);
  if (asOf !== undefined) query.asOf = asOf;
  return query;
}

export function applyAuditQuery(
  events: AuditEvent[],
  query: AuditQuery,
): AuditEvent[] {
  const needle = query.q?.toLowerCase();
  return events.filter((event) => {
    if (!withinAsOf(event.at, query.asOf)) return false;
    if (query.kind && event.kind !== query.kind) return false;
    if (query.action && event.action !== query.action) return false;
    if (query.subject && event.subjectId !== query.subject) return false;
    if (!needle) return true;
    return [event.id, event.subjectId, event.summary, event.action].some((field) =>
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
  if (trimmed.length > AUDIT_QUERY_MAX_Q) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `${field} must be at most ${AUDIT_QUERY_MAX_Q} characters`,
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

function optionalKind(value: unknown): AuditKind | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "kind must be a string");
  }
  if (value.trim() === "") return undefined;
  if (!AUDIT_KINDS.includes(value as AuditKind)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `kind must be one of: ${AUDIT_KINDS.join(", ")}`,
    );
  }
  return value as AuditKind;
}

function optionalAction(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, "action must be a string");
  }
  if (value.trim() === "") return undefined;
  if (!AUDIT_ACTIONS.includes(value)) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `action must be one of: ${AUDIT_ACTIONS.join(", ")}`,
    );
  }
  return value;
}
