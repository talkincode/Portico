import { assert, assertEquals } from "./assert.ts";
import { type RosterFixture, signedInRoster } from "./fixtures.ts";
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

let roster: RosterFixture;

async function seededContext() {
  roster = await signedInRoster();
  const access = roster.access;
  const catalog = new CatalogService(new MemoryCatalogStore());
  return { catalog, access };
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
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  const before = JSON.stringify(await context.catalog.list(auditor));

  const response = await handlePortalRequest(
    new Request("http://portico.local/api/catalog", {
      method: "POST",
      headers: { ...actorHeaders(maintainer), "content-type": "application/json" },
      body: JSON.stringify({ id: "evil", visibility: "public" }),
    }),
    context,
  );
  const { status, body } = await jsonOf(response);
  assertEquals(status, 405);
  assertEquals(body.ok, false);
  assertEquals(body.error?.code, "USAGE");
  assertEquals(JSON.stringify(await context.catalog.list(auditor)), before);
});

Deno.test("a forged actor header grants nothing; the caller gets the anonymous view", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  // The exact strings an agent would copy out of the README, with no session.
  const forged = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/catalog", {
        headers: {
          "x-portico-actor-id": "human:security-auditor",
          "x-portico-actor-kind": "human",
          "x-portico-actor-role": "auditor",
        },
      }),
      context,
    ),
  );
  assertEquals(forged.status, 200);
  // Anonymous sees no internal record, and in particular not the audit trail.
  assertEquals(forged.body.data, []);

  const audit = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit", {
        headers: {
          "x-portico-actor-id": "human:security-auditor",
          "x-portico-actor-kind": "human",
          "x-portico-actor-role": "auditor",
        },
      }),
      context,
    ),
  );
  assertEquals(audit.status, 403);
  assertEquals(audit.body.error?.code, "FORBIDDEN");

  // A real session for the same identity does see it.
  const real = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/catalog", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(real.status, 200);
  assertEquals((real.body.data as Array<{ id: string }>).map((s) => s.id), ["docs-writer"]);
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

Deno.test("audit query filters the auditor timeline and stays forbidden for others", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const filtered = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit?kind=catalog&q=Writer", {
        headers: actorHeaders(auditor),
      }),
      context,
    ),
  );
  assertEquals(filtered.status, 200);
  const events = filtered.body.data as Array<{
    kind: string;
    subjectId: string;
    entry?: { value: string };
  }>;
  assertEquals(events.length >= 1, true);
  assertEquals(events.every((item) => item.kind === "catalog"), true);
  assertEquals(events.every((item) => item.subjectId === "docs-writer"), true);

  const byCoordinate = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit?q=jsr%3A%40example%2Fdocs-writer", {
        headers: actorHeaders(auditor),
      }),
      context,
    ),
  );
  assertEquals(byCoordinate.status, 200);
  assertEquals(byCoordinate.body.data, []);

  const asMaintainer = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit?kind=catalog", {
        headers: actorHeaders(maintainer),
      }),
      context,
    ),
  );
  assertEquals(asMaintainer.status, 403);
  assertEquals(asMaintainer.body.error?.code, "FORBIDDEN");

  const badKind = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit?kind=runtime", {
        headers: actorHeaders(auditor),
      }),
      context,
    ),
  );
  assertEquals(badKind.status, 400);
  assertEquals(badKind.body.error?.code, "INVALID_INPUT");
});

Deno.test("catalog query filters visible records and does not leak internals to anonymous", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.catalog.register(maintainer, internalWeb());
  await context.catalog.publish(maintainer, { id: "docs-web", visibility: "public" });
  await context.catalog.approve(auditor, { id: "docs-web" });

  const readerHit = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/catalog?q=Writer", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(readerHit.status, 200);
  const readerIds = (readerHit.body.data as Array<{ id: string }>).map((item) => item.id);
  assertEquals(readerIds, ["docs-writer"]);

  const anonMiss = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/catalog?q=Writer"), context),
  );
  assertEquals(anonMiss.status, 200);
  assertEquals(anonMiss.body.data, []);

  const anonPublic = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/catalog?q=Web"), context),
  );
  assertEquals(
    (anonPublic.body.data as Array<{ id: string }>).map((item) => item.id),
    ["docs-web"],
  );

  const bad = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/catalog?channel=carrier-pigeon"),
      context,
    ),
  );
  assertEquals(bad.status, 400);
  assertEquals(bad.body.error?.code, "INVALID_INPUT");
});

