import { CatalogError, ErrorCode } from "../catalog/mod.ts";
import { readBind } from "../runtime/bind.ts";
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

if (import.meta.main) {
  try {
    const env = Deno.env.toObject();
    const { hostname, port } = readBind(env, 8788);
    const server = listenPortal({
      catalogPath: readPath("PORTICO_CATALOG_PATH", env),
      identitiesPath: readPath("PORTICO_IDENTITIES_PATH", env),
      sessionsPath: env.PORTICO_SESSIONS_PATH,
      pagePath: env.PORTICO_PAGE_PATH,
      hostname,
      port,
      onListen: () => {
        console.log(JSON.stringify({ ok: true, data: { url: portalUrl(server) } }));
      },
    });
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
