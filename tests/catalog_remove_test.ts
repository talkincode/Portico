import { assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";

const maintainer: Actor = { id: "agent:docs-bot", kind: "agent", role: "maintainer" };
const auditor: Actor = { id: "human:security-auditor", kind: "human", role: "auditor" };
const reader: Actor = { id: "human:reader", kind: "human", role: "reader" };

function surface(): RegisterInput {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Writes internal docs.",
    channels: ["cli"],
    version: "0.1.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: maintainer.id, kind: "agent" }],
  };
}

Deno.test("a maintainer can remove an internal surface and the change is kept", async () => {
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, surface());
  const removed = await catalog.remove(maintainer, { id: "docs-writer" });
  assertEquals(removed, { id: "docs-writer" });
  await assertRejectsCode(() => catalog.get(maintainer, "docs-writer"), "NOT_FOUND");
  const changes = await catalog.listChanges(auditor);
  assertEquals(changes.at(-1)?.action, "remove");
  assertEquals(await catalog.listApprovals(auditor), []);
});

Deno.test("remove refuses readers and records still on the public boundary", async () => {
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, surface());
  await assertRejectsCode(() => catalog.remove(reader, { id: "docs-writer" }), "FORBIDDEN");
  await catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await assertRejectsCode(
    () => catalog.remove(auditor, { id: "docs-writer" }),
    "INVALID_STATE",
  );
  await catalog.approve(auditor, { id: "docs-writer" });
  await assertRejectsCode(
    () => catalog.remove(maintainer, { id: "docs-writer" }),
    "INVALID_STATE",
  );
  const still = await catalog.get(auditor, "docs-writer");
  assertEquals(still.governanceState, "approved_public");
});
