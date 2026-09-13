import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
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

function internalCli(): RegisterInput {
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

Deno.test("maintainer can register an internal surface and reader can see it", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const created = await service.register(maintainer, internalCli());

  assertEquals(created.id, "docs-writer");
  assertEquals(created.visibility, "internal");
  assertEquals(created.governanceState, "internal");
  assertEquals(created.channels, ["cli"]);
  assertEquals(created.entry.value, "jsr:@example/docs-writer");

  const listed = await service.list(reader);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-writer");
  assertEquals(listed[0].name, "Docs Writer");

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.governanceState, "internal");
  assertEquals(got.visibility, "internal");
});

Deno.test("reader cannot register; catalog stays empty", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);

  await assertRejectsCode(
    () => service.register(reader, internalCli()),
    "FORBIDDEN",
  );

  assertEquals(await service.list(maintainer), []);
  assertEquals(await store.list(), []);
});

Deno.test("registering public visibility is rejected and does not dirty the catalog", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.visibility = "public";

  await assertRejectsCode(
    () => service.register(maintainer, input),
    "PUBLIC_REQUIRES_APPROVAL",
  );

  assertEquals(await store.list(), []);
  await assertRejectsCode(
    () => service.get(anonymous, "docs-writer"),
    "NOT_FOUND",
  );
});

Deno.test("sneaking approved_public governance state is rejected", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const sneaky = {
    ...internalCli(),
    governanceState: "approved_public",
  } as RegisterInput;

  await assertRejectsCode(
    () => service.register(maintainer, sneaky),
    "INVALID_INPUT",
  );
  assertEquals(await store.list(), []);
});

Deno.test("duplicate id fails and original record is unchanged", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalCli());

  const second = internalCli();
  second.name = "Hijacked Name";

  await assertRejectsCode(
    () => service.register(maintainer, second),
    "ALREADY_EXISTS",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.name, "Docs Writer");
});

Deno.test("anonymous cannot see internal records", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalCli());

  assertEquals(await service.list(anonymous), []);
  await assertRejectsCode(
    () => service.get(anonymous, "docs-writer"),
    "NOT_FOUND",
  );
});

Deno.test("invalid id is rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.id = "Docs Writer";

  await assertRejectsCode(
    () => service.register(maintainer, input),
    "INVALID_INPUT",
  );
  assertEquals(await store.list(), []);
});

Deno.test("plaintext secret fields are rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = {
    ...internalCli(),
    token: "sk-live-not-a-real-secret",
  } as RegisterInput;

  await assertRejectsCode(
    () => service.register(maintainer, input),
    "INVALID_INPUT",
  );
  assertEquals(await store.list(), []);
});

Deno.test("file store failed public register leaves catalog file absent", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-catalog-" });
  const path = `${dir}/catalog.json`;
  const { FileCatalogStore } = await import("../src/catalog/mod.ts");
  const store = new FileCatalogStore(path);
  const service = new CatalogService(store);
  const input = internalCli();
  input.visibility = "public";

  await assertRejectsCode(
    () => service.register(maintainer, input),
    "PUBLIC_REQUIRES_APPROVAL",
  );

  let present = true;
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assert(!present, "failed public register must not create the catalog file");
});
