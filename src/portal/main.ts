import { CatalogError, ErrorCode } from "../catalog/mod.ts";
import { listenPortal, portalUrl } from "./server.ts";

class UsageError extends Error {
  readonly code = ErrorCode.USAGE;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function readPath(name: string, env: Record<string, string | undefined>): string {
  const value = env[name];
  if (!value) throw new UsageError(`missing ${name}`);
  return value;
}

function readBind(env: Record<string, string | undefined>): { hostname: string; port: number } {
  const hostname = env.PORTICO_BIND ?? "127.0.0.1";
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new UsageError("PORTICO_BIND must be 127.0.0.1 or localhost; do not expose the portal");
  }
  const raw = env.PORTICO_PORT ?? "8788";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError("PORTICO_PORT must be an integer 0-65535");
  }
  return { hostname, port };
}

if (import.meta.main) {
  try {
    const env = Deno.env.toObject();
    const { hostname, port } = readBind(env);
    const server = listenPortal({
      catalogPath: readPath("PORTICO_CATALOG_PATH", env),
      identitiesPath: readPath("PORTICO_IDENTITIES_PATH", env),
      sessionsPath: env.PORTICO_SESSIONS_PATH,
      pagePath: env.PORTICO_PAGE_PATH,
      hostname,
      port,
    });
    // Announced after `Deno.serve` has returned. `onListen` fires *during* that
    // call, so reading `server.addr` from inside it would see an unbound value.
    console.log(JSON.stringify({ ok: true, data: { url: portalUrl(server) } }));
    await server.finished;
  } catch (error) {
    const code = error instanceof CatalogError || error instanceof UsageError
      ? error.code
      : "INTERNAL";
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ ok: false, error: { code, message } }));
    Deno.exit(1);
  }
}
