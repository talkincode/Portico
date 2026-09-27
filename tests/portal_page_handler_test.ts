import { assert, assertEquals } from "./assert.ts";
import { type RosterFixture, signedInRoster } from "./fixtures.ts";
import { AuditService } from "../src/audit/mod.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { handlePortalRequest } from "../src/portal/mod.ts";
import { MemoryPageStore, PageService } from "../src/ui/mod.ts";

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

let roster: RosterFixture;

async function seededContext() {
  roster = await signedInRoster();
  const access = roster.access;
  const catalog = new CatalogService(new MemoryCatalogStore());
  const audit = new AuditService(catalog, access);
  const pages = new PageService(new MemoryPageStore(), catalog, audit);
  return { catalog, access, pages };
}

/** A real Bearer session: an identity is proven, never asserted. */
function actorHeaders(actor: Actor): HeadersInit {
  return roster.headersFor(actor.id);
}

async function jsonOf(response: Response): Promise<{
  status: number;
  body: { ok: boolean; data?: unknown; error?: { code: string; message: string } };
}> {
  const body = await response.json();
  return { status: response.status, body };
}

Deno.test("portal /api/page returns the same resolved card a reader would see", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.pages.set(maintainer, {
    components: [
      { kind: "catalog_card", id: "docs-writer" },
      { kind: "permission_hint" },
    ],
  });

  const response = await handlePortalRequest(
    new Request("http://portico.local/api/page", { headers: actorHeaders(reader) }),
    context,
  );
  const { status, body } = await jsonOf(response);
  assertEquals(status, 200);
  assertEquals(body.ok, true);
  const data = body.data as { components: Array<{ kind: string; id?: string; name?: string }> };
  assertEquals(data.components.length, 2);
  assertEquals(data.components[0].kind, "catalog_card");
  assertEquals(data.components[0].id, "docs-writer");
  assertEquals(data.components[0].name, "Docs Writer");
});

/** Register, submit, and have the independent auditor approve. */
async function approvedCli(
  context: Awaited<ReturnType<typeof seededContext>>,
  input: RegisterInput,
) {
  await context.catalog.register(maintainer, input);
  await context.catalog.publish(maintainer, { id: input.id, visibility: "public" });
  await context.catalog.approve(roster.auditor, { id: input.id });
}

Deno.test("推荐 HTML shows an approved card to every role and an internal card to none", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await approvedCli(context, { ...internalCli(), id: "docs-public", name: "Docs Public" });
  await context.pages.set(maintainer, {
    components: [
      { kind: "catalog_card", id: "docs-writer" },
      { kind: "catalog_card", id: "docs-public" },
    ],
  });

  for (const headers of [actorHeaders(reader), {}]) {
    const page = await handlePortalRequest(
      new Request("http://portico.local/public/picks", { headers }),
      context,
    );
    const html = await page.text();
    assertEquals(page.status, 200);
    assert(html.includes("Docs Public"), "an approved pick is a public pick");
    assert(html.includes('href="/public/s/docs-public"'));
    // The page is maintainer-curated, but curation is not approval: an
    // internal record placed on the page stays off the public plane, even
    // for a reader who can see it elsewhere.
    assert(!html.includes("Docs Writer"), "an internal pick must not reach the public plane");
    assert(!html.includes("docs-writer"));
  }
});

Deno.test("推荐 HTML escapes names so the component box is not a CMS", async () => {
  const context = await seededContext();
  await approvedCli(context, { ...internalCli(), name: "<script>alert(1)</script>" });
  await context.pages.set(maintainer, {
    components: [{ kind: "catalog_card", id: "docs-writer" }],
  });

  const page = await handlePortalRequest(
    new Request("http://portico.local/public/picks"),
    context,
  );
  const html = await page.text();
  assert(!html.includes("<script>alert(1)</script>"), "raw script must not appear");
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "name must be escaped");
});

Deno.test("portal page writes are rejected and do not mutate the page or catalog", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.pages.set(maintainer, {
    components: [{ kind: "permission_hint" }],
  });
  const beforePage = JSON.stringify(await context.pages.get(reader));
  const beforeCatalog = JSON.stringify(await context.catalog.list(reader));

  const response = await handlePortalRequest(
    new Request("http://portico.local/api/page", {
      method: "POST",
      headers: { ...actorHeaders(maintainer), "content-type": "application/json" },
      body: JSON.stringify({ components: [{ kind: "hero_banner" }] }),
    }),
    context,
  );
  const { status, body } = await jsonOf(response);
  assertEquals(status, 405);
  assertEquals(body.ok, false);
  assertEquals(body.error?.code, "USAGE");
  assertEquals(JSON.stringify(await context.pages.get(reader)), beforePage);
  assertEquals(JSON.stringify(await context.catalog.list(reader)), beforeCatalog);
});
