import { AccessService, FileIdentityStore, FileSessionStore } from "../access/mod.ts";
import { CatalogService, FileCatalogStore } from "../catalog/mod.ts";
import { handleMcpRequest } from "./handler.ts";

export interface McpListenOptions {
  catalogPath: string;
  identitiesPath: string;
  sessionsPath?: string;
  hostname?: string;
  port?: number;
  signal?: AbortSignal;
  onListen?: (addr: { hostname: string; port: number }) => void;
}

export function listenMcp(options: McpListenOptions): Deno.HttpServer {
  const catalog = new CatalogService(new FileCatalogStore(options.catalogPath));
  const access = new AccessService(
    new FileIdentityStore(options.identitiesPath),
    options.sessionsPath ? new FileSessionStore(options.sessionsPath) : undefined,
  );
  return Deno.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    signal: options.signal,
    onListen: options.onListen ?? (() => {}),
  }, (request) => handleMcpRequest(request, { catalog, access }));
}

export function mcpUrl(server: Deno.HttpServer): string {
  const addr = server.addr;
  if (!("hostname" in addr) || !("port" in addr)) {
    throw new Error("mcp server is not a TCP listener");
  }
  return `http://${addr.hostname}:${addr.port}`;
}
