import { assertEquals } from "./assert.ts";
import { CatalogError } from "../src/catalog/mod.ts";
import type { AuditEvent } from "../src/audit/mod.ts";
import { applyAuditQuery, AUDIT_QUERY_MAX_Q, parseAuditQuery } from "../src/audit/query.ts";

function event(
  id: string,
  extras: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    id,
    kind: extras.kind ?? "catalog",
    at: extras.at ?? "2026-09-14T00:00:00.000Z",
    actor: extras.actor ?? { id: "agent:docs-bot", kind: "agent", role: "maintainer" },
    action: extras.action ?? "register",
    subjectId: extras.subjectId ?? "docs-writer",
    summary: extras.summary ?? "register docs-writer internal",
    entry: extras.entry,
  };
}

function parseError(input: Record<string, unknown>): CatalogError {
  try {
    parseAuditQuery(input);
  } catch (error) {
    return error as CatalogError;
  }
  throw new Error("expected INVALID_INPUT");
}

Deno.test("parseAuditQuery treats empty values as no filter", () => {
  assertEquals(parseAuditQuery({}), {});
  assertEquals(
    parseAuditQuery({ q: "", kind: "", action: "", subject: "" }),
    {},
  );
  assertEquals(
    parseAuditQuery({ q: "   ", kind: null, action: undefined, subject: "  " }),
    {},
  );
});

Deno.test("parseAuditQuery accepts q, kind, action and subject", () => {
  assertEquals(
    parseAuditQuery({
      q: " Writer ",
      kind: "catalog",
      action: "register",
      subject: "docs-writer",
    }),
    {
      q: "Writer",
      kind: "catalog",
      action: "register",
      subject: "docs-writer",
    },
  );
  assertEquals(
    parseAuditQuery({ kind: "approval", action: "withdrawn" }),
    { kind: "approval", action: "withdrawn" },
  );
});

Deno.test("parseAuditQuery rejects unknown kind or action", () => {
  assertEquals(parseError({ kind: "runtime" }).code, "INVALID_INPUT");
  assertEquals(parseError({ action: "execute" }).code, "INVALID_INPUT");
});

Deno.test("parseAuditQuery rejects oversized or control-character q and subject", () => {
  const long = "a".repeat(AUDIT_QUERY_MAX_Q + 1);
  assertEquals(parseError({ q: long }).code, "INVALID_INPUT");
  assertEquals(parseError({ subject: long }).code, "INVALID_INPUT");
  assertEquals(parseError({ q: "docs\nwriter" }).code, "INVALID_INPUT");
  assertEquals(parseError({ subject: "docs\twriter" }).code, "INVALID_INPUT");
});

Deno.test("applyAuditQuery matches id, subject, summary and action, not entry URLs", () => {
  const records = [
    event("chg-1", {
      subjectId: "docs-writer",
      summary: "register docs-writer internal",
      action: "register",
      entry: { kind: "mcp_endpoint", value: "https://secret.example.test/mcp" },
    }),
    event("apr-1", {
      kind: "approval",
      action: "approved",
      subjectId: "docs-web",
      summary: "approved docs-web",
      entry: { kind: "url", value: "https://docs.example.test/portals/docs-writer" },
    }),
  ];

  assertEquals(
    applyAuditQuery(records, { q: "writer" }).map((item) => item.id),
    ["chg-1"],
  );
  assertEquals(
    applyAuditQuery(records, { q: "approved" }).map((item) => item.id),
    ["apr-1"],
  );
  assertEquals(
    applyAuditQuery(records, { q: "chg-1" }).map((item) => item.id),
    ["chg-1"],
  );
  assertEquals(
    applyAuditQuery(records, { q: "https://secret.example.test/mcp" }).map((item) => item.id),
    [],
    "query must not search entry URLs",
  );
  assertEquals(
    applyAuditQuery(records, { q: "docs.example.test" }).map((item) => item.id),
    [],
    "query must not search entry URLs",
  );
});

Deno.test("applyAuditQuery intersects kind, action and subject without reordering", () => {
  const records = [
    event("a", {
      kind: "grant",
      action: "grant",
      subjectId: "agent:docs-bot",
      summary: "grant agent:docs-bot maintainer",
    }),
    event("b", {
      kind: "catalog",
      action: "register",
      subjectId: "docs-writer",
      summary: "register docs-writer internal",
    }),
    event("c", {
      kind: "catalog",
      action: "publish_public_candidate",
      subjectId: "docs-writer",
      summary: "publish_public_candidate docs-writer pending_public",
    }),
    event("d", {
      kind: "approval",
      action: "approved",
      subjectId: "docs-web",
      summary: "approved docs-web",
    }),
  ];

  assertEquals(
    applyAuditQuery(records, { kind: "catalog" }).map((item) => item.id),
    ["b", "c"],
  );
  assertEquals(
    applyAuditQuery(records, { subject: "docs-writer" }).map((item) => item.id),
    ["b", "c"],
  );
  assertEquals(
    applyAuditQuery(records, { kind: "catalog", action: "register" }).map((item) => item.id),
    ["b"],
  );
  assertEquals(
    applyAuditQuery(records, { subject: "docs-web", kind: "grant" }).map((item) => item.id),
    [],
  );
});
