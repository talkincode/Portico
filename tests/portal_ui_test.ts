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
  type AgentSurface,
  type ApprovalRecord,
  type CatalogChangeRecord,
  CatalogService,
  type CatalogStore,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { AnchorService, MemoryAnchorStore, SEAL_PILLARS, SealService } from "../src/audit/mod.ts";
import { handlePortalRequest, type PortalContext } from "../src/portal/mod.ts";

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
  context: PortalContext,
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
  context: PortalContext,
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

Deno.test("anonymous callers redirect to login on every internal route, never a 403", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  for (
    const path of [
      "/internal",
      "/internal/c",
      "/internal/audit",
      "/internal/approvals",
      "/internal/pending",
      "/internal/s/docs-writer",
    ]
  ) {
    const response = await handlePortalRequest(
      new Request(`http://portico.local${path}`),
      context,
    );
    assertEquals(response.status, 303, `${path} must redirect anonymous to login`);
    const location = response.headers.get("location");
    assert(location?.startsWith("/login"), `${path} must redirect to /login`);
    assert(location?.includes(`next=`), `${path} redirect must carry a next param`);
    const html = await response.text();
    assert(!html.includes("Docs Writer"), `${path} must not leak an internal record`);
    assert(
      !html.includes("FORBIDDEN"),
      `${path} must not confirm that an internal console exists`,
    );
  }
});

