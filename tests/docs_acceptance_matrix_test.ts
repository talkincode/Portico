import { assert, assertEquals } from "./assert.ts";

/**
 * `docs/roadmap.md` owns the authoritative 验收矩阵; `docs/reference/acceptance-matrix.md`
 * is the page the published handbook shows. The summary page had drifted: it
 * listed 32 capability rows while the roadmap carried 39, so the L0 runtime
 * boundary, the public-surface redaction contract, the deploy gate and the
 * security-audit conclusions were all missing from the page a reader sees. A
 * summary that silently drops a governance capability is worse than no summary:
 * it claims to be the quality floor while understating what is enforced.
 *
 * The row set, its order and the cited evidence are therefore a checked
 * contract, not prose. Adding a capability row to the roadmap without adding it
 * here fails, and so does citing a test file that does not exist.
 */

const ROOT = new URL("../", import.meta.url).pathname;
const ROADMAP = `${ROOT}docs/roadmap.md`;
const SUMMARY = `${ROOT}docs/reference/acceptance-matrix.md`;

/**
 * First column of every markdown table row after `startMarker`, in file order.
 * Blank lines are skipped so a matrix split across two table blocks (the
 * roadmap keeps its last row apart) still reads as one list; anything else ends
 * the scan, so trailing prose cannot be mistaken for rows.
 */
function firstColumn(text: string, startMarker: string): string[] {
  const start = text.indexOf(startMarker);
  assert(start >= 0, `${startMarker} must exist`);
  const rows: string[] = [];
  for (const line of text.slice(start + startMarker.length).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      const cells = trimmed.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length < 2) continue;
      const name = cells[0].replace(/\*\*/g, "").trim();
      // Header and separator rows are table furniture, not capabilities.
      // `:---:` is as valid a markdown separator as `---`, so both must go.
      if (name === "" || /^:?-+:?$/.test(name) || name.startsWith("一级功能")) continue;
      rows.push(name);
      continue;
    }
    if (trimmed === "") continue;
    if (rows.length > 0) break;
  }
  return rows;
}

async function roadmapRows(): Promise<string[]> {
  return firstColumn(await Deno.readTextFile(ROADMAP), "## 验收矩阵");
}

Deno.test("the published acceptance matrix mirrors every roadmap capability row", async () => {
  const expected = await roadmapRows();
  assert(expected.length > 0, "the roadmap matrix must have rows");
  const summary = await Deno.readTextFile(SUMMARY);
  assertEquals(
    firstColumn(summary, "## 核心业务能力证据清单"),
    expected,
    "the published matrix must carry every roadmap capability row, in the same order",
  );
});

Deno.test("every evidence file the published matrix cites exists", async () => {
  const summary = await Deno.readTextFile(SUMMARY);
  const cited = [...new Set(summary.match(/tests\/[A-Za-z0-9_/.-]*\.ts/g) ?? [])].sort();
  assert(cited.length > 0, "the published matrix must cite test evidence");
  for (const path of cited) {
    const stat = await Deno.stat(`${ROOT}${path}`).catch(() => null);
    assert(stat?.isFile === true, `${path} is cited as evidence but does not exist`);
  }
});

Deno.test("the published matrix defers to the roadmap for the detailed matrix", async () => {
  const summary = await Deno.readTextFile(SUMMARY);
  assert(
    summary.includes("roadmap.md"),
    "the summary must point readers at the roadmap that owns the detailed matrix",
  );
});
