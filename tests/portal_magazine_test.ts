import { assert, assertEquals } from "./assert.ts";
import { AccessService, MemoryIdentityStore } from "../src/access/mod.ts";
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

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
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

function secretCli(): RegisterInput {
  return {
    id: "secret-cli",
    name: "Secret Internal CLI",
    description: "Must not leak to anonymous channel filters.",
    channels: ["cli"],
    version: "2.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@secret/internal-cli" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function publicWeb(): RegisterInput {
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

async function seededContext() {
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
  await access.grant(auditor, {
    id: "human:reader",
    kind: "human",
    role: "reader",
  });
  const catalog = new CatalogService(new MemoryCatalogStore());
  const pages = new PageService(new MemoryPageStore(), catalog);
  return { catalog, access, pages };
}

function actorHeaders(actor: Actor): HeadersInit {
  return {
    "x-portico-actor-id": actor.id,
    "x-portico-actor-kind": actor.kind,
    "x-portico-actor-role": actor.role,
  };
}

const ACCENT = "#4A9EFF";
const DARK_BG = "#0B0D0F";
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

Deno.test("dark and light magazine shells share the cyan accent and keep CSP closed", async () => {
  const context = await seededContext();

  const dark = await handlePortalRequest(
    new Request("http://portico.local/?theme=dark"),
    context,
  );
  const light = await handlePortalRequest(
    new Request("http://portico.local/?theme=light"),
    context,
  );
  assertEquals(dark.status, 200);
  assertEquals(light.status, 200);
  assertEquals(dark.headers.get("content-security-policy"), CSP);
  assertEquals(light.headers.get("content-security-policy"), CSP);

  const darkHtml = await dark.text();
  const lightHtml = await light.text();
  const darkTag = darkHtml.match(/<html\b[^>]*>/)?.[0] ?? "";
  const lightTag = lightHtml.match(/<html\b[^>]*>/)?.[0] ?? "";
  assert(darkTag.includes('data-theme="dark"'), "dark query must set data-theme=dark");
  assert(lightTag.includes('data-theme="light"'), "light query must set data-theme=light");
  assert(darkHtml.includes(ACCENT), "dark theme must use the cyan-blue accent");
  assert(lightHtml.includes(ACCENT), "light theme must use the same cyan-blue accent");
  assert(darkHtml.includes(DARK_BG), "dark theme must use the near-black magazine ground");
  assert(darkHtml.includes("Songti SC"), "Chinese titles must use Songti SC");
  assert(darkHtml.includes("Noto Serif SC"));
  assert(darkHtml.includes("Source Han Serif"));
  assert(darkHtml.includes("Palatino"));
  assert(!darkHtml.includes("Inter"), "Inter is banned");
  assert(!lightHtml.includes("Roboto"), "Roboto is banned");
  assert(!darkHtml.includes("<script"), "theme switch must not require a script");
  assert(!lightHtml.includes("<script"), "theme switch must not require a script");
  for (const html of [darkHtml, lightHtml]) {
    assert(html.includes("PORTICO"), "masthead brand");
    assert(html.includes("内容"));
    assert(html.includes("专题"));
    assert(html.includes("收藏"));
    assert(html.includes("aria-disabled"), "收藏 is display-only");
  }
});

Deno.test("system theme follows prefers-color-scheme and does not persist a data-theme", async () => {
  const context = await seededContext();
  const page = await handlePortalRequest(new Request("http://portico.local/"), context);
  const html = await page.text();
  const openTag = html.match(/<html\b[^>]*>/)?.[0] ?? "";
  assert(!openTag.includes("data-theme"), "system default must not persist data-theme on <html>");
  assert(html.includes("prefers-color-scheme"));
  assert(html.includes(ACCENT));
});

Deno.test("channel filter does not leak anonymous-invisible records", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, secretCli());
  await context.catalog.register(maintainer, publicWeb());
  await context.catalog.publish(maintainer, { id: "docs-web", visibility: "public" });
  await context.catalog.approve(auditor, { id: "docs-web" });

  const anonCli = await handlePortalRequest(
    new Request("http://portico.local/?channel=cli"),
    context,
  );
  const anonCliHtml = await anonCli.text();
  assertEquals(anonCli.status, 200);
  assert(
    !anonCliHtml.includes("Secret Internal CLI"),
    "anonymous cli filter must not leak internal",
  );
  assert(!anonCliHtml.includes("jsr:@secret/internal-cli"));
  assert(!anonCliHtml.includes("Docs Web"), "cli filter must not show a web surface");

  const anonWeb = await handlePortalRequest(
    new Request("http://portico.local/?channel=web"),
    context,
  );
  const anonWebHtml = await anonWeb.text();
  assert(anonWebHtml.includes("Docs Web"), "anonymous may see approved public web");
  assert(!anonWebHtml.includes("Secret Internal CLI"));
  assert(!anonWebHtml.includes("jsr:@secret/internal-cli"));

  const readerCli = await handlePortalRequest(
    new Request("http://portico.local/?channel=cli", { headers: actorHeaders(reader) }),
    context,
  );
  const readerCliHtml = await readerCli.text();
  assert(readerCliHtml.includes("Secret Internal CLI"));
  assert(!readerCliHtml.includes("Docs Web"), "reader cli filter must not mix web records");
});

Deno.test("anonymous internal detail is 404 HTML and does not leak entries", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const anon = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer"),
    context,
  );
  assertEquals(anon.status, 404);
  assertEquals(anon.headers.get("content-type"), "text/html; charset=utf-8");
  const anonHtml = await anon.text();
  assert(!anonHtml.includes("Docs Writer"));
  assert(!anonHtml.includes("Drafts internal documentation."));
  assert(!anonHtml.includes("jsr:@example/docs-writer"));
  assert(!anonHtml.includes("agent:docs-bot"));

  const readerPage = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(readerPage.status, 200);
  const readerHtml = await readerPage.text();
  assert(readerHtml.includes("Docs Writer"));
  assert(readerHtml.includes("Drafts internal documentation."));
  assert(readerHtml.includes("1.0.0"));
  assert(readerHtml.includes("jsr:@example/docs-writer"));
  assert(!readerHtml.includes('href="jsr:@example/docs-writer"'));
});

