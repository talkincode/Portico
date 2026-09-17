import { assertEquals } from "./assert.ts";
import { type AgentSurface, type GovernanceState } from "../src/catalog/mod.ts";
import { dashboardFrom } from "../src/catalog/dashboard.ts";

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

Deno.test("dashboardFrom counts every governance state, not just internal and approved", () => {
  const states: GovernanceState[] = [
    "draft",
    "internal",
    "pending_public",
    "approved_public",
    "rejected",
  ];
  const surfaces = states.map((state, index) =>
    surface(`surface-${state}`, {
      governanceState: state,
      updatedAt: `2026-09-1${index}T00:00:00.000Z`,
    })
  );

  const view = dashboardFrom(surfaces);

  assertEquals(view.counts, {
    visible: 5,
    draft: 1,
    internal: 1,
    pending_public: 1,
    approved_public: 1,
    rejected: 1,
  });
});

Deno.test("dashboardFrom orders surfaces by updatedAt descending without mutating the input", () => {
  const oldest = surface("oldest", { updatedAt: "2026-09-10T00:00:00.000Z" });
  const newest = surface("newest", { updatedAt: "2026-09-16T00:00:00.000Z" });
  const middle = surface("middle", { updatedAt: "2026-09-13T00:00:00.000Z" });
  const input = [oldest, newest, middle];

  const view = dashboardFrom(input);

  assertEquals(view.surfaces.map((item) => item.id), ["newest", "middle", "oldest"]);
  assertEquals(input.map((item) => item.id), ["oldest", "newest", "middle"]);
});

Deno.test("dashboardFrom on an empty catalog returns zeroed counts and no surfaces", () => {
  const view = dashboardFrom([]);

  assertEquals(view.counts, {
    visible: 0,
    draft: 0,
    internal: 0,
    pending_public: 0,
    approved_public: 0,
    rejected: 0,
  });
  assertEquals(view.surfaces, []);
});
