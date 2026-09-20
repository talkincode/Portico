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

const PACKAGE = "jsr:@example/docs-writer";

function internalCli(): RegisterInput {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: PACKAGE },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function internalMcp(): RegisterInput {
  return {
    id: "docs-mcp",
    name: "Docs MCP",
    description: "External documentation MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/docs" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function internalWeb(): RegisterInput {
  return {
    id: "docs-web",
    name: "Docs Web",
    description: "External documentation portal.",
    channels: ["web"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "url", value: "https://docs.example.test/portals/docs-writer" },
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

Deno.test("maintainer registers a CLI surface; reader lists and describes the same package", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const created = await service.register(maintainer, internalCli());

  assertEquals(created.id, "docs-writer");
  assertEquals(created.channels, ["cli"]);
  assertEquals(created.entry, { kind: "package", value: PACKAGE });
  assertEquals(created.governanceState, "internal");

  const listed = await service.listCli(reader);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-writer");
  assertEquals(listed[0].name, "Docs Writer");
  assertEquals(listed[0].package, { kind: "package", value: PACKAGE });
  assertEquals(listed[0].connect, { mode: "coordinate" });
  assertEquals(listed[0].governanceState, "internal");

  const described = await service.describeCli(reader, "docs-writer");
  assertEquals(described.id, "docs-writer");
  assertEquals(described.package.value, PACKAGE);
  assertEquals(described.connect.mode, "coordinate");
});

Deno.test("MCP-only surfaces do not appear in CLI list or describe", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalMcp());

  assertEquals(await service.listCli(reader), []);
  await assertRejectsCode(() => service.describeCli(reader, "docs-mcp"), "NOT_FOUND");
});

Deno.test("web-only surfaces do not appear in CLI list or describe", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalWeb());

  assertEquals(await service.listCli(reader), []);
  await assertRejectsCode(() => service.describeCli(reader, "docs-web"), "NOT_FOUND");
});

Deno.test("reader cannot register a CLI surface; catalog stays empty", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);

  await assertRejectsCode(() => service.register(reader, internalCli()), "FORBIDDEN");
  assertEquals(await store.list(), []);
  assertEquals(await service.listCli(maintainer), []);
});

Deno.test("cli channel with a non-package entry is rejected and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.entry = { kind: "url", value: "https://example.test/cli" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("package entry without the cli channel is rejected and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalMcp();
  input.entry = { kind: "package", value: PACKAGE };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("mixed cli+mcp channels are rejected; one surface has one entry", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.channels = ["cli", "mcp"];

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("command-style package is rejected so Portico cannot become a runtime", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.entry = { kind: "package", value: "npx -y @example/docs-writer" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("URL package coordinate is rejected so Portico does not download or execute", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.entry = {
    kind: "package",
    value: "https://example.test/docs-writer.tgz?token=not-a-real-secret",
  };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("package coordinate with a secret-shaped scope or name is rejected and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  // JSR/NPM scope and name characters (`[a-z0-9._-]`) are permissive enough
  // to fit a live-token prefix. A maintainer pasting one into a package
  // coordinate should not slip past just because it satisfies the jsr:/npm:
  // shape check.
  const coordinates = [
    "npm:@sk-live-not-a-real-secret-0123456789/docs-writer",
    "jsr:@example/ghp_notARealGitHubToken1234567890",
    "npm:@example/AKIANOTAREALAWSKEY01",
    "npm:@example/AIzaSyNOTAREALGOOGLEAPIKEY0123456789abc",
    "npm:@example/npm_NOTAREALTOKEN0123456789abcdefghijklm",
  ];

  for (const value of coordinates) {
    const input = internalCli();
    input.entry = { kind: "package", value };
    await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  }
  assertEquals(await store.list(), []);
});

Deno.test("unknown registry prefix is rejected and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.entry = { kind: "package", value: "git:github.com/example/docs-writer" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("anonymous cannot list or describe an internal CLI surface", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalCli());

  assertEquals(await service.listCli(anonymous), []);
  await assertRejectsCode(() => service.describeCli(anonymous, "docs-writer"), "NOT_FOUND");
});

Deno.test("pending public CLI stays hidden from anonymous; approve then describe matches", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalCli());
  await service.publish(maintainer, { id: "docs-writer", visibility: "public" });

  assertEquals(await service.listCli(anonymous), []);
  await assertRejectsCode(() => service.describeCli(anonymous, "docs-writer"), "NOT_FOUND");

  const readerPending = await service.describeCli(reader, "docs-writer");
  assertEquals(readerPending.governanceState, "pending_public");
  assertEquals(readerPending.package.value, PACKAGE);

  const approved = await service.approve(auditor, { id: "docs-writer" });
  assertEquals(approved.governanceState, "approved_public");

  const listed = await service.listCli(anonymous);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-writer");
  assertEquals(listed[0].governanceState, "approved_public");
  const described = await service.describeCli(anonymous, "docs-writer");
  assertEquals(described.package.value, PACKAGE);
  assertEquals(described.connect.mode, "coordinate");
});

Deno.test("update can change a web surface into a CLI package surface", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalWeb());

  const updated = await service.update(maintainer, {
    id: "docs-web",
    channels: ["cli"],
    entry: { kind: "package", value: PACKAGE },
  });
  assertEquals(updated.channels, ["cli"]);
  assertEquals(updated.entry, { kind: "package", value: PACKAGE });

  const listed = await service.listCli(reader);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-web");
  assertEquals(listed[0].package.value, PACKAGE);
});

Deno.test("update rejects a cli channel without a package entry and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, internalWeb());
  const before = JSON.stringify(await store.list());

  await assertRejectsCode(
    () => service.update(maintainer, { id: "docs-web", channels: ["cli"] }),
    "INVALID_INPUT",
  );
  assertEquals(JSON.stringify(await store.list()), before);
});

Deno.test("describeCli does not mutate the catalog", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, internalCli());
  const before = JSON.stringify(await store.list());

  await service.describeCli(reader, "docs-writer");
  await service.listCli(reader);

  assertEquals(JSON.stringify(await store.list()), before);
});

Deno.test("file store rejected command-style package leaves catalog file absent", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-cli-" });
  const path = `${dir}/catalog.json`;
  const service = new CatalogService(new FileCatalogStore(path));
  const input = internalCli();
  input.entry = { kind: "package", value: "deno run -A jsr:@example/docs-writer" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assert(!(await fileExists(path)), "failed CLI register must not create the catalog file");
});
