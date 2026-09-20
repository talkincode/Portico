import { CatalogError, ErrorCode } from "../catalog/mod.ts";
import { parseCfAccessEnv } from "../access/mod.ts";
import {
  cfAccessNetHost,
  cliPerms,
  gatewayPerms,
  githubNetHosts,
  readOnlyHttpPerms,
  reviewPerms,
} from "../perms.ts";
import { parseGithubEnv } from "../review/github.ts";
import { parseBindHostname } from "../runtime/bind.ts";

/**
 * `portico build` — produces the distributable artifacts.
 *
 * `docs/roadmap.md` (L0) requires the CLI to ship as a Deno distributable whose
 * startup does not depend on a `node` executable. Until this entrypoint existed
 * there was no build step at all: the repository could only be run from source
 * with `deno run`, so there was nothing to hand to an operator.
 *
 * Each artifact carries its own baked-in permission set, matching the product
 * permission split: the Portal and the MCP server cannot write, the CLI and the
 * Gateway can, and nothing may bind an address the operator did not configure.
 * Baked permissions cannot be widened later, so `PORTICO_BIND` is read here:
 * build for loopback by default, or for the intranet address you will deploy to.
 */

interface Target {
  name: string;
  entry: string;
  perms: readonly string[];
}

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

function targets(hostname: string, reviewExtraNet: readonly string[]): Target[] {
  return [
    { name: "portico", entry: "src/cli/main.ts", perms: cliPerms() },
    { name: "portico-portal", entry: "src/portal/main.ts", perms: readOnlyHttpPerms(hostname) },
    { name: "portico-gateway", entry: "src/gateway/main.ts", perms: gatewayPerms(hostname) },
    { name: "portico-mcp", entry: "src/mcp/main.ts", perms: readOnlyHttpPerms(hostname) },
    {
      name: "portico-review",
      entry: "src/review/main.ts",
      perms: reviewPerms(hostname, undefined, reviewExtraNet),
    },
  ];
}

function selected(available: Target[], args: string[]): Target[] {
  const only = args.filter((arg) => !arg.startsWith("-"));
  if (only.length === 0) return available;
  return only.map((name) => {
    const target = available.find((item) => item.name === name);
    if (!target) {
      throw new CatalogError(
        ErrorCode.USAGE,
        `unknown build target '${name}'; expected one of: ${
          available.map((item) => item.name).join(", ")
        }`,
      );
    }
    return target;
  });
}

async function compile(target: Target, distDir: string): Promise<string> {
  const output = `${ROOT}/${distDir}/${target.name}`;
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["compile", ...target.perms, "--output", output, target.entry],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (result.code !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new CatalogError(
      ErrorCode.INVALID_STATE,
      `building ${target.name} failed: ${stderr || `exit code ${result.code}`}`,
    );
  }
  return output;
}

if (import.meta.main) {
  try {
    const env = Deno.env.toObject();
    const hostname = parseBindHostname(env.PORTICO_BIND);
    const distDir = env.PORTICO_DIST_DIR ?? "dist";
    // Baked permissions cannot be widened later: like PORTICO_BIND, the
    // Access team is read here so a review artifact built for Access can
    // fetch its JWKS host. Default (unset team) keeps loopback-only net.
    const cfAccess = parseCfAccessEnv(env);
    const extraNet = [
      ...(cfAccess.enabled ? [cfAccessNetHost(cfAccess.team)] : []),
      ...(parseGithubEnv(env).enabled ? [...githubNetHosts()] : []),
    ];
    const available = targets(hostname, extraNet);
    const chosen = selected(available, Deno.args);
    await Deno.mkdir(`${ROOT}/${distDir}`, { recursive: true });

    const artifacts: Array<{ name: string; path: string; bytes: number }> = [];
    for (const target of chosen) {
      const path = await compile(target, distDir);
      const info = await Deno.stat(path);
      artifacts.push({ name: target.name, path, bytes: info.size });
    }
    console.log(JSON.stringify({ ok: true, data: { distDir, hostname, artifacts } }));
  } catch (error) {
    const code = error instanceof CatalogError ? error.code : "INTERNAL";
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ ok: false, error: { code, message } }));
    Deno.exit(1);
  }
}
