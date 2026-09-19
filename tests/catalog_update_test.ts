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

const otherMaintainer: Actor = {
  id: "human:docs-owner",
  kind: "human",
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

Deno.test("maintainer updates an internal surface; reader sees the same change", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  const updated = await service.update(maintainer, {
    id: "docs-writer",
    description: "Drafts and edits internal documentation.",
    version: "1.1.0",
  });
  assertEquals(updated.description, "Drafts and edits internal documentation.");
  assertEquals(updated.version, "1.1.0");
  assertEquals(updated.governanceState, "internal");
  assertEquals(updated.visibility, "internal");

  const seen = await service.get(reader, "docs-writer");
  assertEquals(seen.description, "Drafts and edits internal documentation.");
  assertEquals(seen.version, "1.1.0");
});

Deno.test("maintainer updates a draft; unrelated fields stay unchanged", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.draft(maintainer, surface());

  const updated = await service.update(maintainer, {
    id: "docs-writer",
    name: "Docs Writer v2",
  });
  assertEquals(updated.name, "Docs Writer v2");
  assertEquals(updated.description, "Drafts internal documentation.");
  assertEquals(updated.governanceState, "draft");
});

Deno.test("update can change channels and entry together and re-validates mcp consistency", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  const updated = await service.update(maintainer, {
    id: "docs-writer",
    channels: ["mcp"],
    entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/docs" },
  });
  assertEquals(updated.channels, ["mcp"]);
  assertEquals(updated.entry, {
    kind: "mcp_endpoint",
    value: "https://mcp.example.test/servers/docs",
  });
});

Deno.test("update rejects an inconsistent mcp channel/entry combination and does not write", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  await assertRejectsCode(
    () =>
      service.update(maintainer, {
        id: "docs-writer",
        channels: ["mcp"],
      }),
    "INVALID_INPUT",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.channels, ["cli"]);
  assertEquals(got.entry, { kind: "package", value: "jsr:@example/docs-writer" });
});

Deno.test("reader and anonymous cannot update; catalog is unchanged", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  await assertRejectsCode(
    () => service.update(reader, { id: "docs-writer", name: "Hijacked" }),
    "FORBIDDEN",
  );
  await assertRejectsCode(
    () => service.update(anonymous, { id: "docs-writer", name: "Hijacked" }),
    "FORBIDDEN",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.name, "Docs Writer");
});

Deno.test("update of a pending_public candidate is rejected so mid-review surfaces cannot shift", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });

  await assertRejectsCode(
    () => service.update(maintainer, { id: "docs-writer", name: "Sneaky Rename" }),
    "INVALID_STATE",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.name, "Docs Writer");
  assertEquals(got.governanceState, "pending_public");
});

Deno.test("update of an approved_public surface is rejected; withdraw first, then update, then republish", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await service.approve(auditor, { id: "docs-writer" });

  await assertRejectsCode(
    () => service.update(maintainer, { id: "docs-writer", name: "Sneaky Public Rename" }),
    "INVALID_STATE",
  );
  assertEquals((await service.get(anonymous, "docs-writer")).name, "Docs Writer");

  await service.withdraw(auditor, { id: "docs-writer" });
  const updated = await service.update(maintainer, {
    id: "docs-writer",
    name: "Docs Writer Renamed",
  });
  assertEquals(updated.governanceState, "internal");
  assertEquals(updated.name, "Docs Writer Renamed");

  // The renamed surface is still not publicly reachable until re-approved.
  await assertRejectsCode(() => service.get(anonymous, "docs-writer"), "NOT_FOUND");

  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await service.approve(auditor, { id: "docs-writer" });
  assertEquals((await service.get(anonymous, "docs-writer")).name, "Docs Writer Renamed");
});

Deno.test("update rejects plaintext secret fields, unknown fields, and empty updates without writing", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  await assertRejectsCode(
    () =>
      service.update(maintainer, {
        id: "docs-writer",
        token: "sk-live-not-a-real-secret",
      } as { id: string }),
    "INVALID_INPUT",
  );
  await assertRejectsCode(
    () => service.update(maintainer, { id: "docs-writer", visibility: "public" } as { id: string }),
    "INVALID_INPUT",
  );
  await assertRejectsCode(
    () => service.update(maintainer, { id: "docs-writer" }),
    "INVALID_INPUT",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.name, "Docs Writer");
  assertEquals(got.version, "1.0.0");
});

Deno.test("update rejects plaintext secret values in name, description, or version without writing", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  const cases = [
    { id: "docs-writer", name: "sk-live-not-a-real-secret-0123456789" },
    {
      id: "docs-writer",
      description: "Uses key ghp_notARealGitHubToken1234567890 in requests.",
    },
    { id: "docs-writer", version: "glpat-not-a-real-gitlab-01234" },
    { id: "docs-writer", name: "AKIANOTAREALAWSKEY01" },
    {
      id: "docs-writer",
      description: "Rotate ASIANOTAREALSTSKEY01 after the incident.",
    },
    { id: "docs-writer", name: "npm_NOTAREALTOKEN0123456789abcdefghijklm" },
  ];

  for (const input of cases) {
    await assertRejectsCode(() => service.update(maintainer, input), "INVALID_INPUT");
  }

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.name, "Docs Writer");
  assertEquals(got.version, "1.0.0");
});

Deno.test("update of a missing id fails without writing", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);

  await assertRejectsCode(
    () => service.update(maintainer, { id: "does-not-exist", name: "Ghost" }),
    "NOT_FOUND",
  );
  assertEquals(await store.list(), []);
});

Deno.test("file store failed update leaves the catalog file untouched", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-update-" });
  const path = `${dir}/catalog.json`;
  const { FileCatalogStore } = await import("../src/catalog/mod.ts");
  const store = new FileCatalogStore(path);
  const service = new CatalogService(store);
  await service.register(maintainer, surface());
  const before = await Deno.readTextFile(path);

  await assertRejectsCode(
    () =>
      service.update(maintainer, {
        id: "docs-writer",
        token: "sk-live-not-a-real-secret",
      } as { id: string }),
    "INVALID_INPUT",
  );

  const after = await Deno.readTextFile(path);
  assertEquals(after, before);
});

Deno.test("file store rejects rewriting a web entry into Portico's own reading page", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-update-" });
  const path = `${dir}/catalog.json`;
  const { FileCatalogStore } = await import("../src/catalog/mod.ts");
  const store = new FileCatalogStore(path);
  const service = new CatalogService(store);
  await service.register(maintainer, {
    id: "docs-web",
    name: "Docs Web",
    description: "External documentation portal.",
    channels: ["web"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "url", value: "https://docs.example.test/portals/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  });
  const before = await Deno.readTextFile(path);

  await assertRejectsCode(
    () =>
      service.update(maintainer, {
        id: "docs-web",
        entry: { kind: "url", value: "http://127.0.0.1:8788/s/docs-web" },
      }),
    "INVALID_INPUT",
  );

  const after = await Deno.readTextFile(path);
  assertEquals(after, before);
});

Deno.test("any maintainer-role actor can update, not only the record's listed maintainers", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, surface());

  const updated = await service.update(otherMaintainer, {
    id: "docs-writer",
    version: "2.0.0",
  });
  assertEquals(updated.version, "2.0.0");
});
