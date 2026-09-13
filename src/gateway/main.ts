import { CatalogError, ErrorCode } from "../catalog/mod.ts";
import { gatewayUrl, listenGateway } from "./server.ts";

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
    throw new UsageError("PORTICO_BIND must be 127.0.0.1 or localhost; do not expose the gateway");
  }
  const raw = env.PORTICO_PORT ?? "8789";
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
    const server = listenGateway({
      catalogPath: readPath("PORTICO_CATALOG_PATH", env),
      identitiesPath: readPath("PORTICO_IDENTITIES_PATH", env),
      auditPath: readPath("PORTICO_GATEWAY_AUDIT_PATH", env),
      hostname,
      port,
      onListen: () => {
        console.log(JSON.stringify({ ok: true, data: { url: gatewayUrl(server) } }));
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
