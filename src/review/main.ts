import { CatalogError, ErrorCode } from "../catalog/mod.ts";
import { readBind } from "../runtime/bind.ts";
import { listenReview } from "./server.ts";

if (import.meta.main) {
  try {
    const env = Deno.env.toObject();
    const { hostname, port } = readBind(env, 8791);
    for (
      const name of [
        "PORTICO_CATALOG_PATH",
        "PORTICO_IDENTITIES_PATH",
        "PORTICO_SESSIONS_PATH",
      ] as const
    ) if (!env[name]) throw new CatalogError(ErrorCode.USAGE, `missing ${name}`);
    const server = listenReview({
      catalogPath: env.PORTICO_CATALOG_PATH!,
      identitiesPath: env.PORTICO_IDENTITIES_PATH!,
      sessionsPath: env.PORTICO_SESSIONS_PATH!,
      hostname,
      port,
      onListen: (addr) =>
        console.log(
          JSON.stringify({ ok: true, data: { url: `http://${addr.hostname}:${addr.port}` } }),
        ),
    });
    await server.finished;
  } catch (error) {
    const code = error instanceof CatalogError ? error.code : "INTERNAL";
    console.log(
      JSON.stringify({
        ok: false,
        error: { code, message: error instanceof Error ? error.message : String(error) },
      }),
    );
    Deno.exit(1);
  }
}
