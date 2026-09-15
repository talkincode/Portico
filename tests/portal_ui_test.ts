/**
 * Portal UI surfaces: the internal console and the public editorial page.
 *
 * These tests pin the trust boundary as *rendered*, not just as JSON. A view
 * layer may be more restrictive than the catalog service (the public page is),
 * never less: `CatalogService.list` deliberately returns internal and pending
 * records to any reader or maintainer, so the public page has to filter again.
 */

import { assert, assertEquals } from "./assert.ts";
import { type RosterFixture, signedInRoster } from "./fixtures.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { handlePortalRequest } from "../src/portal/mod.ts";

const maintainer: Actor = { id: "agent:docs-bot", kind: "agent", role: "maintainer" };
const reader: Actor = { id: "human:reader", kind: "human", role: "reader" };
const auditor: Actor = { id: "human:security-auditor", kind: "human", role: "auditor" };

function surface(overrides: Partial<RegisterInput> = {}): RegisterInput {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    ...overrides,
  };
}

let roster: RosterFixture;

async function seeded() {
  roster = await signedInRoster();
  const catalog = new CatalogService(new MemoryCatalogStore());
  return { catalog, access: roster.access, roster };
}

/** A real Bearer session: an identity is proven, never asserted. */
function headers(actor: Actor): HeadersInit {
  return roster.headersFor(actor.id);
}

async function get(
  context: Awaited<ReturnType<typeof seeded>>,
  path: string,
  actor?: Actor,
): Promise<{ status: number; html: string }> {
  const response = await handlePortalRequest(
    new Request(`http://portico.local${path}`, actor ? { headers: headers(actor) } : undefined),
    context,
  );
  return { status: response.status, html: await response.text() };
}

/** Register, publish internally, submit publicly, then approve. */
async function publishPublic(
  context: Awaited<ReturnType<typeof seeded>>,
  input: RegisterInput,
): Promise<void> {
  await context.catalog.register(maintainer, input);
  await context.catalog.publish(maintainer, { id: input.id, visibility: "internal" });
  await context.catalog.publish(maintainer, { id: input.id, visibility: "public" });
  await context.catalog.approve(auditor, { id: input.id });
}

Deno.test("the internal console renders a record to a maintainer", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  const { status, html } = await get(context, "/internal", maintainer);
  assertEquals(status, 200);
  assert(html.includes("Docs Writer"), "console must show the record name");
  assert(html.includes("jsr:@example/docs-writer"), "console must show the package coordinate");
  assert(html.includes("维护者"), "console must show the reader's role");
  assert(html.includes("内部笔记台") || html.includes("全部内容"), "console must render its shell");
});

Deno.test("the internal console shows governance states the public page must never carry", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface({ id: "draft-one", name: "Draft One" }));
  await context.catalog.register(maintainer, surface({ id: "pending-one", name: "Pending One" }));
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "public" });

  const console_ = await get(context, "/internal", maintainer);
  assert(console_.html.includes("Draft One"), "console must show drafts to a maintainer");
  assert(console_.html.includes("Pending One"), "console must show pending records");

  // The same maintainer session must not see either on the public page.
  const published = await get(context, "/public", maintainer);
  assert(!published.html.includes("Draft One"), "a draft must not reach the public page");
  assert(
    !published.html.includes("Pending One"),
    "a pending record must not reach the public page",
  );
});

Deno.test("anonymous callers get 404 on every internal route, never a 403", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  for (const path of ["/internal", "/internal/c", "/internal/audit", "/internal/s/docs-writer"]) {
    const { status, html } = await get(context, path);
    assertEquals(status, 404, `${path} must be 404 for anonymous`);
    assert(!html.includes("Docs Writer"), `${path} must not leak an internal record`);
    assert(
      !html.includes("FORBIDDEN"),
      `${path} must not confirm that an internal console exists`,
    );
  }
});

