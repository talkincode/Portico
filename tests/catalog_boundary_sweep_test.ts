import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  type AgentSurface,
  boundarySweep,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { AccessService, MemoryIdentityStore } from "../src/access/mod.ts";

/**
 * The sweep is the whole-catalog half of the boundary report: one read that
 * lines every visible record's own bytes up against the approval trail, so an
 * auditor does not have to walk the catalog record by record to find the one
 * that disagrees. It answers exactly two questions — what is on the public face
 * right now, and where does the record disagree with the trail — and answers
 * them without writing anything.
 */

const maintainer: Actor = {
  id: "agent:docs-bot",
  kind: "agent",
  role: "maintainer",
};

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

const reader: Actor = {
  id: "human:reader",
  kind: "human",
  role: "reader",
};

const anonymous: Actor = {
  id: "anonymous",
  kind: "human",
  role: "anonymous",
};

function surface(id = "docs-writer", name = "Docs Writer"): RegisterInput {
  return {
    id,
    name,
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function webSurface(id = "docs-web", name = "Docs Web"): RegisterInput {
  return {
    id,
    name,
    description: "Publishes documentation.",
    channels: ["web"],
    version: "2.0.0",
    visibility: "internal",
    entry: { kind: "url", value: "https://docs.example.test/index.html" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

async function roster(): Promise<AccessService> {
  const access = new AccessService(new MemoryIdentityStore());
  await access.grant(null, {
    id: "human:security-auditor",
    kind: "human",
    role: "auditor",
  });
  await access.grant(auditor, {
    id: "human:reader",
    kind: "human",
    role: "reader",
    email: "reader@example.test",
  });
  await access.grant(auditor, {
    id: "agent:docs-bot",
    kind: "agent",
    role: "maintainer",
  });
  return access;
}

interface Fixture {
  store: MemoryCatalogStore;
  catalog: CatalogService;
  access: AccessService;
}

async function fixture(): Promise<Fixture> {
  const store = new MemoryCatalogStore();
  return { store, catalog: new CatalogService(store), access: await roster() };
}

function sweep(f: Fixture, actor_: Actor) {
  return boundarySweep(f.catalog, f.access, actor_);
}

/** A registered-and-approved surface, the sanctioned way onto the public face. */
async function approved(f: Fixture, record: RegisterInput = webSurface()): Promise<void> {
  await f.catalog.register(maintainer, record);
  await f.catalog.publish(maintainer, { id: record.id, visibility: "public" });
  await f.catalog.approve(auditor, { id: record.id });
}

Deno.test("an empty catalog sweeps to nothing rather than to an error", async () => {
  const f = await fixture();

  const answer = await sweep(f, auditor);

  assertEquals(answer.counts, {
    visible: 0,
    public_face: 0,
    claimed_public: 0,
    approved: 0,
    mismatched: 0,
  });
  assertEquals(answer.publicFace, []);
  assertEquals(answer.mismatches, []);
});

Deno.test("the sweep names the live public face and the approval each entry rests on", async () => {
  const f = await fixture();
  await approved(f, webSurface());
  await f.catalog.register(maintainer, surface());

  const answer = await sweep(f, auditor);

  assertEquals(answer.counts, {
    visible: 2,
    public_face: 1,
    claimed_public: 1,
    approved: 1,
    mismatched: 0,
  });
  assertEquals(answer.mismatches, []);
  assertEquals(answer.publicFace.length, 1);
  const entry = answer.publicFace[0];
  assertEquals(entry.id, "docs-web");
  assertEquals(entry.name, "Docs Web");
  assertEquals(entry.version, "2.0.0");
  assertEquals(entry.channels, ["web"]);
  assertEquals(entry.entry, {
    kind: "url",
    value: "https://docs.example.test/index.html",
  });
  assertEquals(entry.approvedBy, { id: "human:security-auditor", kind: "human" });
  assert(
    typeof entry.approvedAt === "string" && entry.approvedAt.length > 0,
    "the exposure must name when the decision it rests on was taken",
  );
});

Deno.test("a record written straight to public without an approval is a disagreement, not an exposure", async () => {
  const f = await fixture();
  const forged: AgentSurface = {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "public",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
    governanceState: "approved_public",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await f.store.put(forged);

  const answer = await sweep(f, auditor);

  assertEquals(answer.counts, {
    visible: 1,
    public_face: 0,
    claimed_public: 1,
    approved: 0,
    mismatched: 1,
  });
  assertEquals(answer.publicFace, []);
  assertEquals(answer.mismatches.length, 1);
  assertEquals(answer.mismatches[0].id, "docs-writer");
  assertEquals(answer.mismatches[0].mismatch, "claimed_public_without_approval");
  assertEquals(answer.mismatches[0].claimed, {
    visibility: "public",
    governanceState: "approved_public",
  });
  assertEquals(answer.mismatches[0].served, {
    visibility: "internal",
    governanceState: "internal",
  });
  assertEquals(answer.mismatches[0].reachable, false);
  assertEquals(answer.mismatches[0].decision, null);
});

Deno.test("a record put back to internal while the trail still approves is a disagreement in the other direction", async () => {
  const f = await fixture();
  await approved(f);
  const stored = await f.store.get("docs-web");
  await f.store.put({
    ...stored!,
    visibility: "internal",
    governanceState: "internal",
  });

  const answer = await sweep(f, auditor);

  assertEquals(answer.counts, {
    visible: 1,
    public_face: 0,
    claimed_public: 0,
    approved: 1,
    mismatched: 1,
  });
  assertEquals(answer.publicFace, []);
  assertEquals(answer.mismatches[0].mismatch, "approved_without_public_record");
  assertEquals(answer.mismatches[0].decision, "approved");
  assertEquals(answer.mismatches[0].reachable, false);
});

Deno.test("a withdrawn surface leaves the public face with no disagreement to report", async () => {
  const f = await fixture();
  await approved(f);
  await f.catalog.withdraw(auditor, { id: "docs-web" });

  const answer = await sweep(f, auditor);

  assertEquals(answer.counts, {
    visible: 1,
    public_face: 0,
    claimed_public: 0,
    approved: 0,
    mismatched: 0,
  });
  assertEquals(answer.publicFace, []);
  assertEquals(answer.mismatches, []);
});

Deno.test("every disagreement is listed, and the counts agree with the lists", async () => {
  const f = await fixture();
  await approved(f, webSurface());
  await approved(f, webSurface("docs-guide", "Docs Guide"));
  for (const id of ["docs-forged", "docs-plain"]) {
    await f.catalog.register(maintainer, surface(id, id));
  }
  const forged = await f.store.get("docs-forged");
  await f.store.put({
    ...forged!,
    visibility: "public",
    governanceState: "approved_public",
  });
  const guide = await f.store.get("docs-guide");
  await f.store.put({
    ...guide!,
    visibility: "internal",
    governanceState: "internal",
  });

  const answer = await sweep(f, auditor);

  assertEquals(
    answer.mismatches.map((item) => [item.id, item.mismatch]),
    [
      ["docs-forged", "claimed_public_without_approval"],
      ["docs-guide", "approved_without_public_record"],
    ],
  );
  assertEquals(answer.counts.mismatched, answer.mismatches.length);
  assertEquals(answer.counts.public_face, answer.publicFace.length);
  assertEquals(answer.counts.visible, 4);
  assertEquals(answer.counts.mismatched, 2);
  assertEquals(answer.publicFace.map((item) => item.id), ["docs-web"]);
});

Deno.test("the sweep reads the same way from either governance role and lists findings in id order", async () => {
  const f = await fixture();
  await approved(f, webSurface());
  for (const id of ["docs-zulu", "docs-alpha"]) {
    await f.catalog.register(maintainer, surface(id, id));
    const stored = await f.store.get(id);
    await f.store.put({
      ...stored!,
      visibility: "public",
      governanceState: "approved_public",
    });
  }

  const forAuditor = await sweep(f, auditor);
  const forMaintainer = await sweep(f, maintainer);

  assertEquals(forMaintainer, forAuditor);
  assertEquals(
    forAuditor.mismatches.map((item) => item.id),
    ["docs-alpha", "docs-zulu"],
  );
  assertEquals(forAuditor.counts.visible, 3);
  assertEquals(
    forAuditor.publicFace.map((item) => item.id),
    ["docs-web"],
  );
});

Deno.test("a draft stays out of the audit role's sweep and out of the public face", async () => {
  const f = await fixture();
  await f.catalog.draft(maintainer, surface("docs-draft", "Docs Draft"));

  const forAuditor = await sweep(f, auditor);
  const forMaintainer = await sweep(f, maintainer);

  assertEquals(forAuditor.counts.visible, 0);
  assertEquals(forAuditor.publicFace, []);
  assertEquals(forAuditor.mismatches, []);
  assertEquals(forMaintainer.counts.visible, 1);
  assertEquals(forMaintainer.counts.public_face, 0);
});

Deno.test("a draft whose bytes claim public is a disagreement, and the sweep counts what the read path counts", async () => {
  const f = await fixture();
  await f.catalog.draft(maintainer, surface("docs-draft", "Docs Draft"));
  const draft = await f.store.get("docs-draft");
  await f.store.put({
    ...draft!,
    visibility: "public",
    governanceState: "approved_public",
  });

  const forMaintainer = await sweep(f, maintainer);
  const forAuditor = await sweep(f, auditor);

  assertEquals(forMaintainer.mismatches.map((item) => item.id), ["docs-draft"]);
  assertEquals(forMaintainer.counts.public_face, 0);
  // The forged claim loses to the trail, and the read path demotes the record to
  // internal — which every signed-in role may read. The sweep must therefore
  // report the same population that role's own catalog read returns, and the
  // finding is that it *claims* public, not that it is exposed.
  assertEquals(forAuditor.mismatches.map((item) => item.id), ["docs-draft"]);
  assertEquals(forAuditor.counts.public_face, 0);
  for (
    const [role, answer] of [
      [maintainer, forMaintainer],
      [auditor, forAuditor],
    ] as const
  ) {
    assertEquals(
      answer.counts.visible,
      (await f.catalog.list(role)).length,
      "the sweep judges exactly what the role's own read returns",
    );
  }
});

Deno.test("the sweep is restricted to the auditor and maintainer, refused before the catalog is read", async () => {
  const f = await fixture();
  await approved(f);

  await assertRejectsCode(() => sweep(f, reader), "FORBIDDEN");
  await assertRejectsCode(() => sweep(f, anonymous), "FORBIDDEN");
});

Deno.test("sweeping writes nothing to the catalog or the trail", async () => {
  const f = await fixture();
  await approved(f);
  await f.catalog.register(maintainer, surface());

  const before = JSON.stringify({
    records: await f.store.list(),
    approvals: await f.store.listApprovals(),
    seal: await f.store.listSeal(),
    changes: await f.store.listChanges(),
  });

  await sweep(f, auditor);
  await sweep(f, maintainer);

  const after = JSON.stringify({
    records: await f.store.list(),
    approvals: await f.store.listApprovals(),
    seal: await f.store.listSeal(),
    changes: await f.store.listChanges(),
  });

  assertEquals(after, before);
});

Deno.test("the sweep carries no roster contact details", async () => {
  const f = await fixture();
  await approved(f);

  const answer = await sweep(f, auditor);

  assert(
    !JSON.stringify(answer).includes("reader@example.test"),
    "the sweep must not carry roster contact details",
  );
});
