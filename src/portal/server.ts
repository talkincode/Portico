import { AccessService, FileIdentityStore, FileSessionStore } from "../access/mod.ts";
import { AuditService } from "../audit/mod.ts";
import { CatalogService, FileCatalogStore } from "../catalog/mod.ts";
import { FileGatewayAuditStore, GatewayService } from "../gateway/mod.ts";
import { FilePageStore, PageService } from "../ui/mod.ts";
import { handlePortalRequest, type PortalCfAccess } from "./handler.ts";

export interface PortalListenOptions {
  catalogPath: string;
  identitiesPath: string;
  sessionsPath?: string;
  pagePath?: string;
  /**
   * When set, the auditor timeline also merges Gateway access events, so the
   * Portal shows the same trail as `audit list --audit` instead of a subset.
   */
  gatewayAuditPath?: string;
  hostname?: string;
  port?: number;
  signal?: AbortSignal;
  onListen?: (addr: { hostname: string; port: number }) => void;
  cfAccess?: PortalCfAccess;
}

export function listenPortal(options: PortalListenOptions): Deno.HttpServer {
  const catalog = new CatalogService(new FileCatalogStore(options.catalogPath));
  const access = new AccessService(
    new FileIdentityStore(options.identitiesPath),
    options.sessionsPath ? new FileSessionStore(options.sessionsPath) : undefined,
  );
  const gateway = options.gatewayAuditPath
    ? new GatewayService(catalog, new FileGatewayAuditStore(options.gatewayAuditPath))
    : undefined;
  const pages = options.pagePath
    ? new PageService(
      new FilePageStore(options.pagePath),
      catalog,
      new AuditService(catalog, access, gateway),
    )
    : undefined;
  return Deno.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    signal: options.signal,
    onListen: options.onListen ?? (() => {}),
  }, (request) =>
    handlePortalRequest(request, {
      catalog,
      access,
      gateway,
      pages,
      cfAccess: options.cfAccess,
    }));
}

export function portalUrl(server: Deno.HttpServer): string {
  const addr = server.addr;
  if (!("hostname" in addr) || !("port" in addr)) {
    throw new Error("portal server is not a TCP listener");
  }
  return `http://${addr.hostname}:${addr.port}`;
}