Deno.test("anonymous internal pages 404 as HTML, not a JSON envelope", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  for (const path of ["/internal", "/internal/c", "/internal/audit", "/internal/s/docs-writer"]) {
    const response = await handlePortalRequest(
      new Request(`http://portico.local${path}`),
      context,
    );
    assertEquals(response.status, 404, `${path} must be 404 for anonymous`);
    assertEquals(
      response.headers.get("content-type"),
      "text/html; charset=utf-8",
      `${path} must be a page, not an API error`,
    );
    const body = await response.text();
    assert(body.includes("<!DOCTYPE html>"), `${path} must render HTML`);
    assert(!body.trimStart().startsWith("{"), `${path} must not leak a JSON envelope`);
    assert(!body.includes("Docs Writer"), `${path} must not leak an internal record`);
    assert(!body.includes("FORBIDDEN"), `${path} must not confirm the console exists`);
    assert(!body.includes("内部笔记台"), `${path} must not reveal the internal shell`);
  }
});

Deno.test("an unpublished public article 404s as HTML, not JSON", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface({ id: "internal-one", name: "Internal One" }));
  await context.catalog.publish(maintainer, { id: "internal-one", visibility: "internal" });

  const response = await handlePortalRequest(
    new Request("http://portico.local/public/s/internal-one"),
    context,
  );
  assertEquals(response.status, 404);
  assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
  const body = await response.text();
  assert(body.includes("<!DOCTYPE html>"));
  assert(!body.trimStart().startsWith("{"));
  assert(!body.includes("Internal One"));
});

Deno.test("a reader sees the console but no audit trail entry or reset of it", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  const asReader = await get(context, "/internal", reader);
  assertEquals(asReader.status, 200);
  assert(asReader.html.includes("全部内容"), "a reader gets the console");
  assert(
    !asReader.html.includes("/internal/audit"),
    "a reader must not be offered the audit trail",
  );

  const asAuditor = await get(context, "/internal", auditor);
  assert(asAuditor.html.includes("/internal/audit"), "an auditor gets the audit trail");
});

Deno.test("the audit route is 404 for anyone but a human auditor", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  const asAuditor = await get(context, "/internal/audit", auditor);
  assertEquals(asAuditor.status, 200);
  assert(asAuditor.html.includes("审计时间线"), "auditor must get the timeline");
  assert(asAuditor.html.includes("register"), "the timeline must carry the register event");

  for (const actor of [maintainer, reader]) {
    const page = await get(context, "/internal/audit", actor);
    assertEquals(page.status, 404, `${actor.role} must not learn the audit route exists`);
    assert(!page.html.includes("审计时间线"), `${actor.role} must not get the audit screen`);
    assert(!page.html.includes("register"), `${actor.role} must not receive audit events`);
  }
});

Deno.test("the public page publishes only approved surfaces", async () => {
  const context = await seeded();
  await publishPublic(context, surface({ id: "public-one", name: "Public One" }));
  await context.catalog.register(maintainer, surface({ id: "internal-one", name: "Internal One" }));
  await context.catalog.publish(maintainer, { id: "internal-one", visibility: "internal" });

  for (const actor of [undefined, reader, maintainer, auditor]) {
    const { status, html } = await get(context, "/public", actor);
    assertEquals(status, 200);
    assert(html.includes("Public One"), "the approved surface must be published");
    assert(
      !html.includes("Internal One"),
      `${actor?.role ?? "anonymous"} must not see an internal surface on the public page`,
    );
  }
});

Deno.test("an unapproved record has no public article, even for its own maintainer", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface({ id: "internal-one", name: "Internal One" }));
  await context.catalog.publish(maintainer, { id: "internal-one", visibility: "internal" });

  for (const actor of [undefined, maintainer, auditor]) {
    const { status, html } = await get(context, "/public/s/internal-one", actor);
    assertEquals(status, 404, `${actor?.role ?? "anonymous"} must not read an unpublished article`);
    assert(!html.includes("Internal One"), "the unpublished name must not leak");
  }

  await context.catalog.publish(maintainer, { id: "internal-one", visibility: "public" });
  const pending = await get(context, "/public/s/internal-one", maintainer);
  assertEquals(pending.status, 404, "a pending candidate is still not published");
});

