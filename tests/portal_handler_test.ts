import { assert, assertEquals } from "./assert.ts";
import { AccessService, MemoryIdentityStore } from "../src/access/mod.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { handlePortalRequest } from "../src/portal/mod.ts";

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
  return { catalog, access };
}

function actorHeaders(actor: Actor): HeadersInit {
  return {
    "x-portico-actor-id": actor.id,
    "x-portico-actor-kind": actor.kind,
    "x-portico-actor-role": actor.role,
  };
}

async function jsonOf(response: Response): Promise<{
  status: number;
  body: { ok: boolean; data?: unknown; error?: { code: string; message: string } };
}> {
  const body = await response.json();
  return { status: response.status, body };
}

Deno.test("reader lists the same internal surface that a maintainer registered", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const response = await handlePortalRequest(
    new Request("http://portico.local/api/catalog", { headers: actorHeaders(reader) }),
    context,
  );
  const { status, body } = await jsonOf(response);

  assertEquals(status, 200);
  assertEquals(body.ok, true);
  const data = body.data as Array<{ id: string; name: string; governanceState: string }>;
  assertEquals(data.length, 1);
  assertEquals(data[0].id, "docs-writer");
  assertEquals(data[0].name, "Docs Writer");
  assertEquals(data[0].governanceState, "internal");
});

Deno.test("anonymous cannot see an internal surface on the portal catalog", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const response = await handlePortalRequest(
    new Request("http://portico.local/api/catalog"),
    context,
  );
  const { status, body } = await jsonOf(response);
  assertEquals(status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.data, []);
});

Deno.test("reader get returns the same record; anonymous get is not found", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const visible = await handlePortalRequest(
    new Request("http://portico.local/api/catalog/docs-writer", {
      headers: actorHeaders(reader),
    }),
    context,
  );
  const got = await jsonOf(visible);
  assertEquals(got.status, 200);
  assertEquals(got.body.ok, true);
  const record = got.body.data as { id: string; governanceState: string };
  assertEquals(record.id, "docs-writer");
  assertEquals(record.governanceState, "internal");

  const hidden = await handlePortalRequest(
    new Request("http://portico.local/api/catalog/docs-writer"),
    context,
  );
  const missing = await jsonOf(hidden);
  assertEquals(missing.status, 404);
  assertEquals(missing.body.ok, false);
  assertEquals(missing.body.error?.code, "NOT_FOUND");
});

Deno.test("dashboard counts only surfaces the actor can see", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const readerDash = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/dashboard", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(readerDash.status, 200);
  assertEquals(readerDash.body.ok, true);
  const readerData = readerDash.body.data as {
    counts: Record<string, number>;
    surfaces: Array<{ id: string }>;
  };
  assertEquals(readerData.counts.visible, 1);
  assertEquals(readerData.counts.internal, 1);
  assertEquals(readerData.counts.approved_public, 0);
  assertEquals(readerData.counts.pending_public, 0);
  assertEquals(readerData.surfaces[0].id, "docs-writer");

  const anonDash = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/dashboard"), context),
  );
  assertEquals(anonDash.status, 200);
  const anonData = anonDash.body.data as { counts: Record<string, number>; surfaces: unknown[] };
  assertEquals(anonData.counts.visible, 0);
  assertEquals(anonData.counts.internal, 0);
  assertEquals(anonData.surfaces, []);
});

Deno.test("HTML discovery shows the reader the same name and hides it from anonymous", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const readerPage = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(readerPage.status, 200);
  assertEquals(readerPage.headers.get("content-type"), "text/html; charset=utf-8");
  const readerHtml = await readerPage.text();
  assert(readerHtml.includes("Docs Writer"), "reader HTML should include the surface name");
  assert(readerHtml.includes("internal"), "reader HTML should include governance state");

  const anonPage = await handlePortalRequest(new Request("http://portico.local/"), context);
  const anonHtml = await anonPage.text();
  assertEquals(anonPage.status, 200);
  assert(!anonHtml.includes("Docs Writer"), "anonymous HTML must not leak internal names");
});

Deno.test("HTML discovery presents clickable directory cards instead of a publish-log table", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const page = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  const html = await page.text();
  assertEquals(page.status, 200);
  assert(html.includes('href="/s/docs-writer"'), "cards must link to an in-portal detail page");
  assert(html.includes("Docs Writer"));
  assert(!html.includes("<th>治理状态</th>"), "homepage must not be a governance spreadsheet");
  assert(!html.includes("<th>可见性</th>"), "homepage must not be a publish-log table");
});

