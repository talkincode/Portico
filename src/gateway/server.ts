import { AccessService, FileIdentityStore, FileSessionStore } from "../access/mod.ts";
import { CatalogService, FileCatalogStore } from "../catalog/mod.ts";
import { handleGatewayRequest } from "./handler.ts";
import { FileGatewayAuditStore } from "./store.ts";
import { GatewayService } from "./service.ts";

export interface GatewayListenOptions {
  catalogPath: string;
  identitiesPath: string;
  auditPath: string;
  sessionsPath?: string;
  hostname?: string;
  port?: number;
  signal?: AbortSignal;
  onListen?: (addr: { hostname: string; port: number }) => void;
}

export function listenGateway(options: GatewayListenOptions): Deno.HttpServer {
  const catalog = new CatalogService(new FileCatalogStore(options.catalogPath));
  const access = new AccessService(
    new FileIdentityStore(options.identitiesPath),
    options.sessionsPath ? new FileSessionStore(options.sessionsPath) : undefined,
  );
  const gateway = new GatewayService(catalog, new FileGatewayAuditStore(options.auditPath));
  return Deno.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    signal: options.signal,
    onListen: options.onListen ?? (() => {}),
  }, (request) => handleGatewayRequest(request, { access, gateway }));
}

export function gatewayUrl(server: Deno.HttpServer): string {
  const addr = server.addr;
  if (!("hostname" in addr) || !("port" in addr)) {
    throw new Error("gateway server is not a TCP listener");
  }
  return `http://${addr.hostname}:${addr.port}`;
}
