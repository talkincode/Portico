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
  /**
   * Optional Review Cloudflare Access mapping. Same contract as the Portal:
   * a verified JWT maps to a roster human, never writes sessions, and a
   * presented Portico session always outranks it. Absent means off.
   */
  cfAccess?: ReviewCfAccess;
}

export interface ReviewCfAccess {
  verify(assertion: string): Promise<{ email: string } | null>;
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
  }, (request) => handleReviewRequest(request, { catalog, access, cfAccess: options.cfAccess }));
}
