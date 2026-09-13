import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import { AccessService, MemoryIdentityStore } from "../src/access/mod.ts";
import { AuditService } from "../src/audit/mod.ts";
import {
  type Actor,
  CatalogService,
  FileCatalogStore,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { FilePageStore, MemoryPageStore, PageService } from "../src/ui/mod.ts";

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

function pageService(catalog = new CatalogService(new MemoryCatalogStore())) {
  return {
    catalog,
    pages: new PageService(new MemoryPageStore(), catalog),
  };
}

Deno.test("maintainer composes catalog_card and permission_hint; reader gets the same card", async () => {
  const { catalog, pages } = pageService();
  await catalog.register(maintainer, internalCli());

  const saved = await pages.set(maintainer, {
    components: [
      { kind: "catalog_card", id: "docs-writer" },
      { kind: "permission_hint" },
    ],
  });
  assertEquals(saved.components.length, 2);
  assertEquals(saved.updatedBy.id, "agent:docs-bot");

  const view = await pages.get(reader);
  assertEquals(view.components.length, 2);
  assertEquals(view.components[0], {
    kind: "catalog_card",
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    governanceState: "internal",
    visibility: "internal",
    channels: ["cli"],
    version: "1.0.0",
  });
  assertEquals(view.components[1], {
    kind: "permission_hint",
    role: "reader",
    canMaintain: false,
    canAudit: false,
    canApprovePublic: false,
  });
});

Deno.test("anonymous does not see an internal catalog_card even if the page references it", async () => {
  const { catalog, pages } = pageService();
  await catalog.register(maintainer, internalCli());
  await pages.set(maintainer, {
    components: [
      { kind: "catalog_card", id: "docs-writer" },
      { kind: "catalog_detail", id: "docs-writer" },
      { kind: "approval_status", id: "docs-writer" },
      { kind: "permission_hint" },
    ],
  });

  const view = await pages.get(anonymous);
  assertEquals(view.components.length, 1);
  assertEquals(view.components[0].kind, "permission_hint");
  assertEquals((view.components[0] as { role: string }).role, "anonymous");
});

Deno.test("approved public card becomes visible to anonymous; pending does not", async () => {
  const { catalog, pages } = pageService();
  await catalog.register(maintainer, internalCli());
  await catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await pages.set(maintainer, {
    components: [{ kind: "catalog_card", id: "docs-writer" }],
  });

  const pending = await pages.get(anonymous);
  assertEquals(pending.components, []);

  await catalog.approve(auditor, { id: "docs-writer" });
  const published = await pages.get(anonymous);
  assertEquals(published.components.length, 1);
  assertEquals(published.components[0].kind, "catalog_card");
  assertEquals(
    (published.components[0] as { id: string; governanceState: string }).id,
    "docs-writer",
  );
  assertEquals(
    (published.components[0] as { governanceState: string }).governanceState,
    "approved_public",
  );
});

Deno.test("reader cannot set a page; store stays empty", async () => {
  const store = new MemoryPageStore();
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, internalCli());
  const pages = new PageService(store, catalog);

  await assertRejectsCode(
    () => pages.set(reader, { components: [{ kind: "catalog_card", id: "docs-writer" }] }),
    "FORBIDDEN",
  );
  assertEquals(await store.load(), undefined);
});

Deno.test("unknown component kind is rejected so the box is not a CMS", async () => {
  const store = new MemoryPageStore();
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, internalCli());
  const pages = new PageService(store, catalog);

  await assertRejectsCode(
    () =>
      pages.set(maintainer, {
        components: [{ kind: "hero_banner", id: "docs-writer" }],
      }),
    "INVALID_INPUT",
  );
  assertEquals(await store.load(), undefined);
});

Deno.test("html, theme, and secret fields are rejected and do not write", async () => {
  const store = new MemoryPageStore();
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, internalCli());
  const pages = new PageService(store, catalog);

  await assertRejectsCode(
    () =>
      pages.set(maintainer, {
        components: [{ kind: "catalog_card", id: "docs-writer" }],
        html: "<h1>custom</h1>",
      }),
    "INVALID_INPUT",
  );
  await assertRejectsCode(
    () =>
      pages.set(maintainer, {
        components: [{ kind: "catalog_card", id: "docs-writer", theme: "dark" }],
      }),
    "INVALID_INPUT",
  );
  await assertRejectsCode(
    () =>
      pages.set(maintainer, {
        components: [{ kind: "catalog_card", id: "docs-writer" }],
        token: "sk-live-not-a-real-secret",
      }),
    "INVALID_INPUT",
  );
  assertEquals(await store.load(), undefined);
});

Deno.test("missing catalog id is rejected and does not write", async () => {
  const store = new MemoryPageStore();
  const pages = new PageService(store, new CatalogService(new MemoryCatalogStore()));

  await assertRejectsCode(
    () => pages.set(maintainer, { components: [{ kind: "catalog_card", id: "missing-bot" }] }),
    "NOT_FOUND",
  );
  assertEquals(await store.load(), undefined);
});

Deno.test("audit_snippet is omitted for reader and filled for human auditor", async () => {
  const identities = new MemoryIdentityStore();
  const access = new AccessService(identities);
  await access.grant(null, {
    id: "human:security-auditor",
    kind: "human",
    role: "auditor",
  });
  await access.grant(auditor, {
    id: "agent:docs-bot",
    kind: "agent",
    role: "maintainer",
  });
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, internalCli());
  const audit = new AuditService(catalog, access);
  const pages = new PageService(new MemoryPageStore(), catalog, audit);
  await pages.set(maintainer, {
    components: [
      { kind: "catalog_card", id: "docs-writer" },
      { kind: "audit_snippet", limit: 5 },
    ],
  });

  const readerView = await pages.get(reader);
  assertEquals(readerView.components.map((item) => item.kind), ["catalog_card"]);

  const auditorView = await pages.get(auditor);
  assertEquals(auditorView.components.length, 2);
  assertEquals(auditorView.components[1].kind, "audit_snippet");
  const snippet = auditorView.components[1] as {
    events: Array<{ kind: string; subjectId: string }>;
  };
  assert(
    snippet.events.some((event) => event.kind === "catalog" && event.subjectId === "docs-writer"),
  );
});

Deno.test("file store failed page set leaves the page file absent", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-page-" });
  const catalogPath = `${dir}/catalog.json`;
  const pagePath = `${dir}/page.json`;
  const catalog = new CatalogService(new FileCatalogStore(catalogPath));
  await catalog.register(maintainer, internalCli());
  const pages = new PageService(new FilePageStore(pagePath), catalog);

  await assertRejectsCode(
    () =>
      pages.set(reader, {
        components: [{ kind: "catalog_card", id: "docs-writer" }],
      }),
    "FORBIDDEN",
  );

  let present = true;
  try {
    await Deno.stat(pagePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assert(!present, "failed page set must not create the page file");
});
