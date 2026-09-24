import { assert, assertEquals } from "./assert.ts";
import { CatalogService, MemoryCatalogStore } from "../src/catalog/mod.ts";
import type { Actor, RegisterInput } from "../src/catalog/mod.ts";

/**
 * The handbook's own examples, run through the real parser.
 *
 * Every registration example in the docs described a payload the catalog has
 * never accepted: `entry: { mcp_endpoint: "…" }` instead of
 * `entry: { kind, value }`, `maintainer: "agent:x"` instead of a `maintainers`
 * array, and no `visibility` at all. A reader — or an agent reading the handbook
 * instead of the source — got `INVALID_INPUT` on the first command of the
 * documented flow, and nothing caught it because no test ever ran the examples.
 *
 * So the examples are extracted from the markdown and fed to
 * `CatalogService.register`: the same path `catalog register`, the Portal's
 * Review submit and MCP's registry all end in. A doc that drifts fails here.
 */

const ROOT = new URL("../", import.meta.url).pathname;

/** Docs that show a payload a reader is told to paste into `--input`. */
const DOCS = [
  "docs/intro/quickstart.md",
  "docs/catalog/publish.md",
  "docs/catalog/schema.md",
  "docs/channels/mcp.md",
  "docs/channels/cli.md",
  "docs/channels/web.md",
];

const maintainer: Actor = { id: "agent:docs-bot", kind: "agent", role: "maintainer" };

/** Contents of every fenced code block, in file order. */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const lines = text.split("\n");
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (current === null) current = [];
      else {
        blocks.push(current.join("\n"));
        current = null;
      }
      continue;
    }
    if (current !== null) current.push(line);
  }
  return blocks;
}

/**
 * `//` comments removed, except inside strings. The schema page documents the
 * payload as `jsonc` — every field annotated in place — and those annotations
 * are the point of the page, so the test reads through them rather than asking
 * the doc to stop explaining itself.
 */
function stripLineComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    out += char;
  }
  return out;
}

/** Every balanced `{…}` group in `text` that parses as JSON. */
function jsonObjects(text: string): unknown[] {
  const found: unknown[] = [];
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break;
    try {
      found.push(JSON.parse(stripLineComments(text.slice(start, end + 1))));
    } catch {
      // Not a payload (a JSONC sketch with comments, an ellipsis, …).
    }
    start = end;
  }
  return found;
}

/** A register payload: an object with a string `id` and a `channels` array. */
function isRegisterPayload(value: unknown): value is RegisterInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && Array.isArray(record.channels);
}

Deno.test("every registration example in the docs registers for real", async () => {
  let checked = 0;
  for (const path of DOCS) {
    const text = await Deno.readTextFile(`${ROOT}${path}`);
    const payloads = fencedBlocks(text).flatMap(jsonObjects).filter(isRegisterPayload);
    for (const payload of payloads) {
      const catalog = new CatalogService(new MemoryCatalogStore());
      try {
        await catalog.register(maintainer, payload);
      } catch (error) {
        throw new Error(
          `${path} shows a payload the catalog rejects: ${
            error instanceof Error ? error.message : String(error)
          }\npayload: ${JSON.stringify(payload)}`,
        );
      }
      checked += 1;
    }
  }
  assert(checked >= 5, `expected the docs to carry registration examples, found ${checked}`);
});

Deno.test("the schema doc lists exactly the fields the parser accepts", async () => {
  const text = await Deno.readTextFile(`${ROOT}docs/catalog/schema.md`);
  const payload = fencedBlocks(text)
    .flatMap(jsonObjects)
    .filter(isRegisterPayload)
    .find((item) => item.id === "code-helper");
  if (payload === undefined) {
    throw new Error("docs/catalog/schema.md must show one full registration payload");
  }
  // The reference payload carries every accepted field, so the doc cannot
  // quietly drop one the parser requires (the missing `visibility` is exactly
  // how this file went wrong before).
  assertEquals(
    Object.keys(payload).sort(),
    [
      "category",
      "channels",
      "description",
      "entry",
      "id",
      "maintainers",
      "mediaUrl",
      "name",
      "tags",
      "version",
      "visibility",
    ],
  );
});