Deno.test("maintainer and auditor list the same roster on portal; reader and anonymous cannot", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());

  const expected = [
    { id: "agent:docs-bot", kind: "agent", role: "maintainer" },
    { id: "human:reader", kind: "human", role: "reader" },
    { id: "human:security-auditor", kind: "human", role: "auditor" },
  ];

  const asMaintainer = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/identities", { headers: actorHeaders(maintainer) }),
      context,
    ),
  );
  assertEquals(asMaintainer.status, 200);
  assertEquals(asMaintainer.body.ok, true);
  const maintainerIds =
    (asMaintainer.body.data as Array<{ id: string; kind: string; role: string }>)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
  assertEquals(maintainerIds, expected);
  assertEquals(
    JSON.stringify(asMaintainer.body.data).includes("secretHash") ||
      JSON.stringify(asMaintainer.body.data).includes("tokenHash") ||
      JSON.stringify(asMaintainer.body.data).includes("pct1_") ||
      JSON.stringify(asMaintainer.body.data).includes("pst1_"),
    false,
    "roster listing must not leak credential or session secrets",
  );

  const asAuditor = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/identities", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(asAuditor.status, 200);
  assertEquals(asAuditor.body.data, asMaintainer.body.data);

  const asReader = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/identities", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(asReader.status, 403);
  assertEquals(asReader.body.ok, false);
  assertEquals(asReader.body.error?.code, "FORBIDDEN");

  const asAnon = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/identities"), context),
  );
  assertEquals(asAnon.status, 403);
  assertEquals(asAnon.body.error?.code, "FORBIDDEN");
});

Deno.test("auditor lists the same grant trail on portal; maintainer, reader and anonymous cannot", async () => {
  const context = await seededContext();
  const expected = await context.access.listGrants(auditor);
  assertEquals(expected.length >= 2, true);
  assertEquals(expected.some((row) => row.subjectId === "human:security-auditor"), true);
  assertEquals(expected.some((row) => row.subjectId === "agent:docs-bot"), true);

  const asAuditor = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/grants", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(asAuditor.status, 200);
  assertEquals(asAuditor.body.ok, true);
  assertEquals(asAuditor.body.data, expected);
  assertEquals(
    JSON.stringify(asAuditor.body.data).includes("secretHash") ||
      JSON.stringify(asAuditor.body.data).includes("tokenHash") ||
      JSON.stringify(asAuditor.body.data).includes("pct1_") ||
      JSON.stringify(asAuditor.body.data).includes("pst1_"),
    false,
    "grant trail must not leak credential or session secrets",
  );

  const asMaintainer = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/grants", { headers: actorHeaders(maintainer) }),
      context,
    ),
  );
  assertEquals(asMaintainer.status, 403);
  assertEquals(asMaintainer.body.error?.code, "FORBIDDEN");

  const asReader = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/grants", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(asReader.status, 403);
  assertEquals(asReader.body.error?.code, "FORBIDDEN");

  const asAnon = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/grants"), context),
  );
  assertEquals(asAnon.status, 403);
  assertEquals(asAnon.body.error?.code, "FORBIDDEN");

  const posted = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/grants", {
        method: "POST",
        headers: actorHeaders(auditor),
      }),
      context,
    ),
  );
  assertEquals(posted.status, 405);
  assertEquals(posted.body.error?.code, "USAGE");
  assertEquals(await context.access.listGrants(auditor), expected);
});

