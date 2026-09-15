import { assert } from "./assert.ts";
import { TOOLS } from "../src/mcp/tools.ts";

/**
 * The public MCP handbook is the operator-facing seam for the read-only
 * governance tools. It must name every tool `src/mcp/tools.ts` actually
 * exposes, so Portal / CLI / MCP cannot silently drift in the docs.
 */

const ROOT = new URL("../", import.meta.url).pathname;

Deno.test("mcp-server handbook names every read-only MCP tool", async () => {
  const text = await Deno.readTextFile(`${ROOT}docs/channels/mcp-server.md`);
  for (const tool of TOOLS) {
    assert(
      text.includes(`\`${tool.name}\``),
      `handbook must name ${tool.name}`,
    );
  }
  const ips = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
  for (const ip of ips) {
    assert(
      ip === "127.0.0.1",
      `handbook must not contain a non-loopback address (${ip})`,
    );
  }
});