Deno.test("anonymous internal pages redirect to login, not a JSON envelope", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  for (
    const path of [
      "/internal",
      "/internal/c",
      "/internal/audit",
      "/internal/approvals",
      "/internal/pending",
      "/internal/s/docs-writer",
    ]
  ) {
    const response = await handlePortalRequest(
      new Request(`http://portico.local${path}`),
      context,
    );
    assertEquals(response.status, 303, `${path} must redirect anonymous to login`);
    const location = response.headers.get("location");
    assert(location?.startsWith("/login"), `${path} redirect must go to /login`);
    const body = await response.text();
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
  assert(
    asReader.html.includes("/internal/approvals"),
    "a reader is offered the public-decision trail",
  );
  assert(
    asReader.html.includes("/internal/pending"),
    "a reader is offered the pending-public queue",
  );

  const asAuditor = await get(context, "/internal", auditor);
  assert(asAuditor.html.includes("/internal/audit"), "an auditor gets the audit trail");
  assert(
    asAuditor.html.includes("/internal/approvals"),
    "an auditor is offered the public-decision trail",
  );
  assert(
    asAuditor.html.includes("/internal/pending"),
    "an auditor is offered the pending-public queue",
  );
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

/**
 * A store whose change trail disagrees with the chain sealed over it: the
 * signature of someone editing `catalog.json` with an editor or a shell, which
 * the seal exists to turn into a named finding instead of a silent rewrite.
 */
class EditedTrailStore implements CatalogStore {
  constructor(private readonly inner: CatalogStore) {}

  list(): Promise<AgentSurface[]> {
    return this.inner.list();
  }

  get(id: string): Promise<AgentSurface | undefined> {
    return this.inner.get(id);
  }

  put(record: AgentSurface): Promise<void> {
    return this.inner.put(record);
  }

  listApprovals(): Promise<ApprovalRecord[]> {
    return this.inner.listApprovals();
  }

  listSeal() {
    return this.inner.listSeal();
  }

  commitChange(record: AgentSurface, change: CatalogChangeRecord): Promise<void> {
    return this.inner.commitChange(record, change);
  }

  commitApproval(record: AgentSurface, approval: ApprovalRecord): Promise<void> {
    return this.inner.commitApproval(record, approval);
  }

  async listChanges(): Promise<CatalogChangeRecord[]> {
    const changes = await this.inner.listChanges();
    return changes.map((change, index) =>
      index === 0 ? { ...change, name: "Renamed Behind The Store" } : change
    );
  }
}

/** The `<li>` that reports one pillar, however its attributes are ordered. */
function pillarTag(html: string, pillar: string): string {
  const match = html.match(new RegExp(`<li[^>]*data-pillar="${pillar}"[^>]*>`));
  assert(match !== null, `the audit page must report the ${pillar} pillar`);
  return match![0];
}

/** The integrity panel, which is one section with no nested sections. */
function integrityPanel(html: string): string {
  const match = html.match(/<section[^>]*data-integrity="[^"]*"[\s\S]*?<\/section>/);
  assert(match !== null, "the audit page must render an integrity panel");
  return match![0];
}

/** The standing-verdict panel, likewise one section. */
function standingsPanel(html: string): string {
  const match = html.match(/<section[^>]*data-standings="[^"]*"[\s\S]*?<\/section>/);
  assert(match !== null, "the audit page must render a standing-verdict panel");
  return match![0];
}

/** The `<ol>` that lists the trail events. */
function timeline(html: string): string {
  const match = html.match(/<ol[^>]*class="tk-timeline"[^>]*>/);
  assert(match !== null, "the audit page must render the trail");
  return match![0];
}

/** The opening tag of a rendered panel, so its attributes can be read. */
function openingTag(panel: string): string {
  return panel.slice(0, panel.indexOf(">") + 1);
}

Deno.test("the audit page reports the seal verdict behind its claim that the trail cannot be rewritten", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());
  await context.catalog.publish(maintainer, { id: "docs-writer", visibility: "internal" });

  const report = await new SealService(context.catalog, context.access).report(auditor);
  assertEquals(report.ok, true, "the seeded trail must be intact");
  const sealed = report.pillars.reduce((total, pillar) => total + pillar.sealed, 0);

  const { status, html } = await get(context, "/internal/audit", auditor);
  assertEquals(status, 200);
  assert(html.includes('data-integrity="ok"'), "an intact trail must be reported intact");
  assert(
    !html.includes('data-integrity="broken"'),
    "an intact trail must not be called broken",
  );
  assert(
    html.includes(`data-sealed="${sealed}"`),
    "the page must report how many records the chain covers",
  );
  assert(html.includes("审计时间线"), "the timeline must still render");

  // Every pillar is accounted for, including the ones this deployment does not
  // configure: a pillar that was not read is reported as unchecked, never as
  // verified.
  for (const pillar of SEAL_PILLARS) {
    const checked = report.pillars.find((item) => item.pillar === pillar);
    assert(
      pillarTag(html, pillar).includes(`data-verdict="${checked ? "ok" : "unchecked"}"`),
      `the ${pillar} pillar must say whether it was checked`,
    );
  }
  for (const pillar of report.pillars) {
    const tag = pillarTag(html, pillar.pillar);
    assert(
      tag.includes(`data-sealed="${pillar.sealed}"`),
      `the ${pillar.pillar} pillar must report its own sealed count`,
    );
    assert(
      tag.includes(`data-anchor="${pillar.anchor?.state ?? "none"}"`),
      `the ${pillar.pillar} pillar must report its own checkpoint reading`,
    );
  }
});

