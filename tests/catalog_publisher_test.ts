import { assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";

const maintainer: Actor = {
  id: "agent:docs-bot",
  kind: "agent",
  role: "maintainer",
};

const reader: Actor = {
  id: "human:auditor",
  kind: "human",
  role: "reader",
};

const anonymous: Actor = {
  id: "anonymous",
  kind: "human",
  role: "anonymous",
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

Deno.test("maintainer drafts then publishes internal; reader sees only after publish", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const drafted = await service.draft(maintainer, surface());

  assertEquals(drafted.governanceState, "draft");
  assertEquals(drafted.visibility, "internal");
  assertEquals(await service.list(reader), []);
  await assertRejectsCode(() => service.get(reader, "docs-writer"), "NOT_FOUND");

  const published = await service.publish(maintainer, {
    id: "docs-writer",
    visibility: "internal",
  });
  assertEquals(published.governanceState, "internal");
  assertEquals(published.visibility, "internal");

  const listed = await service.list(reader);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-writer");
  assertEquals(listed[0].governanceState, "internal");
});

Deno.test("reader cannot draft or publish; catalog stays empty", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);

  await assertRejectsCode(() => service.draft(reader, surface()), "FORBIDDEN");
  await assertRejectsCode(
    () => service.publish(reader, { id: "docs-writer", visibility: "internal" }),
    "FORBIDDEN",
  );
  assertEquals(await store.list(), []);
});

Deno.test("publish public from internal is pending and not anonymously reachable", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  const pending = await service.publish(maintainer, {
    id: "docs-writer",
    visibility: "public",
  });
  assertEquals(pending.visibility, "public");
  assertEquals(pending.governanceState, "pending_public");

  const forReader = await service.get(reader, "docs-writer");
  assertEquals(forReader.governanceState, "pending_public");
  assertEquals(await service.list(anonymous), []);
  await assertRejectsCode(() => service.get(anonymous, "docs-writer"), "NOT_FOUND");
});

Deno.test("sneaking approved_public through publish is rejected and leaves the record internal", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, surface());

  await assertRejectsCode(
    () =>
      service.publish(maintainer, {
        id: "docs-writer",
        visibility: "public",
        governanceState: "approved_public",
      } as { id: string; visibility: "public" }),
    "INVALID_INPUT",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.visibility, "internal");
  assertEquals(got.governanceState, "internal");
  assertEquals(await service.list(anonymous), []);
});

Deno.test("publish of missing id fails without writing", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);

  await assertRejectsCode(
    () => service.publish(maintainer, { id: "docs-writer", visibility: "internal" }),
    "NOT_FOUND",
  );
  assertEquals(await store.list(), []);
});

Deno.test("publish cannot downgrade pending_public back to internal", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });

  await assertRejectsCode(
    () => service.publish(maintainer, { id: "docs-writer", visibility: "internal" }),
    "INVALID_STATE",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.governanceState, "pending_public");
  assertEquals(got.visibility, "public");
});

Deno.test("file store failed public sneak leaves catalog internal and not public-reachable", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-publish-" });
  const path = `${dir}/catalog.json`;
  const { FileCatalogStore } = await import("../src/catalog/mod.ts");
  const store = new FileCatalogStore(path);
  const service = new CatalogService(store);
  await service.register(maintainer, surface());

  await assertRejectsCode(
    () =>
      service.publish(maintainer, {
        id: "docs-writer",
        visibility: "public",
        token: "sk-live-not-a-real-secret",
      } as { id: string; visibility: "public" }),
    "INVALID_INPUT",
  );

  const file = JSON.parse(await Deno.readTextFile(path)) as {
    records: Array<{ visibility: string; governanceState: string }>;
  };
  assertEquals(file.records.length, 1);
  assertEquals(file.records[0].visibility, "internal");
  assertEquals(file.records[0].governanceState, "internal");
  assertEquals(await service.list(anonymous), []);
});
