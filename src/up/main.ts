import { CatalogError, ErrorCode } from "../catalog/mod.ts";
import { parseCfAccessEnv } from "../access/mod.ts";
import {
  cfAccessNetHost,
  gatewayPerms as gatewayPermsFor,
  githubNetHosts,
  readOnlyHttpPerms,
  reviewPerms,
} from "../perms.ts";
import { parseGithubEnv } from "../review/github.ts";
import { parseBindHostname, parseBindPort } from "../runtime/bind.ts";

/**
 * `portico up` — starts the whole system as one supervised unit.
 *
 * Before this existed, "running Portico" meant opening three terminals with
 * three different env-var sets, and nothing created the data directory. This
 * entrypoint takes one `PORTICO_DATA_DIR` and derives everything else.
 *
 * The three entrances are deliberately started as *separate* processes with
 * separate permission sets. The Portal and the MCP server are read-only
 * (`--allow-read --allow-env --allow-net=127.0.0.1`, no `--allow-write`);
 * collapsing them into one process would silently hand them write access, and
 * that permission split is a governance property stated in `docs/roadmap.md`,
 * not a packaging detail. The supervisor itself never binds a socket and never
 * reads or writes governance data — it only spawns and supervises.
 */

class UsageError extends Error {
  readonly code = ErrorCode.USAGE;

  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const SRC_DIR = import.meta.dirname;
if (!SRC_DIR) throw new UsageError("cannot locate the Portico source directory");
const PORTAL_ENTRY = `${SRC_DIR}/../portal/main.ts`;
const GATEWAY_ENTRY = `${SRC_DIR}/../gateway/main.ts`;
const MCP_ENTRY = `${SRC_DIR}/../mcp/main.ts`;
const REVIEW_ENTRY = `${SRC_DIR}/../review/main.ts`;

interface Setup {
  hostname: string;
  dataDir: string;
  catalog: string;
  identities: string;
  sessions: string;
  gatewayAudit: string;
  page: string;
  conclusions: string;
  sealAnchors: string;
  portalPort: number;
  gatewayPort: number;
  mcpPort: number;
  reviewPort: number;
}

interface Started {
  name: string;
  child: Deno.ChildProcess;
  url: string;
}

function readSetup(env: Record<string, string | undefined>): Setup {
  // Reuse the shared bind policy so `up` accepts exactly what the individual
  // services accept, including RFC1918 unicast addresses for intranet
  // listeners. `readBind` reads PORTICO_PORT, so the two extra entrances are
  // resolved with `parseBindPort` directly.
  const hostname = parseBindHostname(env.PORTICO_BIND);
  const dataDir = env.PORTICO_DATA_DIR ?? "./data";
  return {
    hostname,
    dataDir,
    catalog: env.PORTICO_CATALOG_PATH ?? `${dataDir}/catalog.json`,
    identities: env.PORTICO_IDENTITIES_PATH ?? `${dataDir}/identities.json`,
    sessions: env.PORTICO_SESSIONS_PATH ?? `${dataDir}/sessions.json`,
    gatewayAudit: env.PORTICO_GATEWAY_AUDIT_PATH ?? `${dataDir}/gateway-audit.json`,
    page: env.PORTICO_PAGE_PATH ?? `${dataDir}/page.json`,
    conclusions: env.PORTICO_CONCLUSIONS_PATH ?? `${dataDir}/conclusions.json`,
    sealAnchors: env.PORTICO_SEAL_ANCHORS_PATH ?? `${dataDir}/seal-anchors.json`,
    portalPort: parseBindPort(env.PORTICO_PORT, 8788),
    gatewayPort: parseBindPort(env.PORTICO_GATEWAY_PORT, 8789),
    mcpPort: parseBindPort(env.PORTICO_MCP_PORT, 8790),
    reviewPort: parseBindPort(env.PORTICO_REVIEW_PORT, 8791),
  };
}

/** Reads the entrypoint's single startup line from an already-consumed reader. */
async function announce(
  name: string,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ url: string; leftover: string }> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      throw new CatalogError(
        ErrorCode.INVALID_STATE,
        `${name} exited before it finished starting: ${buffer.trim() || "no output"}`,
      );
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const index = buffer.indexOf("\n");
    if (index < 0) continue;
    const line = buffer.slice(0, index).trim();
    const leftover = buffer.slice(index + 1);
    if (!line) continue;
    const parsed = JSON.parse(line) as {
      ok?: boolean;
      data?: { url?: string };
      error?: { code?: string; message?: string };
    };
    if (parsed.ok && typeof parsed.data?.url === "string") {
      return { url: parsed.data.url, leftover };
    }
    throw new CatalogError(
      ErrorCode.INVALID_STATE,
      `${name} refused to start: ${parsed.error?.message ?? line}`,
    );
  }
}