Deno.test("HTML detail shows the reader the surface and hides internal from anonymous", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const readerPage = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(readerPage.status, 200);
  assertEquals(readerPage.headers.get("content-type"), "text/html; charset=utf-8");
  const readerHtml = await readerPage.text();
  assert(readerHtml.includes("Docs Writer"));
  assert(readerHtml.includes("Drafts internal documentation."));
  assert(readerHtml.includes("jsr:@example/docs-writer"));

  const anonPage = await handlePortalRequest(
    new Request("http://portico.local/s/docs-writer"),
    context,
  );
  assertEquals(anonPage.status, 404);
  const anonHtml = await anonPage.text();
  assert(!anonHtml.includes("Docs Writer"), "anonymous detail must not leak internal names");
  assert(!anonHtml.includes("jsr:@example/docs-writer"), "anonymous detail must not leak entries");
});

Deno.test("HTML escapes surface names so portal pages are not a CMS", async () => {
  const context = await seededContext();
  const input = internalCli();
  input.name = "<script>alert(1)</script>";
  await context.catalog.register(maintainer, input);

  const page = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  const html = await page.text();
  assert(!html.includes("<script>alert(1)</script>"), "raw script must not appear");
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "name must be escaped");
});

Deno.test("portal writes are rejected and do not mutate the catalog", async () => {
  const store = new MemoryCatalogStore();
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
  const catalog = new CatalogService(store);
  await catalog.register(maintainer, internalCli());
  const before = JSON.stringify(await store.list());

  const response = await handlePortalRequest(
    new Request("http://portico.local/api/catalog", {
      method: "POST",
      headers: { ...actorHeaders(maintainer), "content-type": "application/json" },
      body: JSON.stringify({ id: "evil", visibility: "public" }),
    }),
    { catalog, access },
  );
  const { status, body } = await jsonOf(response);
  assertEquals(status, 405);
  assertEquals(body.ok, false);
  assertEquals(body.error?.code, "USAGE");
  assertEquals(JSON.stringify(await store.list()), before);
});

Deno.test("claimed role that does not match the roster is forbidden", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const response = await handlePortalRequest(
    new Request("http://portico.local/api/catalog", {
      headers: actorHeaders({ id: "human:reader", kind: "human", role: "auditor" }),
    }),
    context,
  );
  const { status, body } = await jsonOf(response);
  assertEquals(status, 403);
  assertEquals(body.ok, false);
  assertEquals(body.error?.code, "FORBIDDEN");
});

Deno.test("reader sees the same MCP connection on portal that catalog registered", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalMcp());

  const listed = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/mcp", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(listed.status, 200);
  assertEquals(listed.body.ok, true);
  const data = listed.body.data as Array<{
    id: string;
    endpoint: { value: string };
    connect: { mode: string };
  }>;
  assertEquals(data.length, 1);
  assertEquals(data[0].id, "docs-mcp");
  assertEquals(data[0].endpoint.value, "https://mcp.example.test/servers/docs");
  assertEquals(data[0].connect.mode, "direct");

  const described = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/mcp/docs-mcp", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(described.status, 200);
  const record = described.body.data as { id: string; connect: { mode: string } };
  assertEquals(record.id, "docs-mcp");
  assertEquals(record.connect.mode, "direct");
});

Deno.test("reader sees the same web href on portal that catalog registered", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalWeb());

  const listed = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/web", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(listed.status, 200);
  assertEquals(listed.body.ok, true);
  const data = listed.body.data as Array<{
    id: string;
    href: { value: string };
    connect: { mode: string };
  }>;
  assertEquals(data.length, 1);
  assertEquals(data[0].id, "docs-web");
  assertEquals(data[0].href.value, "https://docs.example.test/portals/docs-writer");
  assertEquals(data[0].connect.mode, "direct");

  const described = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/web/docs-web", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(described.status, 200);
  const record = described.body.data as { id: string; connect: { mode: string } };
  assertEquals(record.id, "docs-web");
  assertEquals(record.connect.mode, "direct");

  const html = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(html.status, 200);
  const page = await html.text();
  assert(page.includes("Docs Web"));
  assert(page.includes('href="https://docs.example.test/portals/docs-writer"'));
});

