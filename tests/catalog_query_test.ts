import { assertEquals } from "./assert.ts";
import {
  type AgentSurface,
  CatalogError,
  type Channel,
  type GovernanceState,
} from "../src/catalog/mod.ts";
import {
  applyCatalogQuery,
  CATALOG_QUERY_MAX_Q,
  parseCatalogQuery,
} from "../src/catalog/query.ts";

function surface(
  id: string,
  extras: Partial<AgentSurface> = {},
): AgentSurface {
  return {
    id,
    name: extras.name ?? id,
    description: extras.description ?? "",
    channels: extras.channels ?? ["web"],
    version: extras.version ?? "1.0.0",
    visibility: extras.visibility ?? "internal",
    entry: extras.entry ?? { kind: "url", value: `https://example.test/${id}` },
    maintainers: extras.maintainers ?? [{ id: "agent:docs-bot", kind: "agent" }],
    governanceState: extras.governanceState ?? "internal",
    createdAt: extras.createdAt ?? "2026-09-14T00:00:00.000Z",
    updatedAt: extras.updatedAt ?? "2026-09-14T00:00:00.000Z",
  };
}

Deno.test("parseCatalogQuery treats empty values as no filter", () => {
  assertEquals(parseCatalogQuery({}), {});
  assertEquals(parseCatalogQuery({ q: "", channel: "", governanceState: "" }), {});
  assertEquals(parseCatalogQuery({ q: "   ", channel: null, state: undefined }), {});
});

Deno.test("parseCatalogQuery accepts q, channel and state", () => {
  assertEquals(
    parseCatalogQuery({ q: " Docs ", channel: "cli", state: "internal" }),
    { q: "Docs", channel: "cli", governanceState: "internal" },
  );
  assertEquals(
    parseCatalogQuery({ q: "writer", governanceState: "approved_public" }),
    { q: "writer", governanceState: "approved_public" },
  );
});

Deno.test("parseCatalogQuery rejects disagreeing state aliases", () => {
  const mismatch = (): CatalogError => {
    try {
      parseCatalogQuery({ state: "internal", governanceState: "approved_public" });
    } catch (error) {
      return error as CatalogError;
    }
    throw new Error("expected INVALID_INPUT");
  };
  assertEquals(mismatch().code, "INVALID_INPUT");
});

Deno.test("parseCatalogQuery rejects unknown channel or state", () => {
  const badChannel = (): CatalogError => {
    try {
      parseCatalogQuery({ channel: "carrier-pigeon" });
    } catch (error) {
      return error as CatalogError;
    }
    throw new Error("expected INVALID_INPUT");
  };
  assertEquals(badChannel().code, "INVALID_INPUT");

  const badState = (): CatalogError => {
    try {
      parseCatalogQuery({ state: "public" });
    } catch (error) {
      return error as CatalogError;
    }
    throw new Error("expected INVALID_INPUT");
  };
  assertEquals(badState().code, "INVALID_INPUT");
});

Deno.test("parseCatalogQuery rejects oversized or control-character q", () => {
  const long = "a".repeat(CATALOG_QUERY_MAX_Q + 1);
  const tooLong = (): CatalogError => {
    try {
      parseCatalogQuery({ q: long });
    } catch (error) {
      return error as CatalogError;
    }
    throw new Error("expected INVALID_INPUT");
  };
  assertEquals(tooLong().code, "INVALID_INPUT");

  const control = (): CatalogError => {
    try {
      parseCatalogQuery({ q: "docs\nwriter" });
    } catch (error) {
      return error as CatalogError;
    }
    throw new Error("expected INVALID_INPUT");
  };
  assertEquals(control().code, "INVALID_INPUT");
});

Deno.test("applyCatalogQuery matches id, name and description, not entry URLs", () => {
  const records = [
    surface("docs-writer", {
      name: "Docs Writer",
      description: "Drafts internal documentation.",
      channels: ["cli"],
      entry: { kind: "package", value: "jsr:@secret/internal-cli" },
    }),
    surface("docs-web", {
      name: "Docs Web",
      description: "External documentation portal.",
      channels: ["web"],
      governanceState: "approved_public",
      visibility: "public",
    }),
  ];

  assertEquals(
    applyCatalogQuery(records, { q: "writer" }).map((item) => item.id),
    ["docs-writer"],
  );
  assertEquals(
    applyCatalogQuery(records, { q: "PORTAL" }).map((item) => item.id),
    ["docs-web"],
  );
  assertEquals(
    applyCatalogQuery(records, { q: "docs-writer" }).map((item) => item.id),
    ["docs-writer"],
  );
  assertEquals(
    applyCatalogQuery(records, { q: "jsr:@secret/internal-cli" }).map((item) => item.id),
    [],
    "query must not search entry coordinates",
  );
});

Deno.test("applyCatalogQuery intersects channel and governance state without reordering", () => {
  const records = [
    surface("alpha-web", { channels: ["web"], governanceState: "internal" }),
    surface("beta-cli", { channels: ["cli"], governanceState: "internal" }),
    surface("gamma-web", {
      channels: ["web"],
      governanceState: "approved_public",
      visibility: "public",
    }),
  ];
  const filtered = applyCatalogQuery(records, {
    channel: "web" as Channel,
    governanceState: "internal" as GovernanceState,
  });
  assertEquals(filtered.map((item) => item.id), ["alpha-web"]);
  assertEquals(applyCatalogQuery(records, {}).map((item) => item.id), [
    "alpha-web",
    "beta-cli",
    "gamma-web",
  ]);
});
