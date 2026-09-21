import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import { signedInRoster } from "./fixtures.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { SealService } from "../src/audit/mod.ts";

/**
 * A verdict that does not name its window reads as an answer to the current
 * question, whoever asked it.
 *
 * The trail and the standing verdicts are sliceable: a caller may ask what they
 * said as of an instant that is not now, and the answer says so. The seal is
 * not sliceable, and cannot be: it re-reads the files as they stand, so there is
 * no stored state of them to answer a past question from. Reading a sliced trail
 * beside an unwindowed seal verdict therefore mixes two questions in one view,
 * and the seal would look like the verdict of the instant the trail was read at.
 *
 * Two things are pinned here. The verdict states the window it answers
 * (`window: "current"`, on every entrance, because the declaration travels in
 * the one payload they all render). And a caller who asks it for another
 * instant is refused rather than quietly served the present — a cutoff that is
 * silently dropped makes a wrong window look exactly like a right one, which is
 * the same substitution the trail's cutoff grammar refuses.
 */

const maintainer: Actor = { id: "agent:docs-bot", kind: "agent", role: "maintainer" };
const reader: Actor = { id: "human:reader", kind: "human", role: "reader" };
const auditor: Actor = { id: "human:security-auditor", kind: "human", role: "auditor" };

function surface(): RegisterInput {
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

async function seededSeal(): Promise<SealService> {
  const roster = await signedInRoster();
  const catalog = new CatalogService(new MemoryCatalogStore());
  await catalog.register(maintainer, surface());
  return new SealService(catalog, roster.access);
}

Deno.test("the seal verdict declares that it answers the current files, not a read window", async () => {
  const seals = await seededSeal();

  const report = await seals.report(auditor);
  assertEquals(report.window, "current");
  assert(report.pillars.length > 0, "the verdict must cover the configured pillars");

  // Absent, null and blank all mean "no cutoff asked for" — the same reading
  // every other optional filter in the repository gives an empty value — so
  // they return the same verdict rather than three subtly different ones.
  const unfiltered = JSON.stringify(report);
  assertEquals(JSON.stringify(await seals.report(auditor, {})), unfiltered);
  assertEquals(JSON.stringify(await seals.report(auditor, { asOf: undefined })), unfiltered);
  assertEquals(JSON.stringify(await seals.report(auditor, { asOf: null })), unfiltered);
  assertEquals(JSON.stringify(await seals.report(auditor, { asOf: "" })), unfiltered);
  assertEquals(JSON.stringify(await seals.report(auditor, { asOf: "   " })), unfiltered);
});

Deno.test("the seal verdict refuses a cutoff it cannot answer, after the role gate", async () => {
  const seals = await seededSeal();

  // A well-formed instant, a bare date, an unparseable word and a non-string
  // are one answer here: the seal has no historical mode, so no value of `asOf`
  // can be honoured.
  for (const asOf of ["2026-09-21T12:00:00Z", "2026-09-21", "now", 42, true, {}]) {
    const refused = await assertRejectsCode(
      () => seals.report(auditor, { asOf }),
      "INVALID_INPUT",
    );
    assert(
      refused.message.includes("current"),
      `the refusal must say the verdict is current: ${refused.message}`,
    );
  }

  // The role gate is answered first: a caller who may not read the seal is not
  // told anything about the window it was asked for.
  await assertRejectsCode(
    () => seals.report(reader, { asOf: "2026-09-21T12:00:00Z" }),
    "FORBIDDEN",
  );
  await assertRejectsCode(() => seals.report(maintainer), "FORBIDDEN");
  await assertRejectsCode(
    () => seals.report({} as Actor, { asOf: "2026-09-21T12:00:00Z" }),
    "FORBIDDEN",
  );
  // An actor that cannot be read at all is an input error, and still not a
  // lesson about the window grammar.
  await assertRejectsCode(
    () => seals.report(null as unknown as Actor, { asOf: "2026-09-21T12:00:00Z" }),
    "INVALID_INPUT",
  );
});
