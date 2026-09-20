import { AccessService, FileIdentityStore, FileSessionStore } from "../access/mod.ts";
import { CatalogService, FileCatalogStore } from "../catalog/mod.ts";
import { handleReviewRequest } from "./handler.ts";

export interface ReviewListenOptions {
  catalogPath: string;
  identitiesPath: string;
  sessionsPath: string;
  hostname?: string;
  port?: number;
  signal?: AbortSignal;
  onListen?: (addr: { hostname: string; port: number }) => void;
}
export function listenReview(options: ReviewListenOptions): Deno.HttpServer {
  const catalog = new CatalogService(new FileCatalogStore(options.catalogPath));
  const access = new AccessService(
    new FileIdentityStore(options.identitiesPath),
    new FileSessionStore(options.sessionsPath),
  );
  return Deno.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 8791,
    signal: options.signal,
    onListen: options.onListen ?? (() => {}),
  }, (request) => handleReviewRequest(request, { catalog, access }));
}
