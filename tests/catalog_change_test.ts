import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  CatalogService,
  FileCatalogStore,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";

const maintainer: Actor = {
  id: "agent:docs-bot",
  kind: "agent",
  role: "maintainer",
};

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

const reader: Actor = {
  id: "human:reader",
  kind: "human",
  role: "reader",
};

function surface(): RegisterInput {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

Deno.test("maintainer register appends an immutable catalog change the auditor can read", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  const changes = await service.listChanges(auditor);
  assertEquals(changes.length, 1);
  assertEquals(changes[0].surfaceId, "docs-writer");
  assertEquals(changes[0].action, "register");
  assertEquals(changes[0].governanceState, "internal");
  assertEquals(changes[0].actor.id, "agent:docs-bot");
  assertEquals(changes[0].entry.value, "jsr:@example/docs-writer");
});

Deno.test("reader and maintainer cannot read catalog changes; agent cannot claim auditor", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  await assertRejectsCode(() => service.listChanges(reader), "FORBIDDEN");
  await assertRejectsCode(() => service.listChanges(maintainer), "FORBIDDEN");
  await assertRejectsCode(
    () =>
      service.listChanges({
        id: "agent:docs-bot",
        kind: "agent",
        role: "auditor",
      }),
    "FORBIDDEN",
  );

  const changes = await service.listChanges(auditor);
  assertEquals(changes.length, 1);
});

Deno.test("draft, internal publish, and public candidate each append; no-op republish does not", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.draft(maintainer, surface());
  await service.publish(maintainer, { id: "docs-writer", visibility: "internal" });
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await service.publish(maintainer, { id: "docs-writer", visibility: "internal" }).catch(
    () => undefined,
  );
  const again = await service.publish(maintainer, {
    id: "docs-writer",
    visibility: "public",
  });
  assertEquals(again.governanceState, "pending_public");

  const changes = await service.listChanges(auditor);
  assertEquals(changes.map((item) => item.action), [
    "draft",
    "publish_internal",
    "publish_public_candidate",
  ]);
});

Deno.test("failed public register does not write catalog changes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-catalog-change-" });
  const path = `${dir}/catalog.json`;
  const service = new CatalogService(new FileCatalogStore(path));

  await assertRejectsCode(
    () => service.register(maintainer, { ...surface(), visibility: "public" }),
    "PUBLIC_REQUIRES_APPROVAL",
  );
  await assertRejectsCode(() => service.register(reader, surface()), "FORBIDDEN");

  let present = true;
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assert(!present, "failed register must not create the catalog file or change log");
});
