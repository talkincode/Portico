import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  type AgentSurface,
  CatalogService,
  FileCatalogStore,
  MemoryCatalogStore,
} from "../src/catalog/mod.ts";
import {
  applyConclusionQuery,
  ConclusionService,
  FileConclusionStore,
  MemoryConclusionStore,
  parseConclusionQuery,
} from "../src/audit/mod.ts";

const auditor: Actor = { id: "human:security-auditor", kind: "human", role: "auditor" };
const otherAuditor: Actor = { id: "human:second-auditor", kind: "human", role: "auditor" };
const maintainer: Actor = { id: "agent:docs-bot", kind: "agent", role: "maintainer" };
const reader: Actor = { id: "human:reader", kind: "human", role: "reader" };
const anonymous: Actor = { id: "anonymous", kind: "human", role: "anonymous" };

function surface(overrides: Partial<AgentSurface> = {}): AgentSurface {
  return {
    id: "docs-writer",
    name: "Docs writer",
    description: "writes docs",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    governanceState: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: maintainer.id, kind: "agent" }],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function registerInput(record: AgentSurface) {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    channels: [...record.channels],
    version: record.version,
    visibility: "internal" as const,
    entry: { ...record.entry },
    maintainers: record.maintainers.map((item) => ({ ...item })),
  };
}

async function bootstrapped(
  record: AgentSurface = surface(),
  store = new MemoryConclusionStore(),
): Promise<{ service: ConclusionService; catalog: CatalogService; store: MemoryConclusionStore }> {
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, registerInput(record));
  return { service: new ConclusionService(store, catalog), catalog, store };
}

Deno.test("auditor records a security conclusion; it lands in its own store, not the maintenance trail", async () => {
  const { service, catalog } = await bootstrapped();

  const recorded = await service.record(auditor, {
    id: "docs-writer",
    scope: "public_boundary",
    verdict: "cleared",
    note: "approved before reachable",
  });

  assertEquals(recorded.subjectId, "docs-writer");
  assertEquals(recorded.scope, "public_boundary");
  assertEquals(recorded.verdict, "cleared");
  assertEquals(recorded.auditorId, "human:security-auditor");
  assert(recorded.id.startsWith("ccl-docs-writer-public_boundary-"), recorded.id);
  assert(recorded.note === "approved before reachable", String(recorded.note));

  const listed = await service.list(auditor);
  assertEquals(listed.length, 1);
  assertEquals(listed[0], recorded);

  // The conclusion is an auditor artifact. The maintenance trail (what the
  // maintainer did) stays exactly as it was: one register change, nothing else.
  const changes = await catalog.listChanges(auditor);
  assertEquals(changes.length, 1);
  assertEquals(changes[0].action, "register");
});

Deno.test("a second auditor can conclude on the same subject; conclusions are per-auditor records", async () => {
  const { service } = await bootstrapped();
  await service.record(auditor, { id: "docs-writer", scope: "entry_target", verdict: "cleared" });
  await service.record(otherAuditor, {
    id: "docs-writer",
    scope: "entry_target",
    verdict: "cleared",
  });

  const listed = await service.list(auditor);
  assertEquals(listed.length, 2);
  assertEquals(listed[0].auditorId, "human:security-auditor");
  assertEquals(listed[1].auditorId, "human:second-auditor");
});

Deno.test("recording a conclusion requires a human auditor; maintainer, reader and anonymous are refused", async () => {
  for (const actor of [maintainer, reader, anonymous]) {
    const { service, store } = await bootstrapped();
    await assertRejectsCode(
      () =>
        service.record(actor, {
          id: "docs-writer",
          scope: "public_boundary",
          verdict: "cleared",
        }),
      "FORBIDDEN",
    );
    assertEquals(await store.list(), []);
  }
});

Deno.test("an agent cannot take over a security conclusion even when it claims the auditor role", async () => {
  const { service, store } = await bootstrapped();
  await assertRejectsCode(
    () =>
      service.record(
        { id: "agent:rogue", kind: "agent", role: "auditor" },
        { id: "docs-writer", scope: "public_boundary", verdict: "cleared" },
      ),
    "FORBIDDEN",
  );
  assertEquals(await store.list(), []);
});

Deno.test("an unknown subject is refused and nothing is written", async () => {
  const { service, store } = await bootstrapped();
  await assertRejectsCode(
    () => service.record(auditor, { id: "ghost", scope: "public_boundary", verdict: "cleared" }),
    "NOT_FOUND",
  );
  assertEquals(await store.list(), []);
});