Deno.test("a withdrawn surface disappears from the public page and its article", async () => {
  const context = await seeded();
  await publishPublic(context, surface({ id: "public-one", name: "Public One" }));

  const before = await get(context, "/public/s/public-one");
  assertEquals(before.status, 200);
  assert(before.html.includes("Public One"));

  await context.catalog.withdraw(auditor, { id: "public-one" });

  const index = await get(context, "/public");
  assert(!index.html.includes("Public One"), "a withdrawn surface must leave the public index");
  const article = await get(context, "/public/s/public-one");
  assertEquals(article.status, 404);
  assertEquals(article.html.includes("Public One"), false);
});

Deno.test("published pages and consoles ship no script", async () => {
  const context = await seeded();
  await publishPublic(context, surface({ id: "public-one", name: "Public One" }));
  await context.catalog.register(maintainer, surface({ id: "draft-one", name: "Draft One" }));

  for (
    const [path, actor] of [
      ["/public", undefined],
      ["/public/s/public-one", undefined],
      ["/public/t/cli", undefined],
      ["/internal", maintainer],
      ["/internal/c", maintainer],
      ["/internal/audit", auditor],
      ["/internal/s/draft-one", maintainer],
    ] as const
  ) {
    const { status, html } = await get(context, path, actor);
    assertEquals(status, 200, `${path} should render`);
    assert(!/<script/i.test(html), `${path} must not contain a script element`);
    assert(!/\son\w+\s*=/i.test(html), `${path} must not contain an inline event handler`);
    assert(!/javascript:/i.test(html), `${path} must not contain a javascript: URL`);
  }
});

Deno.test("the console escapes names, descriptions, and coordinates", async () => {
  const context = await seeded();
  await context.catalog.register(
    maintainer,
    surface({
      id: "escape-me",
      name: "<script>alert(1)</script>",
      description: '"><img src=x onerror=alert(1)>',
    }),
  );

  const { html } = await get(context, "/internal", maintainer);
  assert(!html.includes("<script>alert(1)</script>"), "raw script must not appear");
  assert(!html.includes("<img src=x"), "raw markup must not appear");
  assert(html.includes("&lt;script&gt;"), "the name must be escaped");
});

Deno.test("the public page escapes the description and never links a package coordinate", async () => {
  const context = await seeded();
  await publishPublic(
    context,
    surface({
      id: "escape-me",
      name: "Escape Me",
      description: "<b>not markup</b>",
      entry: { kind: "package", value: "jsr:@example/escape-me" },
    }),
  );

  const index = await get(context, "/public");
  assert(!index.html.includes("<b>not markup</b>"), "description must be escaped");
  assert(index.html.includes("&lt;b&gt;not markup&lt;/b&gt;"), "escaped description must appear");
  assert(
    !index.html.includes('href="jsr:@example/escape-me"'),
    "a package coordinate must never become a download link",
  );

  const article = await get(context, "/public/s/escape-me");
  assert(!article.html.includes('href="jsr:@example/escape-me"'), "coordinate stays inert");
  assert(article.html.includes("jsr:@example/escape-me"), "coordinate is still shown as code");
});