Deno.test("auditor lists the same session trail on portal; maintainer, reader and anonymous cannot", async () => {
  const context = await seededContext();
  const expected = await context.access.listSessions(auditor);
  assertEquals(expected.length >= 3, true);
  assertEquals(expected.some((row) => row.subjectId === auditor.id), true);
  assertEquals(expected.some((row) => row.subjectId === maintainer.id), true);

  const asAuditor = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/sessions", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(asAuditor.status, 200);
  assertEquals(asAuditor.body.ok, true);
  assertEquals(asAuditor.body.data, expected);
  assertEquals(
    JSON.stringify(asAuditor.body.data).includes("secretHash") ||
      JSON.stringify(asAuditor.body.data).includes("tokenHash") ||
      JSON.stringify(asAuditor.body.data).includes("pct1_") ||
      JSON.stringify(asAuditor.body.data).includes("pst1_"),
    false,
    "session trail must not leak credential or session secrets",
  );

  const asMaintainer = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/sessions", { headers: actorHeaders(maintainer) }),
      context,
    ),
  );
  assertEquals(asMaintainer.status, 403);
  assertEquals(asMaintainer.body.error?.code, "FORBIDDEN");

  const asReader = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/sessions", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(asReader.status, 403);
  assertEquals(asReader.body.error?.code, "FORBIDDEN");

  const asAnon = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/sessions"), context),
  );
  assertEquals(asAnon.status, 403);
  assertEquals(asAnon.body.error?.code, "FORBIDDEN");

  const posted = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/sessions", {
        method: "POST",
        headers: actorHeaders(auditor),
      }),
      context,
    ),
  );
  assertEquals(posted.status, 405);
  assertEquals(posted.body.error?.code, "USAGE");
  assertEquals(await context.access.listSessions(auditor), expected);
});

Deno.test("auditor lists the same credential trail on portal; maintainer, reader and anonymous cannot", async () => {
  const context = await seededContext();
  const expected = await context.access.listCredentials(auditor);
  assertEquals(expected.length >= 3, true);
  assertEquals(expected.some((row) => row.subjectId === auditor.id), true);
  assertEquals(expected.some((row) => row.subjectId === maintainer.id), true);
  assertEquals(expected.some((row) => row.subjectId === reader.id), true);

  const asAuditor = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/credentials", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(asAuditor.status, 200);
  assertEquals(asAuditor.body.ok, true);
  assertEquals(asAuditor.body.data, expected);
  assertEquals(
    JSON.stringify(asAuditor.body.data).includes("secretHash") ||
      JSON.stringify(asAuditor.body.data).includes("tokenHash") ||
      JSON.stringify(asAuditor.body.data).includes("pct1_") ||
      JSON.stringify(asAuditor.body.data).includes("pst1_"),
    false,
    "credential trail must not leak credential or session secrets",
  );

  const asMaintainer = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/credentials", { headers: actorHeaders(maintainer) }),
      context,
    ),
  );
  assertEquals(asMaintainer.status, 403);
  assertEquals(asMaintainer.body.error?.code, "FORBIDDEN");

  const asReader = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/credentials", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(asReader.status, 403);
  assertEquals(asReader.body.error?.code, "FORBIDDEN");

  const asAnon = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/credentials"), context),
  );
  assertEquals(asAnon.status, 403);
  assertEquals(asAnon.body.error?.code, "FORBIDDEN");

  const posted = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/credentials", {
        method: "POST",
        headers: actorHeaders(auditor),
      }),
      context,
    ),
  );
  assertEquals(posted.status, 405);
  assertEquals(posted.body.error?.code, "USAGE");
  assertEquals(await context.access.listCredentials(auditor), expected);
});