Deno.test("a maintainer of the subject cannot record a conclusion about it", async () => {
  const store = new MemoryConclusionStore();
  const { service } = await bootstrapped(
    surface({
      maintainers: [
        { id: maintainer.id, kind: "agent" },
        { id: auditor.id, kind: "human" },
      ],
    }),
    store,
  );

  await assertRejectsCode(
    () =>
      service.record(auditor, {
        id: "docs-writer",
        scope: "public_boundary",
        verdict: "cleared",
      }),
    "SELF_AUDIT",
  );
  assertEquals(await store.list(), []);

  // Independence is per subject, not per person: the same auditor may still
  // conclude on a surface it does not maintain.
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, registerInput(surface({ id: "other-surface" })));
  const independent = new ConclusionService(store, catalog);
  const recorded = await independent.record(auditor, {
    id: "other-surface",
    scope: "public_boundary",
    verdict: "cleared",
  });
  assertEquals(recorded.subjectId, "other-surface");
});

Deno.test("conclusions are append-only: a later review adds a record and never replaces the first", async () => {
  const { service } = await bootstrapped();
  const first = await service.record(auditor, {
    id: "docs-writer",
    scope: "secret_leakage",
    verdict: "flagged",
    note: "description carried a token",
  });
  const second = await service.record(auditor, {
    id: "docs-writer",
    scope: "secret_leakage",
    verdict: "cleared",
    note: "secret removed and rotated",
  });

  assert(first.id !== second.id, "a re-review must not reuse the first record id");
  const listed = await service.list(auditor);
  assertEquals(listed.length, 2);
  assertEquals(listed[0].verdict, "flagged");
  assertEquals(listed[1].verdict, "cleared");
});

Deno.test("invalid scope, verdict, note shape and id are refused with no write", async () => {
  const cases: Array<Record<string, unknown>> = [
    { id: "docs-writer", scope: "vibes", verdict: "cleared" },
    { id: "docs-writer", scope: "public_boundary", verdict: "looks-fine" },
    { id: "docs-writer", scope: "public_boundary", verdict: "cleared", note: 7 },
    { id: "docs-writer", scope: "public_boundary", verdict: "cleared", note: "   " },
    { id: "docs-writer", scope: "public_boundary", verdict: "cleared", note: "x".repeat(501) },
    { id: "docs-writer", scope: "public_boundary", verdict: "cleared", note: "line\nbreak" },
    { id: "docs-writer", scope: "public_boundary", verdict: "cleared", extra: "nope" },
    { id: "docs-writer", scope: "public_boundary", verdict: "cleared", token: "oops" },
    { id: "docs-writer", scope: ["public_boundary"], verdict: "cleared" },
    { id: "docs-writer", scope: "public_boundary" },
    { id: "", scope: "public_boundary", verdict: "cleared" },
    { id: 42, scope: "public_boundary", verdict: "cleared" },
  ];
  for (const input of cases) {
    const { service, store } = await bootstrapped();
    await assertRejectsCode(
      () => service.record(auditor, input as never),
      "INVALID_INPUT",
    );
    assertEquals(await store.list(), []);
  }
});

Deno.test("a flagged verdict must carry a finding note; a cleared verdict may omit one", async () => {
  const { service, store } = await bootstrapped();
  await assertRejectsCode(
    () =>
      service.record(auditor, { id: "docs-writer", scope: "gateway_scope", verdict: "flagged" }),
    "INVALID_INPUT",
  );
  assertEquals(await store.list(), []);

  const cleared = await service.record(auditor, {
    id: "docs-writer",
    scope: "gateway_scope",
    verdict: "cleared",
  });
  assertEquals(cleared.note, undefined);
});

Deno.test("a note carrying a plaintext secret is refused with no write", async () => {
  const notes = [
    "rotate the key sk-live-not-a-real-key-for-redaction",
    "leaked AKIANOTAREALEXAMPLE1 in the description",
    "npm_notarealtokenvalueforredactiontests0",
    "AIzaNotARealExampleKeyForRedactionTests",
    "-----BEGIN RSA PRIVATE KEY-----", // not-a-real fixture header
  ];
  for (const note of notes) {
    const { service, store } = await bootstrapped();
    await assertRejectsCode(
      () =>
        service.record(auditor, {
          id: "docs-writer",
          scope: "secret_leakage",
          verdict: "flagged",
          note,
        }),
      "INVALID_INPUT",
    );
    assertEquals(await store.list(), []);
  }
});