Deno.test("portal HTML escapes web hrefs so entries cannot inject markup", async () => {
  const context = await seededContext();
  const input = internalWeb();
  input.entry = {
    kind: "url",
    value: 'https://docs.example.test/app?q="><script>x</script>',
  };
  await context.catalog.register(maintainer, input);

  const html = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  const page = await html.text();
  assert(!page.includes('"><script>x</script>'), "raw markup must not appear in href");
  assert(page.includes("&quot;"), "quotes in authorized hrefs must be escaped");
  assert(page.includes("&lt;script&gt;"), "angle brackets in authorized hrefs must be escaped");
});

Deno.test("anonymous cannot see an internal web href on the portal", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalWeb());

  const listed = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/web"), context),
  );
  assertEquals(listed.status, 200);
  assertEquals(listed.body.data, []);

  const described = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/web/docs-web"), context),
  );
  assertEquals(described.status, 404);
  assertEquals(described.body.ok, false);
  assertEquals(described.body.error?.code, "NOT_FOUND");

  const html = await handlePortalRequest(new Request("http://portico.local/"), context);
  const page = await html.text();
  assert(!page.includes("Docs Web"));
  assert(!page.includes("https://docs.example.test/portals/docs-writer"));
});

Deno.test("reader sees the same CLI package on portal that catalog registered", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const listed = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/cli", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(listed.status, 200);
  assertEquals(listed.body.ok, true);
  const data = listed.body.data as Array<{
    id: string;
    package: { value: string };
    connect: { mode: string };
  }>;
  assertEquals(data.length, 1);
  assertEquals(data[0].id, "docs-writer");
  assertEquals(data[0].package.value, "jsr:@example/docs-writer");
  assertEquals(data[0].connect.mode, "coordinate");

  const described = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/cli/docs-writer", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(described.status, 200);
  const record = described.body.data as { id: string; connect: { mode: string } };
  assertEquals(record.id, "docs-writer");
  assertEquals(record.connect.mode, "coordinate");

  const html = await handlePortalRequest(
    new Request("http://portico.local/", { headers: actorHeaders(reader) }),
    context,
  );
  assertEquals(html.status, 200);
  const page = await html.text();
  assert(page.includes("Docs Writer"));
  assert(page.includes("jsr:@example/docs-writer"));
  assert(!page.includes('href="jsr:@example/docs-writer"'));
});

Deno.test("anonymous cannot see an internal CLI package on the portal", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const listed = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/cli"), context),
  );
  assertEquals(listed.status, 200);
  assertEquals(listed.body.data, []);

  const described = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/cli/docs-writer"), context),
  );
  assertEquals(described.status, 404);
  assertEquals(described.body.ok, false);
  assertEquals(described.body.error?.code, "NOT_FOUND");

  const html = await handlePortalRequest(new Request("http://portico.local/"), context);
  const page = await html.text();
  assert(!page.includes("Docs Writer"));
  assert(!page.includes("jsr:@example/docs-writer"));
});

Deno.test("anonymous cannot see an internal MCP connection on the portal", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalMcp());

  const listed = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/mcp"), context),
  );
  assertEquals(listed.status, 200);
  assertEquals(listed.body.data, []);

  const described = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/mcp/docs-mcp"), context),
  );
  assertEquals(described.status, 404);
  assertEquals(described.body.ok, false);
  assertEquals(described.body.error?.code, "NOT_FOUND");
});

Deno.test("auditor reads the same security audit on portal that catalog mutations produced", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const listed = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(listed.status, 200);
  assertEquals(listed.body.ok, true);
  const events = listed.body.data as Array<{
    kind: string;
    action: string;
    subjectId: string;
  }>;
  assertEquals(
    events.some((item) => item.kind === "catalog" && item.action === "register"),
    true,
  );
  assertEquals(
    events.some((item) => item.kind === "grant" && item.subjectId === "agent:docs-bot"),
    true,
  );

  const asMaintainer = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit", { headers: actorHeaders(maintainer) }),
      context,
    ),
  );
  assertEquals(asMaintainer.status, 403);
  assertEquals(asMaintainer.body.error?.code, "FORBIDDEN");
});

Deno.test("portal cannot rewrite audit conclusions", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  const before = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(before.status, 200);
  const beforeEvents = before.body.data as Array<{ kind: string }>;
  assertEquals(beforeEvents.some((item) => item.kind === "catalog"), true);

  const posted = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit", {
        method: "PATCH",
        headers: { ...actorHeaders(auditor), "content-type": "application/json" },
        body: JSON.stringify({ conclusion: "cleared" }),
      }),
      context,
    ),
  );
  assertEquals(posted.status, 405);
  assertEquals(posted.body.ok, false);

  const after = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(after.body.data, before.body.data);
});