Deno.test("anonymous does not see unapproved sidebar picks", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.pages.set(maintainer, {
    components: [{ kind: "catalog_card", id: "docs-writer" }],
  });

  const readerPage = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  const readerHtml = await readerPage.text();
  assert(readerHtml.includes("Docs Writer"));
  assert(readerHtml.includes('data-kind="catalog_card"'));

  const anonPage = await handlePortalRequest(new Request("http://portico.local/"), context);
  const anonHtml = await anonPage.text();
  assert(!anonHtml.includes("Docs Writer"));
  assert(!anonHtml.includes("docs-writer"));
});

Deno.test("magazine index keeps dual-surface /internal and /public routes", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const readerInternal = await handlePortalRequest(
    new Request("http://portico.local/internal", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(readerInternal.status, 200);
  assertEquals(readerInternal.headers.get("content-type"), "text/html; charset=utf-8");
  const readerInternalHtml = await readerInternal.text();
  assert(readerInternalHtml.includes("Docs Writer"));

  const anonInternal = await handlePortalRequest(
    new Request("http://portico.local/internal"),
    context,
  );
  assertEquals(anonInternal.status, 404);
  const anonInternalBody = await anonInternal.text();
  assert(!anonInternalBody.includes("Docs Writer"));

  const anonPublic = await handlePortalRequest(
    new Request("http://portico.local/public"),
    context,
  );
  assertEquals(anonPublic.status, 200);
  const anonPublicHtml = await anonPublic.text();
  assert(!anonPublicHtml.includes("Docs Writer"));
  assert(!anonPublicHtml.includes("jsr:@example/docs-writer"));
});