Deno.test("only a human auditor may read conclusions; the filter never runs before the role check", async () => {
  const { service } = await bootstrapped();
  await service.record(auditor, {
    id: "docs-writer",
    scope: "public_boundary",
    verdict: "cleared",
  });

  for (const actor of [maintainer, reader, anonymous]) {
    await assertRejectsCode(
      () => service.list(actor, { subject: "docs-writer" }),
      "FORBIDDEN",
    );
  }
  assertEquals((await service.list(auditor)).length, 1);
});

Deno.test("reading conclusions does not write the store", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/conclusions.json`;
    const catalog = new CatalogService(new FileCatalogStore(`${dir}/catalog.json`));
    await catalog.register(maintainer, registerInput(surface()));
    const service = new ConclusionService(new FileConclusionStore(path), catalog);

    await assertRejectsCode(() => service.list(maintainer), "FORBIDDEN");
    let missing = false;
    try {
      await Deno.stat(path);
    } catch (error) {
      missing = error instanceof Deno.errors.NotFound;
    }
    assert(missing, "a read must not create the conclusion file");

    const recorded = await service.record(auditor, {
      id: "docs-writer",
      scope: "entry_target",
      verdict: "cleared",
    });
    const before = await Deno.readTextFile(path);
    assertEquals(await service.list(auditor), [recorded]);
    assertEquals(await Deno.readTextFile(path), before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the file store persists conclusions across reloads and rejects a duplicate id", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/conclusions.json`;
    const catalog = new CatalogService(new FileCatalogStore(`${dir}/catalog.json`));
    await catalog.register(maintainer, registerInput(surface()));
    const service = new ConclusionService(new FileConclusionStore(path), catalog);
    const recorded = await service.record(auditor, {
      id: "docs-writer",
      scope: "permission_change",
      verdict: "flagged",
      note: "role widened without a grant record",
    });

    const reloaded = new ConclusionService(new FileConclusionStore(path), catalog);
    assertEquals(await reloaded.list(auditor), [recorded]);

    // The store is append-only and refuses a duplicate outright rather than
    // overwriting an existing conclusion.
    const raw = JSON.parse(await Deno.readTextFile(path)) as { conclusions: unknown[] };
    assertEquals(raw.conclusions.length, 1);
    await assertRejectsCode(
      () => new FileConclusionStore(path).append(recorded),
      "ALREADY_EXISTS",
    );
    assertEquals((await reloaded.list(auditor)).length, 1);

    // A malformed file fails loudly instead of silently resetting the trail.
    await Deno.writeTextFile(path, "{}");
    let failed = false;
    try {
      await reloaded.list(auditor);
    } catch {
      failed = true;
    }
    assert(failed, "a corrupt conclusion file must fail loudly, not reset the trail");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("conclusion queries filter by subject, scope and verdict, and reject unknown values", async () => {
  const { service } = await bootstrapped();
  await service.record(auditor, {
    id: "docs-writer",
    scope: "public_boundary",
    verdict: "cleared",
  });
  await service.record(auditor, {
    id: "docs-writer",
    scope: "secret_leakage",
    verdict: "flagged",
    note: "token in description",
  });

  assertEquals((await service.list(auditor, { subject: "docs-writer" })).length, 2);
  assertEquals((await service.list(auditor, { subject: "ghost" })).length, 0);
  assertEquals((await service.list(auditor, { scope: "secret_leakage" })).length, 1);
  assertEquals((await service.list(auditor, { verdict: "flagged" })).length, 1);
  assertEquals((await service.list(auditor, { verdict: "cleared" })).length, 1);

  const query = parseConclusionQuery({ scope: "public_boundary", verdict: "cleared" });
  assertEquals(applyConclusionQuery(await service.list(auditor), query).length, 1);

  for (
    const bad of [
      { scope: "vibes" },
      { verdict: "maybe" },
      { subject: "" },
      { nope: "1" },
      { scope: ["public_boundary"] },
    ]
  ) {
    await assertRejectsCode(
      () => service.list(auditor, parseConclusionQuery(bad)),
      "INVALID_INPUT",
    );
  }
});