Deno.test("the audit page says which window each panel answers, and the seal says it is not windowed", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());
  await context.catalog.publish(maintainer, { id: "docs-writer", visibility: "internal" });

  const current = await get(context, "/internal/audit", auditor);
  assertEquals(current.status, 200);
  // Nothing was sliced here, so every panel is reading the present — but the
  // page still says which rule each one answers under, so a reader (or a
  // scraper) never has to infer it from the absence of a window line.
  assert(
    openingTag(integrityPanel(current.html)).includes('data-window="current"'),
    openingTag(integrityPanel(current.html)),
  );
  assert(!integrityPanel(current.html).includes("int-integrity__scope"), "no window, no note");
  assert(
    openingTag(standingsPanel(current.html)).includes('data-window="as-of"'),
    openingTag(standingsPanel(current.html)),
  );
  assert(
    timeline(current.html).includes('data-window="as-of"'),
    timeline(current.html),
  );
  assert(!timeline(current.html).includes("data-asof"), "no cutoff was asked for");

  const cutoff = new Date(Date.now() + 3_600_000).toISOString();
  const sliced = await get(context, `/internal/audit?asOf=${encodeURIComponent(cutoff)}`, auditor);
  assertEquals(sliced.status, 200);
  const panel = integrityPanel(sliced.html);
  // The cutoff reaches the verdicts and the trail; the seal re-reads the files
  // and has no historical mode, so it keeps its declaration and says out loud
  // that the window did not apply to it.
  assert(openingTag(panel).includes('data-window="current"'), openingTag(panel));
  assert(panel.includes("int-integrity__scope"), panel);
  assert(panel.includes(`<time datetime="${cutoff}">`), panel);
  assert(
    openingTag(standingsPanel(sliced.html)).includes(`data-asof="${cutoff}"`),
    openingTag(standingsPanel(sliced.html)),
  );
  assert(timeline(sliced.html).includes(`data-asof="${cutoff}"`), timeline(sliced.html));

  // Same verdict, same numbers: the window moved the reader, not the seal.
  const attribute = (html: string, name: string): string | undefined =>
    integrityPanel(html).match(new RegExp(`data-${name}="[^"]*"`))?.[0];
  for (const name of ["integrity", "sealed", "unsealed", "anchored"]) {
    assertEquals(
      attribute(sliced.html, name),
      attribute(current.html, name),
      `the ${name} reading must not depend on the read window`,
    );
  }
});

Deno.test("an edited record is named on the audit page, not folded into a generic failure", async () => {
  roster = await signedInRoster();
  const inner = new MemoryCatalogStore();
  const writing = new CatalogService(inner);
  await writing.register(maintainer, surface());
  await writing.publish(maintainer, { id: "docs-writer", visibility: "internal" });

  const context = {
    catalog: new CatalogService(new EditedTrailStore(inner)),
    access: roster.access,
    roster,
  };
  const report = await new SealService(context.catalog, context.access).report(auditor);
  assertEquals(report.ok, false, "an edited trail must fail the seal");
  const broken = report.pillars.find((item) => item.pillar === "catalog");
  assert(broken?.break, "the catalog pillar must report a break");

  const { status, html } = await get(context, "/internal/audit", auditor);
  assertEquals(status, 200);
  assert(html.includes('data-integrity="broken"'), "the page must not call an edited trail intact");
  assert(pillarTag(html, "catalog").includes('data-verdict="broken"'), "the broken pillar");

  // The page names the record and the reason, so a finding can be acted on
  // rather than merely noticed.
  const at = broken!.break!;
  for (
    const attribute of [
      `data-break-seq="${at.seq}"`,
      `data-break-kind="${at.kind}"`,
      `data-break-id="${at.id}"`,
      `data-break-reason="${at.reason}"`,
    ]
  ) {
    assert(html.includes(attribute), `the break must be reported as ${attribute}`);
  }
});

Deno.test("a pillar with no checkpoint is reported as unanchored, never as verified", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  const anchors = new MemoryAnchorStore();
  const withAnchors = { ...context, sealAnchors: anchors };
  const report = await new SealService(
    context.catalog,
    context.access,
    undefined,
    undefined,
    anchors,
  ).report(auditor);
  assertEquals(report.anchored, 0, "no checkpoint has been taken yet");

  const { html } = await get(withAnchors, "/internal/audit", auditor);
  assert(html.includes('data-anchored="0"'), "zero anchored pillars must be reported as such");
  assert(
    pillarTag(html, "catalog").includes('data-anchor="none"'),
    "an unanchored pillar carries no checkpoint reading",
  );
  assert(html.includes("无检查点"), "an unanchored pillar must say so in words");
});

Deno.test("a checkpoint that still holds is reported as anchored", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  const anchors = new MemoryAnchorStore();
  const seals = new SealService(context.catalog, context.access, undefined, undefined, anchors);
  await new AnchorService(anchors, seals).anchor(auditor);
  const report = await seals.report(auditor);
  assertEquals(report.anchored, 2, "this deployment reads the catalog and identity pillars");

  const { html } = await get({ ...context, sealAnchors: anchors }, "/internal/audit", auditor);
  assert(
    html.includes(`data-anchored="${report.anchored}"`),
    "the page must report how many pillars a checkpoint covers",
  );
  assert(
    pillarTag(html, "catalog").includes('data-anchor="intact"'),
    "a checkpoint that still holds is intact, not merely present",
  );
});