Deno.test("only an approved http(s) entry becomes a link", async () => {
  const context = await seeded();
  await publishPublic(
    context,
    surface({
      id: "web-one",
      name: "Web One",
      channels: ["web"],
      entry: { kind: "url", value: "https://docs.example.test/portals/one" },
    }),
  );

  const linkable = await get(context, "/public/s/web-one");
  assert(
    linkable.html.includes('href="https://docs.example.test/portals/one"'),
    "an approved web entry is a direct link",
  );

  // The same entry on an internal-only record must stay inert.
  await context.catalog.register(
    maintainer,
    surface({
      id: "web-two",
      name: "Web Two",
      channels: ["web"],
      entry: { kind: "url", value: "https://internal.example.test/secret" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "web-two", visibility: "internal" });

  const inert = await get(context, "/internal/c", maintainer);
  assert(
    !inert.html.includes('href="https://internal.example.test/secret"'),
    "an internal entry must not be rendered as a clickable target",
  );
  assert(inert.html.includes("https://internal.example.test/secret"), "but it is still visible");
});

Deno.test("the theme switch is pure CSS and keeps the current path", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());
  await publishPublic(context, surface({ id: "public-one", name: "Public One" }));

  const internal = await get(context, "/internal", maintainer);
  assert(internal.html.includes('data-theme="portico-internal-light"'), "default internal preset");
  assert(
    internal.html.includes('href="/internal?theme=portico-internal-dark"'),
    "the switch must link to the other mode on the same path",
  );

  const dark = await get(context, "/internal?theme=internal-dark", maintainer);
  assert(
    dark.html.includes('data-theme="portico-internal-dark"'),
    "the dark preset must be painted",
  );
  assert(dark.html.includes('data-mode="dark"'), "the mode must be recorded on the body");
  assert(
    dark.html.includes('href="/internal?theme=portico-internal-light"'),
    "the switch must keep the query path",
  );

  const published = await get(context, "/public");
  assert(
    published.html.includes('data-theme="portico-editorial-light"'),
    "the public page must use the editorial preset",
  );
  assert(published.html.includes('data-tone="public"'), "the public page must carry its tone");
  assert(internal.html.includes('data-tone="internal"'), "the console must carry its tone");
});

Deno.test("an unknown theme name degrades to the surface default instead of failing", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  const { status, html } = await get(context, "/internal?theme=nonsense", maintainer);
  assertEquals(status, 200);
  assert(html.includes('data-theme="portico-internal-light"'), "must fall back, not 500");

  const crossTone = await get(context, "/public?theme=internal-dark");
  assertEquals(crossTone.status, 200);
  assert(
    crossTone.html.includes('data-theme="portico-editorial-light"'),
    "a preset from the other tone must not leak across surfaces",
  );
});

Deno.test("the public channel topic lists only that channel's approved surfaces", async () => {
  const context = await seeded();
  await publishPublic(context, surface({ id: "cli-one", name: "Cli One", channels: ["cli"] }));
  await publishPublic(
    context,
    surface({
      id: "mcp-one",
      name: "Mcp One",
      channels: ["mcp"],
      entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/one" },
    }),
  );

  const cli = await get(context, "/public/t/cli");
  assertEquals(cli.status, 200);
  assert(cli.html.includes("Cli One"), "the CLI topic must list the CLI surface");
  assert(!cli.html.includes("Mcp One"), "the CLI topic must not list an MCP surface");

  const mcp = await get(context, "/public/t/mcp");
  assert(mcp.html.includes("Mcp One"));
  assert(!mcp.html.includes("Cli One"));

  assertEquals((await get(context, "/public/t/nope")).status, 404);
});

Deno.test("public and internal planes link back to magazine discovery without leaking /internal on the public page", async () => {
  const context = await seeded();
  await publishPublic(
    context,
    surface({
      id: "docs-web",
      name: "Docs Web",
      channels: ["web"],
      entry: { kind: "url", value: "https://docs.example.test/portals/docs-writer" },
    }),
  );
  const before = JSON.stringify(await context.catalog.list(maintainer));

  const anonPublic = await get(context, "/public");
  assertEquals(anonPublic.status, 200);
  assert(anonPublic.html.includes('href="/"'), "public index must reach magazine discovery");
  assert(anonPublic.html.includes(">发现</a>"));
  assert(
    !anonPublic.html.includes('href="/internal"'),
    "the public surface must not advertise the internal workbench",
  );

  const article = await get(context, "/public/s/docs-web");
  assertEquals(article.status, 200);
  assert(
    article.html.includes('href="/s/docs-web"'),
    "an approved public article may point at the magazine reading page",
  );
  assert(!article.html.includes('href="/internal"'));

  const readerInternal = await get(context, "/internal", reader);
  assertEquals(readerInternal.status, 200);
  assert(
    readerInternal.html.includes('href="/"'),
    "internal console must reach magazine discovery",
  );
  assert(readerInternal.html.includes(">发现</a>"));

  const anonInternal = await get(context, "/internal");
  assertEquals(anonInternal.status, 404);
  assert(!anonInternal.html.includes("Docs Web"));
  assertEquals(JSON.stringify(await context.catalog.list(maintainer)), before);
});