/**
 * Forwards a child's output to stderr, so the supervisor's own stdout stays a
 * single machine-readable line. Without a live reader a chatty child would
 * eventually block on a full pipe buffer.
 */
function drain(
  name: string,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  leftover: string,
): void {
  void (async () => {
    const decoder = new TextDecoder();
    if (leftover.trim()) console.error(`[${name}] ${leftover.trimEnd()}`);
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const text = decoder.decode(chunk.value, { stream: true });
        if (text.trim()) console.error(`[${name}] ${text.trimEnd()}`);
      }
    } catch {
      // The stream closes when the child dies; that is not a supervisor error.
    }
  })();
}

function drainText(name: string, stream: ReadableStream<Uint8Array>): void {
  drain(name, stream.getReader(), "");
}

async function start(
  name: string,
  entry: string,
  perms: readonly string[],
  env: Record<string, string>,
): Promise<Started> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", ...perms, entry],
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const reader = child.stdout.getReader();
  try {
    const { url, leftover } = await announce(name, reader);
    drain(name, reader, leftover);
    drainText(name, child.stderr);
    return { name, child, url };
  } catch (error) {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    await child.status;
    await reader.cancel();
    await child.stderr.cancel();
    throw error;
  }
}

async function stopAll(started: Started[]): Promise<void> {
  for (const item of started) {
    try {
      item.child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  }
  await Promise.all(started.map(async (item) => {
    const force = setTimeout(() => {
      try {
        item.child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, 3_000);
    await item.child.status;
    clearTimeout(force);
  }));
}

/** Outbound hosts the review child needs: JWKS iff Access mapping is on, github iff GitHub login is on. */
function reviewExtraNet(env: Record<string, string | undefined>): readonly string[] {
  const extra: string[] = [];
  const cfAccess = parseCfAccessEnv(env);
  if (cfAccess.enabled) extra.push(cfAccessNetHost(cfAccess.team));
  if (parseGithubEnv(env).enabled) extra.push(...githubNetHosts());
  return extra;
}

if (import.meta.main) {
  const started: Started[] = [];
  let stopping = false;

  const shutdown = async (code: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await stopAll(started);
    Deno.exit(code);
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    Deno.addSignalListener(signal, () => {
      void shutdown(0);
    });
  }

  let setup: Setup;
  try {
    // Configuration is read inside the try so that an invalid PORTICO_BIND
    // still produces the machine-readable `{ok:false,error}` envelope instead
    // of an uncaught throw.
    setup = readSetup(Deno.env.toObject());
  } catch (error) {
    const code = error instanceof CatalogError || error instanceof UsageError
      ? error.code
      : "INTERNAL";
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ ok: false, error: { code, message } }));
    Deno.exit(1);
  }

  // Each child gets the permission set for the address it will actually bind,
  // so an intranet `PORTICO_BIND` does not produce a startup failure.
  const portalPerms = readOnlyHttpPerms(setup.hostname);
  const gatewayPerms = gatewayPermsFor(setup.hostname);
  const mcpPerms = readOnlyHttpPerms(setup.hostname);
  const reviewPermsFor = reviewPerms(setup.hostname, {
    catalog: setup.catalog,
    identities: setup.identities,
    sessions: setup.sessions,
  }, reviewExtraNet(Deno.env.toObject()));

  try {
    started.push(
      await start("portal", PORTAL_ENTRY, portalPerms, {
        PORTICO_CATALOG_PATH: setup.catalog,
        PORTICO_IDENTITIES_PATH: setup.identities,
        PORTICO_SESSIONS_PATH: setup.sessions,
        PORTICO_PAGE_PATH: setup.page,
        // Portal and MCP read the same conclusion file the auditor writes with
        // `audit conclude`, so all three entrances agree on the verdicts.
        PORTICO_CONCLUSIONS_PATH: setup.conclusions,
        // Portal and MCP must get the same anchor file as the CLI, or they
        // report every pillar as unanchored (count 0) while `audit verify`
        // compares: a rewritten chain would look clean on the web surface.
        PORTICO_SEAL_ANCHORS_PATH: setup.sealAnchors,
        // All three entrances read the same Gateway audit file, so the auditor
        // timeline is identical whichever one is asked.
        PORTICO_GATEWAY_AUDIT_PATH: setup.gatewayAudit,
        PORTICO_BIND: setup.hostname,
        PORTICO_PORT: String(setup.portalPort),
      }),
    );

    started.push(
      await start("gateway", GATEWAY_ENTRY, gatewayPerms, {
        PORTICO_CATALOG_PATH: setup.catalog,
        PORTICO_IDENTITIES_PATH: setup.identities,
        PORTICO_SESSIONS_PATH: setup.sessions,
        PORTICO_GATEWAY_AUDIT_PATH: setup.gatewayAudit,
        PORTICO_BIND: setup.hostname,
        PORTICO_PORT: String(setup.gatewayPort),
      }),
    );

    started.push(
      await start("mcp", MCP_ENTRY, mcpPerms, {
        PORTICO_CATALOG_PATH: setup.catalog,
        PORTICO_IDENTITIES_PATH: setup.identities,
        PORTICO_SESSIONS_PATH: setup.sessions,
        PORTICO_GATEWAY_AUDIT_PATH: setup.gatewayAudit,
        PORTICO_PAGE_PATH: setup.page,
        PORTICO_CONCLUSIONS_PATH: setup.conclusions,
        PORTICO_SEAL_ANCHORS_PATH: setup.sealAnchors,
        PORTICO_BIND: setup.hostname,
        PORTICO_PORT: String(setup.mcpPort),
      }),
    );

    started.push(
      await start("review", REVIEW_ENTRY, reviewPermsFor, {
        PORTICO_CATALOG_PATH: setup.catalog,
        PORTICO_IDENTITIES_PATH: setup.identities,
        PORTICO_SESSIONS_PATH: setup.sessions,
        PORTICO_BIND: setup.hostname,
        PORTICO_PORT: String(setup.reviewPort),
      }),
    );
  } catch (error) {
    const code = error instanceof CatalogError || error instanceof UsageError
      ? error.code
      : "INTERNAL";
    const message = error instanceof Error ? error.message : String(error);
    await stopAll(started);
    console.log(JSON.stringify({ ok: false, error: { code, message } }));
    Deno.exit(1);
  }

  const [portal, gateway, mcp, review] = started;
  console.log(JSON.stringify({
    ok: true,
    data: {
      dataDir: setup.dataDir,
      portal: { url: portal.url },
      gateway: { url: gateway.url },
      mcp: { url: mcp.url },
      review: { url: review.url },
    },
  }));

  // A supervised unit: if any entrance dies, the rest must not keep serving a
  // half-system that looks healthy.
  const exited = await Promise.race(started.map(async (item) => ({
    name: item.name,
    status: await item.child.status,
  })));
  console.error(`[up] ${exited.name} exited with code ${exited.status.code}; stopping`);
  await shutdown(exited.status.code === 0 ? 0 : 1);
}
