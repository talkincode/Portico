import { AccessService, FileIdentityStore, FileSessionStore } from "../access/mod.ts";
import { CatalogService, FileCatalogStore } from "../catalog/mod.ts";
import { handleReviewRequest } from "./handler.ts";
import {
  type ExchangeGithubCode,
  exchangeGithubCode,
  type GithubOauthConfig,
} from "./github.ts";

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
  /**
   * Optional Review GitHub OAuth login. `exchange` defaults to the live
   * github.com exchange; tests inject a stub. Absent means off.
   */
  github?: {
    config: GithubOauthConfig;
    exchange?: ExchangeGithubCode;
  };
}

export interface ReviewCfAccess {
  verify(assertion: string): Promise<{ email: string } | null>;
}
/** URL of a listening review server; mirrors `portalUrl` / `mcpUrl`. */
export function reviewUrl(server: Deno.HttpServer): string {
  const addr = server.addr;
  if (!("hostname" in addr) || !("port" in addr)) {
    throw new Error("review server is not a TCP listener");
  }
  return `http://${addr.hostname}:${addr.port}`;
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
  }, (request) =>
    handleReviewRequest(request, {
      catalog,
      access,
      cfAccess: options.cfAccess,
      github: options.github
        ? { config: options.github.config, exchange: options.github.exchange ?? exchangeGithubCode }
        : undefined,
    }));
}