Deno.test("auditor lists the same revoke trail on portal; maintainer, reader and anonymous cannot", async () => {
  const context = await seededContext();
  await context.access.grant(auditor, {
    id: "agent:retired-bot",
    kind: "agent",
    role: "maintainer",
  });
  await context.access.revoke(auditor, { id: "agent:retired-bot" });
  const expected = await context.access.listRevokes(auditor);
  assertEquals(expected.length, 1);
  assertEquals(expected[0].subjectId, "agent:retired-bot");

  const asAuditor = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/revokes", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(asAuditor.status, 200);
  assertEquals(asAuditor.body.ok, true);
  assertEquals(asAuditor.body.data, expected);
  assertEquals(
    JSON.stringify(asAuditor.body.data).includes("secretHash") ||
      JSON.stringify(asAuditor.body.data).includes("tokenHash") ||
      JSON.stringify(asAuditor.body.data).includes("pct1_") ||
      JSON.stringify(asAuditor.body.data).includes("pst1_"),
    false,
    "revoke trail must not leak credential or session secrets",
  );

  const asMaintainer = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/revokes", { headers: actorHeaders(maintainer) }),
      context,
    ),
  );
  assertEquals(asMaintainer.status, 403);
  assertEquals(asMaintainer.body.error?.code, "FORBIDDEN");

  const asReader = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/revokes", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(asReader.status, 403);
  assertEquals(asReader.body.error?.code, "FORBIDDEN");

  const asAnon = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/revokes"), context),
  );
  assertEquals(asAnon.status, 403);
  assertEquals(asAnon.body.error?.code, "FORBIDDEN");

  const posted = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/revokes", {
        method: "POST",
        headers: actorHeaders(auditor),
      }),
      context,
    ),
  );
  assertEquals(posted.status, 405);
  assertEquals(posted.body.error?.code, "USAGE");
  assertEquals(await context.access.listRevokes(auditor), expected);
});

Deno.test("signed-in callers see their own identity on portal whoami; anonymous cannot", async () => {
  const context = await seededContext();
  const expectedReader = await context.access.whoami(reader);
  assertEquals(expectedReader, { id: reader.id, kind: "human", role: "reader" });

  const asReader = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/whoami", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(asReader.status, 200);
  assertEquals(asReader.body.ok, true);
  assertEquals(asReader.body.data, expectedReader);

  const asMaintainer = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/whoami", { headers: actorHeaders(maintainer) }),
      context,
    ),
  );
  assertEquals(asMaintainer.status, 200);
  assertEquals(asMaintainer.body.data, await context.access.whoami(maintainer));

  const asAuditor = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/whoami", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(asAuditor.status, 200);
  assertEquals(asAuditor.body.data, await context.access.whoami(auditor));
  assertEquals(
    JSON.stringify(asAuditor.body.data).includes("secretHash") ||
      JSON.stringify(asAuditor.body.data).includes("tokenHash") ||
      JSON.stringify(asAuditor.body.data).includes("pct1_") ||
      JSON.stringify(asAuditor.body.data).includes("pst1_"),
    false,
    "whoami must not leak credential or session secrets",
  );

  const asAnon = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/whoami"), context),
  );
  assertEquals(asAnon.status, 403);
  assertEquals(asAnon.body.error?.code, "FORBIDDEN");

  const posted = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/whoami", {
        method: "POST",
        headers: actorHeaders(reader),
      }),
      context,
    ),
  );
  assertEquals(posted.status, 405);
  assertEquals(posted.body.error?.code, "USAGE");
  assertEquals(await context.access.whoami(reader), expectedReader);
});

Deno.test("signed-in callers see the same approval records on portal; anonymous sees none", async () => {
  const context = await seededContext();
  await context.catalog.register(maintainer, internalCli());
  await context.catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await context.catalog.approve(auditor, { id: "docs-writer" });
  const expected = await context.catalog.listApprovals(auditor);
  assertEquals(expected.length, 1);
  assertEquals(expected[0].surfaceId, "docs-writer");
  assertEquals(expected[0].decision, "approved");

  const asAuditor = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/approvals", { headers: actorHeaders(auditor) }),
      context,
    ),
  );
  assertEquals(asAuditor.status, 200);
  assertEquals(asAuditor.body.ok, true);
  assertEquals(asAuditor.body.data, expected);

  const asMaintainer = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/approvals", { headers: actorHeaders(maintainer) }),
      context,
    ),
  );
  assertEquals(asMaintainer.status, 200);
  assertEquals(asMaintainer.body.data, expected);

  const asReader = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/approvals", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(asReader.status, 200);
  assertEquals(asReader.body.data, expected);

  const asAnon = await jsonOf(
    await handlePortalRequest(new Request("http://portico.local/api/approvals"), context),
  );
  assertEquals(asAnon.status, 200);
  assertEquals(asAnon.body.ok, true);
  assertEquals(asAnon.body.data, []);

  const posted = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/approvals", {
        method: "POST",
        headers: actorHeaders(auditor),
      }),
      context,
    ),
  );
  assertEquals(posted.status, 405);
  assertEquals(posted.body.error?.code, "USAGE");
  assertEquals(await context.catalog.listApprovals(auditor), expected);
});