Deno.test("the integrity panel offers no control that could mutate or script the trail", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());

  const { html } = await get(context, "/internal/audit", auditor);
  const panel = integrityPanel(html);
  assert(!/<form/i.test(panel), "the panel must not offer a write form");
  assert(!/<button/i.test(panel), "the panel must not offer a button");
  assert(!/<script/i.test(panel), "the panel must not ship script");
  assert(!/javascript:/i.test(panel), "the panel must not ship a javascript: URL");
  assert(!/\son\w+\s*=/i.test(panel), "the panel must not ship an inline event handler");
  // The read-only filter that already lives on the page is not part of the panel.
  assert(/<form/i.test(html), "the timeline filter must survive the new panel");
});

Deno.test("the approvals page shows signed-in identities the same decision records including notes", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());
  await context.catalog.publish(maintainer, { id: "docs-writer", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await context.catalog.approve(auditor, {
    id: "docs-writer",
    note: "Package coordinate reviewed.",
  });

  const expected = await context.catalog.listApprovals(reader);
  assertEquals(expected.length, 1);
  assertEquals(expected[0].note, "Package coordinate reviewed.");

  for (const signedIn of [reader, maintainer, auditor]) {
    const page = await get(context, "/internal/approvals", signedIn);
    assertEquals(page.status, 200, `${signedIn.role} must read the approvals page`);
    assert(page.html.includes("审批记录"), `${signedIn.role} must get the approvals screen`);
    assert(page.html.includes("Docs Writer"), `${signedIn.role} must see the approved name`);
    assert(
      page.html.includes("Package coordinate reviewed."),
      `${signedIn.role} must see the auditor note`,
    );
    assert(
      !/<script/i.test(page.html),
      `${signedIn.role} must not receive a scripted approvals page`,
    );
  }

  const after = await context.catalog.listApprovals(reader);
  assertEquals(after, expected, "reading the page must not rewrite approval records");
});

Deno.test("the approvals page does not present pending candidates as decisions", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface({ id: "pending-one", name: "Pending One" }));
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "public" });

  const page = await get(context, "/internal/approvals", auditor);
  assertEquals(page.status, 200);
  assert(!page.html.includes("Pending One"), "a pending candidate is not an approval record");
});

Deno.test("the pending queue shows a pending_public candidate to a signed-in reader", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface({ id: "pending-one", name: "Pending One" }));
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "public" });

  const page = await get(context, "/internal/pending", reader);
  assertEquals(page.status, 200);
  assert(page.html.includes("待审队列"), "reader must get the pending queue screen");
  assert(page.html.includes("Pending One"), "reader must see the pending candidate");
});

Deno.test("the pending queue hides drafts, internal records, and approved_public names", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface({ id: "draft-one", name: "Draft One" }));
  await context.catalog.register(
    maintainer,
    surface({ id: "internal-one", name: "Internal One" }),
  );
  await context.catalog.publish(maintainer, { id: "internal-one", visibility: "internal" });
  await context.catalog.register(maintainer, surface({ id: "pending-one", name: "Pending One" }));
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "public" });
  await publishPublic(context, surface({ id: "public-one", name: "Public One" }));

  const asReader = await get(context, "/internal/pending", reader);
  const asAuditor = await get(context, "/internal/pending", auditor);
  for (const page of [asReader, asAuditor]) {
    assertEquals(page.status, 200);
    assert(page.html.includes("Pending One"), "the queue must list the public candidate");
    assert(!page.html.includes("Draft One"), "drafts are not pending public");
    assert(!page.html.includes("Internal One"), "internal-only records are not pending public");
    assert(!page.html.includes("Public One"), "approved_public is a decision, not a candidate");
    assert(!/<script/i.test(page.html), "the queue must not ship script");
    assert(!/<form/i.test(page.html), "the queue must not ship a form");
    assert(!/<button/i.test(page.html), "the queue must not ship a button");
  }

  const before = JSON.stringify(await context.catalog.list(maintainer));
  await get(context, "/internal/pending", auditor);
  assertEquals(
    JSON.stringify(await context.catalog.list(maintainer)),
    before,
    "reading the queue must not dirty the catalog",
  );
});

