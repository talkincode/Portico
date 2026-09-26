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

Deno.test("removed surfaces wait in the trash and can be restored to their state", async () => {
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, surface());
  await catalog.remove(maintainer, { id: "docs-writer" });

  const trashed = await catalog.trash(auditor);
  assertEquals(trashed.length, 1);
  assertEquals(trashed[0].record.id, "docs-writer");
  assertEquals(trashed[0].previousState, "internal");
  assertEquals(trashed[0].deletedBy, { id: maintainer.id, kind: "agent" });
  // The trash is not a discovery surface: live reads stay empty.
  await assertRejectsCode(() => catalog.get(maintainer, "docs-writer"), "NOT_FOUND");
  assertEquals(await catalog.list(maintainer), []);
  // Readers learn nothing about the trash.
  await assertRejectsCode(() => catalog.trash(reader), "FORBIDDEN");

  const restored = await catalog.restore(auditor, { id: "docs-writer" });
  assertEquals(restored.governanceState, "internal");
  assertEquals((await catalog.get(maintainer, "docs-writer")).name, "Docs Writer");
  assertEquals(await catalog.trash(auditor), []);
  const changes = await catalog.listChanges(auditor);
  assertEquals(changes.map((change) => change.action), ["register", "remove", "restore"]);
});

Deno.test("restore and purge refuse the wrong roles and unknown ids", async () => {
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, surface());
  await catalog.remove(maintainer, { id: "docs-writer" });

  await assertRejectsCode(() => catalog.restore(reader, { id: "docs-writer" }), "FORBIDDEN");
  await assertRejectsCode(() => catalog.purge(maintainer, { id: "docs-writer" }), "FORBIDDEN");
  await assertRejectsCode(() => catalog.restore(auditor, { id: "missing" }), "NOT_FOUND");
  await assertRejectsCode(() => catalog.purge(auditor, { id: "missing" }), "NOT_FOUND");

  const purged = await catalog.purge(auditor, { id: "docs-writer" });
  assertEquals(purged, { id: "docs-writer" });
  assertEquals(await catalog.trash(auditor), []);
  const changes = await catalog.listChanges(auditor);
  assertEquals(changes.map((change) => change.action), ["register", "remove", "purge"]);
  // A purged id is free again; a trashed id is reserved.
  await catalog.register(maintainer, surface());
  assertEquals((await catalog.get(maintainer, "docs-writer")).governanceState, "internal");
});

Deno.test("a trashed id cannot be re-registered until it is restored or purged", async () => {
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, surface());
  await catalog.remove(maintainer, { id: "docs-writer" });
  await assertRejectsCode(() => catalog.register(maintainer, surface()), "INVALID_STATE");
  await assertRejectsCode(() => catalog.draft(maintainer, surface()), "INVALID_STATE");
  await catalog.restore(maintainer, { id: "docs-writer" });
  await assertRejectsCode(() => catalog.register(maintainer, surface()), "ALREADY_EXISTS");
});

Deno.test("trash survives a file reload and old files without trash still load", async () => {
  const { FileCatalogStore } = await import("../src/catalog/store.ts");
  const dir = await Deno.makeTempDir({ prefix: "portico-trash-" });
  const path = `${dir}/catalog.json`;
  const first = new CatalogService(new FileCatalogStore(path));
  await first.register(maintainer, surface());
  await first.remove(maintainer, { id: "docs-writer" });

  const second = new CatalogService(new FileCatalogStore(path));
  const trashed = await second.trash(auditor);
  assertEquals(trashed.length, 1);
  assertEquals(trashed[0].previousState, "internal");
  const restored = await second.restore(maintainer, { id: "docs-writer" });
  assertEquals(restored.governanceState, "internal");

  // A file written before trash existed has no `trashed` key and still loads.
  const legacy = `${dir}/legacy.json`;
  await Deno.writeTextFile(
    legacy,
    JSON.stringify({ records: [], approvals: [], changes: [], seal: [] }),
  );
  const third = new CatalogService(new FileCatalogStore(legacy));
  assertEquals(await third.trash(auditor), []);
  await third.register(maintainer, surface());
  assertEquals((await third.get(maintainer, "docs-writer")).governanceState, "internal");
});
