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

const reader: Actor = {
  id: "human:reader",
  kind: "human",
  role: "reader",
};

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

const anonymous: Actor = {
  id: "anonymous",
  kind: "human",
  role: "anonymous",
};

const WEB_HREF = "https://docs.example.test/portals/docs-writer";

function internalWeb(): RegisterInput {
  return {
    id: "docs-web",
    name: "Docs Web",
    description: "External documentation portal.",
    channels: ["web"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "url", value: WEB_HREF },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

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

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

Deno.test("maintainer registers a web surface; reader lists and describes the same href", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const created = await service.register(maintainer, internalWeb());

  assertEquals(created.id, "docs-web");
  assertEquals(created.channels, ["web"]);
  assertEquals(created.entry, { kind: "url", value: WEB_HREF });
  assertEquals(created.governanceState, "internal");

  const listed = await service.listWeb(reader);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-web");
  assertEquals(listed[0].name, "Docs Web");
  assertEquals(listed[0].href, { kind: "url", value: WEB_HREF });
  assertEquals(listed[0].connect, { mode: "direct" });
  assertEquals(listed[0].governanceState, "internal");

  const described = await service.describeWeb(reader, "docs-web");
  assertEquals(described.id, "docs-web");
  assertEquals(described.href.value, WEB_HREF);
  assertEquals(described.connect.mode, "direct");
});

Deno.test("CLI-only surfaces do not appear in web list or describe", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalCli());

  assertEquals(await service.listWeb(reader), []);
  await assertRejectsCode(() => service.describeWeb(reader, "docs-writer"), "NOT_FOUND");
});

Deno.test("reader cannot register a web surface; catalog stays empty", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);

  await assertRejectsCode(() => service.register(reader, internalWeb()), "FORBIDDEN");
  assertEquals(await store.list(), []);
  assertEquals(await service.listWeb(maintainer), []);
});

Deno.test("web channel with a non-url entry is rejected and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalWeb();
  input.entry = { kind: "package", value: "jsr:@example/docs-web" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("url entry without the web channel is rejected and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.entry = { kind: "url", value: WEB_HREF };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("mixed cli+web channels are rejected; one surface has one entry", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalWeb();
  input.channels = ["cli", "web"];

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("plaintext secret in a web URL query is rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalWeb();
  input.entry = {
    kind: "url",
    value: "https://docs.example.test/portals/docs-writer?token=not-a-real-secret",
  };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("web URL userinfo is rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalWeb();
  input.entry = {
    kind: "url",
    value: "https://user:not-a-secret@docs.example.test/portals/docs-writer",
  };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("javascript web URL is rejected so the portal cannot become a runtime", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalWeb();
  input.entry = { kind: "url", value: "javascript:alert(1)" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("anonymous cannot list or describe an internal web surface", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalWeb());

  assertEquals(await service.listWeb(anonymous), []);
  await assertRejectsCode(() => service.describeWeb(anonymous, "docs-web"), "NOT_FOUND");
});

Deno.test("pending public web stays hidden from anonymous; approve then describe matches", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalWeb());
  await service.publish(maintainer, { id: "docs-web", visibility: "public" });

  assertEquals(await service.listWeb(anonymous), []);
  await assertRejectsCode(() => service.describeWeb(anonymous, "docs-web"), "NOT_FOUND");

  const readerPending = await service.describeWeb(reader, "docs-web");
  assertEquals(readerPending.governanceState, "pending_public");
  assertEquals(readerPending.href.value, WEB_HREF);

  const approved = await service.approve(auditor, { id: "docs-web" });
  assertEquals(approved.governanceState, "approved_public");

  const listed = await service.listWeb(anonymous);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-web");
  assertEquals(listed[0].governanceState, "approved_public");
  const described = await service.describeWeb(anonymous, "docs-web");
  assertEquals(described.href.value, WEB_HREF);
  assertEquals(described.connect.mode, "direct");
});

Deno.test("update can change a CLI surface into a web surface", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalCli());

  const updated = await service.update(maintainer, {
    id: "docs-writer",
    channels: ["web"],
    entry: { kind: "url", value: WEB_HREF },
  });
  assertEquals(updated.channels, ["web"]);
  assertEquals(updated.entry, { kind: "url", value: WEB_HREF });

  const listed = await service.listWeb(reader);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-writer");
  assertEquals(listed[0].href.value, WEB_HREF);
});

Deno.test("update rejects a web channel without a url entry and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, internalCli());
  const before = JSON.stringify(await store.list());

  await assertRejectsCode(
    () => service.update(maintainer, { id: "docs-writer", channels: ["web"] }),
    "INVALID_INPUT",
  );
  assertEquals(JSON.stringify(await store.list()), before);
});

Deno.test("describeWeb does not mutate the catalog", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, internalWeb());
  const before = JSON.stringify(await store.list());

  await service.describeWeb(reader, "docs-web");
  await service.listWeb(reader);

  assertEquals(JSON.stringify(await store.list()), before);
});

Deno.test("web entry that points at Portico's own reading page is rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalWeb();
  input.entry = { kind: "url", value: "http://127.0.0.1:8788/s/docs-web" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("web entry that points at the public reading page is rejected even with a query", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalWeb();
  input.entry = {
    kind: "url",
    value: "https://docs.example.test/public/s/docs-web?channel=web",
  };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("trailing slash on the reading-page path is still a self-loop", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalWeb();
  input.entry = { kind: "url", value: "http://127.0.0.1:8788/s/docs-web/" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("an external URL that happens to contain /s/ but not this id still registers", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const input = internalWeb();
  input.entry = { kind: "url", value: "https://docs.example.test/s/guide" };

  const created = await service.register(maintainer, input);
  assertEquals(created.entry.value, "https://docs.example.test/s/guide");
});

Deno.test("update cannot rewrite a web entry into Portico's own reading page", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, internalWeb());
  const before = JSON.stringify(await store.list());

  await assertRejectsCode(
    () =>
      service.update(maintainer, {
        id: "docs-web",
        entry: { kind: "url", value: "http://127.0.0.1:8788/s/docs-web" },
      }),
    "INVALID_INPUT",
  );
  assertEquals(JSON.stringify(await store.list()), before);
});

Deno.test("file store rejected web secret URL leaves catalog file absent", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-web-" });
  const path = `${dir}/catalog.json`;
  const service = new CatalogService(new FileCatalogStore(path));
  const input = internalWeb();
  input.entry = {
    kind: "url",
    value: "https://docs.example.test/portals/docs-writer?api_key=not-a-real-key",
  };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assert(!(await fileExists(path)), "failed web register must not create the catalog file");
});