Deno.test("the catalog board links the pending_public count to the pending queue", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface({ id: "pending-one", name: "Pending One" }));
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-one", visibility: "public" });

  const before = JSON.stringify(await context.catalog.list(maintainer));
  const page = await get(context, "/internal/c", reader);
  assertEquals(page.status, 200);
  assert(
    page.html.includes('<a class="tk-stat" href="/internal/pending">'),
    "the pending count must be a link to the queue",
  );
  assert(page.html.includes("待审公开"), "the catalog board still labels the pending count");
  assert(
    !/<form/i.test(page.html),
    "linking the count must not turn the catalog board into a write form",
  );
  assertEquals(
    JSON.stringify(await context.catalog.list(maintainer)),
    before,
    "reading the catalog board must not dirty the catalog",
  );
});

Deno.test("the pending queue shows an escaped entry as text and never links it", async () => {
  const context = await seeded();
  await context.catalog.register(
    maintainer,
    surface({
      id: "escape-pending",
      name: "<script>alert(1)</script>",
      channels: ["web"],
      entry: { kind: "url", value: "https://pending.example.test/secret?q=<script>" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "escape-pending", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "escape-pending", visibility: "public" });

  const page = await get(context, "/internal/pending", reader);
  assertEquals(page.status, 200);
  assert(!page.html.includes("<script>alert(1)</script>"), "raw name markup must not appear");
  assert(page.html.includes("&lt;script&gt;"), "the pending name must be escaped");
  assert(
    page.html.includes("https://pending.example.test/secret?q="),
    "the queue must show where the pending entry points",
  );
  assert(
    page.html.includes("secret?q=&lt;script&gt;"),
    "the pending entry must be escaped as text",
  );
  assert(
    !page.html.includes('href="https://pending.example.test/secret'),
    "a pending entry must not be a clickable target",
  );

  const anonResponse = await handlePortalRequest(
    new Request("http://portico.local/internal/pending"),
    context,
  );
  assertEquals(anonResponse.status, 303, "anonymous /internal/pending must redirect to login");
  assert(
    anonResponse.headers.get("location")?.startsWith("/login"),
    "anonymous redirect must go to /login",
  );
  const anonBody = await anonResponse.text();
  assert(
    !anonBody.includes("pending.example.test"),
    "anonymous redirect must not leak the pending entry",
  );
});

Deno.test("the pending queue labels entry kinds as text and never links them", async () => {
  const context = await seeded();
  await context.catalog.register(
    maintainer,
    surface({
      id: "pending-cli",
      name: "Pending CLI",
      channels: ["cli"],
      entry: { kind: "package", value: "jsr:@example/pending-cli" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "pending-cli", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-cli", visibility: "public" });
  await context.catalog.register(
    maintainer,
    surface({
      id: "pending-web",
      name: "Pending Web",
      channels: ["web"],
      entry: { kind: "url", value: "https://pending-web.example.test/app" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "pending-web", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-web", visibility: "public" });
  await context.catalog.register(
    maintainer,
    surface({
      id: "pending-mcp",
      name: "Pending MCP",
      channels: ["mcp"],
      entry: { kind: "mcp_endpoint", value: "https://pending-mcp.example.test/mcp" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "pending-mcp", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-mcp", visibility: "public" });

  const before = JSON.stringify(await context.catalog.list(maintainer));
  const page = await get(context, "/internal/pending", reader);
  assertEquals(page.status, 200);
  assert(page.html.includes("<th>种类</th>"), "queue must name the entry-kind column");
  assert(page.html.includes('data-entry-kind="url"'), "url pending entry must show its kind");
  assert(
    page.html.includes('data-entry-kind="package"'),
    "package pending entry must show its kind",
  );
  assert(
    page.html.includes('data-entry-kind="mcp_endpoint"'),
    "mcp pending entry must show its kind",
  );
  assert(page.html.includes("Pending Web"), "reader must still see the url candidate");
  assert(page.html.includes("Pending CLI"), "reader must still see the package candidate");
  assert(page.html.includes("Pending MCP"), "reader must still see the mcp candidate");
  assert(
    !page.html.includes('href="https://pending-web.example.test/app"'),
    "a url pending entry must not be a clickable target",
  );
  assert(
    !page.html.includes('href="https://pending-mcp.example.test/mcp"'),
    "an mcp pending entry must not be a clickable target",
  );
  assert(
    !page.html.includes('href="jsr:@example/pending-cli"'),
    "a package pending entry must not be a clickable target",
  );
  assert(!/<form/i.test(page.html), "labeling kinds must not add a write form");
  assert(!/<button/i.test(page.html), "labeling kinds must not add an approve button");

  const anonResponse = await handlePortalRequest(
    new Request("http://portico.local/internal/pending"),
    context,
  );
  assertEquals(anonResponse.status, 303, "anonymous /internal/pending must redirect to login");
  assert(
    anonResponse.headers.get("location")?.startsWith("/login"),
    "anonymous redirect must go to /login",
  );
  const anonBody = await anonResponse.text();
  assert(!anonBody.includes("Pending CLI"), "anonymous redirect must not leak pending names");
  assert(
    !anonBody.includes("pending-web.example.test"),
    "anonymous redirect must not leak the url entry",
  );
  assert(
    !anonBody.includes("pending-mcp.example.test"),
    "anonymous redirect must not leak the mcp entry",
  );
  assert(
    !anonBody.includes("jsr:@example/pending-cli"),
    "anonymous redirect must not leak the package coordinate",
  );

  assertEquals(
    JSON.stringify(await context.catalog.list(maintainer)),
    before,
    "labeling pending entry kinds must not dirty the catalog",
  );
});

Deno.test("the pending queue filters pending_public candidates by channel as read-only links", async () => {
  const context = await seeded();
  await context.catalog.register(
    maintainer,
    surface({
      id: "pending-cli",
      name: "Pending CLI",
      channels: ["cli"],
      entry: { kind: "package", value: "jsr:@example/pending-cli" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "pending-cli", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-cli", visibility: "public" });
  await context.catalog.register(
    maintainer,
    surface({
      id: "pending-web",
      name: "Pending Web",
      channels: ["web"],
      entry: { kind: "url", value: "https://pending-web.example.test/app" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "pending-web", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-web", visibility: "public" });
  await context.catalog.register(
    maintainer,
    surface({
      id: "pending-mcp",
      name: "Pending MCP",
      channels: ["mcp"],
      entry: { kind: "mcp_endpoint", value: "https://pending-mcp.example.test/mcp" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "pending-mcp", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-mcp", visibility: "public" });

  const before = JSON.stringify(await context.catalog.list(maintainer));
  const all = await get(context, "/internal/pending", reader);
  assertEquals(all.status, 200);
  assert(all.html.includes("Pending CLI"), "unfiltered queue must list the cli candidate");
  assert(all.html.includes("Pending Web"), "unfiltered queue must list the web candidate");
  assert(all.html.includes("Pending MCP"), "unfiltered queue must list the mcp candidate");
  assert(
    all.html.includes('href="/internal/pending?channel=cli"'),
    "queue must offer a cli channel filter",
  );
  assert(
    all.html.includes('href="/internal/pending?channel=web"'),
    "queue must offer a web channel filter",
  );
  assert(
    all.html.includes('href="/internal/pending?channel=mcp"'),
    "queue must offer an mcp channel filter",
  );
  assert(
    all.html.includes('aria-label="筛选"'),
    "queue must name the channel filter as a read-only group",
  );
  assert(!/<form/i.test(all.html), "channel filter must not add a write form");
  assert(!/<button/i.test(all.html), "channel filter must not add an approve button");
  assert(!/<script/i.test(all.html), "channel filter must not ship script");

  const asCli = await get(context, "/internal/pending?channel=cli", reader);
  assertEquals(asCli.status, 200);
  assert(asCli.html.includes("Pending CLI"), "cli filter must keep the cli candidate");
  assert(!asCli.html.includes("Pending Web"), "cli filter must hide the web candidate");
  assert(!asCli.html.includes("Pending MCP"), "cli filter must hide the mcp candidate");
  assert(
    asCli.html.includes('href="/internal/pending?channel=cli"'),
    "filtered queue must keep channel filter links",
  );
  assert(
    asCli.html.includes('aria-current="true"'),
    "the selected channel filter must be marked current",
  );
  assert(
    !asCli.html.includes('href="jsr:@example/pending-cli"'),
    "a filtered pending entry must still not be a clickable target",
  );

  const asWeb = await get(context, "/internal/pending?channel=web", auditor);
  assertEquals(asWeb.status, 200);
  assert(asWeb.html.includes("Pending Web"), "auditor web filter must keep the web candidate");
  assert(!asWeb.html.includes("Pending CLI"), "auditor web filter must hide the cli candidate");
  assert(!asWeb.html.includes("Pending MCP"), "auditor web filter must hide the mcp candidate");
  assert(!/<button/i.test(asWeb.html), "auditor must not get an approve button after filtering");

  const unknown = await get(context, "/internal/pending?channel=ftp", reader);
  assertEquals(unknown.status, 200, "an unknown channel must not 500 the HTML queue");
  assert(unknown.html.includes("Pending CLI"), "unknown channel must fall back to the full queue");
  assert(unknown.html.includes("Pending Web"), "unknown channel must still list web candidates");
  assert(unknown.html.includes("Pending MCP"), "unknown channel must still list mcp candidates");

  const anonResponse = await handlePortalRequest(
    new Request("http://portico.local/internal/pending?channel=cli"),
    context,
  );
  assertEquals(
    anonResponse.status,
    303,
    "anonymous /internal/pending with filter must redirect to login",
  );
  assert(
    anonResponse.headers.get("location")?.startsWith("/login"),
    "anonymous redirect must go to /login",
  );
  const anonBody = await anonResponse.text();
  assert(!anonBody.includes("Pending CLI"), "anonymous redirect must not leak filtered names");
  assert(
    !anonBody.includes("jsr:@example/pending-cli"),
    "anonymous redirect must not leak a filtered package coordinate",
  );
  assert(!anonBody.includes("待审队列"), "anonymous redirect must not advertise the queue");

  assertEquals(
    JSON.stringify(await context.catalog.list(maintainer)),
    before,
    "filtering the pending queue must not dirty the catalog",
  );
});

Deno.test("the pending queue channel tabs show pending counts and ignore internal records", async () => {
  const context = await seeded();
  await context.catalog.register(
    maintainer,
    surface({
      id: "pending-cli",
      name: "Pending CLI",
      channels: ["cli"],
      entry: { kind: "package", value: "jsr:@example/pending-cli" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "pending-cli", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-cli", visibility: "public" });
  await context.catalog.register(
    maintainer,
    surface({
      id: "pending-web",
      name: "Pending Web",
      channels: ["web"],
      entry: { kind: "url", value: "https://pending-web.example.test/app" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "pending-web", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-web", visibility: "public" });
  await context.catalog.register(
    maintainer,
    surface({
      id: "pending-mcp",
      name: "Pending MCP",
      channels: ["mcp"],
      entry: { kind: "mcp_endpoint", value: "https://pending-mcp.example.test/mcp" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "pending-mcp", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "pending-mcp", visibility: "public" });
  await context.catalog.register(
    maintainer,
    surface({
      id: "internal-cli",
      name: "Internal CLI",
      channels: ["cli"],
      entry: { kind: "package", value: "jsr:@example/internal-cli" },
    }),
  );
  await context.catalog.publish(maintainer, { id: "internal-cli", visibility: "internal" });

  const before = JSON.stringify(await context.catalog.list(maintainer));
  const all = await get(context, "/internal/pending", reader);
  assertEquals(all.status, 200);
  assert(!all.html.includes("Internal CLI"), "an internal record must not enter the pending queue");
  assert(
    all.html.includes(
      'href="/internal/pending" aria-current="true">全部<span class="tk-tab__count">3</span>',
    ),
    "all-tab must count three pending candidates",
  );
  assert(
    all.html.includes(
      'href="/internal/pending?channel=cli">CLI<span class="tk-tab__count">1</span>',
    ),
    "cli tab must count one pending candidate, not the internal cli record",
  );
  assert(
    all.html.includes(
      'href="/internal/pending?channel=web">Web<span class="tk-tab__count">1</span>',
    ),
    "web tab must count one pending candidate",
  );
  assert(
    all.html.includes(
      'href="/internal/pending?channel=mcp">MCP<span class="tk-tab__count">1</span>',
    ),
    "mcp tab must count one pending candidate",
  );
  assert(!/<form/i.test(all.html), "pending counts must not add a write form");
  assert(!/<button/i.test(all.html), "pending counts must not add an approve button");

  const asCli = await get(context, "/internal/pending?channel=cli", auditor);
  assertEquals(asCli.status, 200);
  assert(asCli.html.includes("Pending CLI"), "cli filter must keep the cli candidate");
  assert(!asCli.html.includes("Pending Web"), "cli filter must hide the web candidate");
  assert(
    asCli.html.includes(
      'href="/internal/pending">全部<span class="tk-tab__count">3</span>',
    ),
    "filtered all-tab must still count every pending candidate",
  );
  assert(
    asCli.html.includes(
      'href="/internal/pending?channel=web">Web<span class="tk-tab__count">1</span>',
    ),
    "filtered web tab must still show its pending count",
  );
  assert(!/<button/i.test(asCli.html), "auditor must not get an approve button after counting");

  const anonResponse = await handlePortalRequest(
    new Request("http://portico.local/internal/pending?channel=cli"),
    context,
  );
  assertEquals(anonResponse.status, 303, "anonymous /internal/pending must redirect to login");
  assert(
    anonResponse.headers.get("location")?.startsWith("/login"),
    "anonymous redirect must go to /login",
  );
  const anonBody = await anonResponse.text();
  assert(!anonBody.includes("Pending CLI"), "anonymous redirect must not leak pending names");
  assert(
    !anonBody.includes('href="/internal/pending?channel=cli"'),
    "anonymous redirect must not advertise channel counts",
  );

  assertEquals(
    JSON.stringify(await context.catalog.list(maintainer)),
    before,
    "counting pending channels must not dirty the catalog",
  );
});

Deno.test("the approvals page escapes auditor notes", async () => {
  const context = await seeded();
  await context.catalog.register(maintainer, surface());
  await context.catalog.publish(maintainer, { id: "docs-writer", visibility: "internal" });
  await context.catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await context.catalog.approve(auditor, {
    id: "docs-writer",
    note: "<script>alert(1)</script>",
  });

  const page = await get(context, "/internal/approvals", reader);
  assertEquals(page.status, 200);
  assert(!page.html.includes("<script>alert(1)</script>"), "raw note markup must not appear");
  assert(page.html.includes("&lt;script&gt;"), "the note must be escaped");
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
      ["/internal/approvals", reader],
      ["/internal/pending", reader],
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

  const anonInternalResponse = await handlePortalRequest(
    new Request("http://portico.local/internal"),
    context,
  );
  assertEquals(anonInternalResponse.status, 303, "anonymous /internal must redirect to login");
  assert(
    anonInternalResponse.headers.get("location")?.startsWith("/login"),
    "anonymous redirect must go to /login",
  );
  const anonInternalBody = await anonInternalResponse.text();
  assert(!anonInternalBody.includes("Docs Web"), "anonymous redirect must not leak internal data");
  assertEquals(JSON.stringify(await context.catalog.list(maintainer)), before);
});