async function withMappedEmail() {
  const context = await seededContext();
  await context.access.grant(auditor, {
    id: reader.id,
    kind: "human",
    role: "reader",
    email: "reader@example.invalid",
  });
  await context.catalog.register(maintainer, internalCli());
  return context;
}

function cfAccessThatMaps(token = "valid-assertion", email = "reader@example.invalid") {
  return {
    verify: (assertion: string) => Promise.resolve(assertion === token ? { email } : null),
  };
}

Deno.test("a verified CF Access JWT maps a roster email to the same internal catalog as a session", async () => {
  const context = await withMappedEmail();
  const viaJwt = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/catalog", {
        headers: { "cf-access-jwt-assertion": "valid-assertion" },
      }),
      { ...context, cfAccess: cfAccessThatMaps() },
    ),
  );
  const viaSession = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/catalog", { headers: actorHeaders(reader) }),
      context,
    ),
  );
  assertEquals(viaJwt.status, 200);
  assertEquals(viaJwt.body.data, viaSession.body.data);

  const internal = await handlePortalRequest(
    new Request("http://portico.local/internal", {
      headers: { "cf-access-jwt-assertion": "valid-assertion" },
    }),
    { ...context, cfAccess: cfAccessThatMaps() },
  );
  assertEquals(internal.status, 200);
  assert((await internal.text()).includes("Docs Writer"));
});

Deno.test("CF Access JWT failures and the plaintext email header stay anonymous", async () => {
  const context = await withMappedEmail();
  const cfAccess = cfAccessThatMaps();
  const cases: HeadersInit[] = [
    { "cf-access-jwt-assertion": "forged" },
    { "cf-access-authenticated-user-email": "reader@example.invalid" },
    {
      "cf-access-authenticated-user-email": "reader@example.invalid",
      "cf-access-jwt-assertion": "forged",
    },
  ];
  for (const headers of cases) {
    const catalog = await jsonOf(
      await handlePortalRequest(
        new Request("http://portico.local/api/catalog", { headers }),
        { ...context, cfAccess },
      ),
    );
    assertEquals(catalog.status, 200);
    assertEquals(catalog.body.data, []);

    const internal = await handlePortalRequest(
      new Request("http://portico.local/internal", { headers }),
      { ...context, cfAccess },
    );
    assertEquals(internal.status, 404);
    assert(!(await internal.text()).includes("Docs Writer"));
  }
});

Deno.test("a Portico session wins over a CF Access JWT; disabled CF Access ignores the assertion", async () => {
  const context = await withMappedEmail();
  await context.access.grant(auditor, {
    id: "human:mapped-auditor",
    kind: "human",
    role: "auditor",
    email: "auditor@example.invalid",
  });

  const mixed = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/audit", {
        headers: {
          ...actorHeaders(reader),
          "cf-access-jwt-assertion": "auditor-assertion",
        },
      }),
      {
        ...context,
        cfAccess: cfAccessThatMaps("auditor-assertion", "auditor@example.invalid"),
      },
    ),
  );
  assertEquals(mixed.status, 403);
  assertEquals(mixed.body.error?.code, "FORBIDDEN");

  const ignored = await jsonOf(
    await handlePortalRequest(
      new Request("http://portico.local/api/catalog", {
        headers: { "cf-access-jwt-assertion": "valid-assertion" },
      }),
      context,
    ),
  );
  assertEquals(ignored.status, 200);
  assertEquals(ignored.body.data, []);
});
