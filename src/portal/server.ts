import { AccessService, FileIdentityStore } from "../access/mod.ts";
import { AuditService } from "../audit/mod.ts";
import { CatalogService, FileCatalogStore } from "../catalog/mod.ts";
import { FilePageStore, PageService } from "../ui/mod.ts";
import { handlePortalRequest } from "./handler.ts";

export interface PortalListenOptions {
  catalogPath: string;
  identitiesPath: string;
  pagePath?: string;
  hostname?: string;
  port?: number;
  signal?: AbortSignal;
  onListen?: (addr: { hostname: string; port: number }) => void;
}

export function listenPortal(options: PortalListenOptions): Deno.HttpServer {
  const catalog = new CatalogService(new FileCatalogStore(options.catalogPath));
  const access = new AccessService(new FileIdentityStore(options.identitiesPath));
  const pages = options.pagePath
    ? new PageService(
      new FilePageStore(options.pagePath),
      catalog,
      new AuditService(catalog, access),
    )
    : undefined;
  return Deno.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    signal: options.signal,
    onListen: options.onListen ?? (() => {}),
  }, (request) => handlePortalRequest(request, { catalog, access, pages }));
}

export function portalUrl(server: Deno.HttpServer): string {
  const addr = server.addr;
  if (!("hostname" in addr) || !("port" in addr)) {
    throw new Error("portal server is not a TCP listener");
  }
  return `http://${addr.hostname}:${addr.port}`;
}
