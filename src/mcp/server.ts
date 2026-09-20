import { AccessService, FileIdentityStore, FileSessionStore } from "../access/mod.ts";
import {
  AuditService,
  ConclusionService,
  FileAnchorStore,
  FileConclusionStore,
} from "../audit/mod.ts";
import { CatalogService, FileCatalogStore } from "../catalog/mod.ts";
import { FileGatewayAuditStore, GatewayService } from "../gateway/mod.ts";
import { FilePageStore, PageService } from "../ui/mod.ts";
import { handleMcpRequest } from "./handler.ts";

export interface McpListenOptions {
  catalogPath: string;
  identitiesPath: string;
  sessionsPath?: string;
  /**
   * When set, `portico_audit` also merges Gateway access events, so an MCP
   * caller sees the same timeline as `audit list --audit` and the Portal.
   */
  gatewayAuditPath?: string;
  /**
   * When set, `portico_page` returns the same composed page as CLI `page get`
   * and Portal `GET /api/page`. Absent means an empty composition.
   */
  pagePath?: string;
  /**
   * When set, `portico_conclusions` returns the auditor's own security
   * conclusions, the same records CLI `audit conclusions` and Portal
   * `GET /api/conclusions` return. The MCP entrance is read-only: it can read
   * a conclusion but never record one.
   */
  conclusionsPath?: string;
  /**
   * When set, `portico_audit_verify` compares the pillars against the seal
   * checkpoints in this file and `portico_seal_anchors` lists them. Read-only:
   * the MCP entrance never pins a checkpoint.
   */
  sealAnchorsPath?: string;
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
  const conclusions = options.conclusionsPath
    ? new ConclusionService(new FileConclusionStore(options.conclusionsPath), catalog)
    : undefined;
  const sealAnchors = options.sealAnchorsPath
    ? new FileAnchorStore(options.sealAnchorsPath)
    : undefined;
  return Deno.serve(
    {
      hostname: options.hostname ?? "127.0.0.1",
      port: options.port ?? 0,
      signal: options.signal,
      onListen: options.onListen ?? (() => {}),
    },
    (request) =>
      handleMcpRequest(request, { catalog, access, gateway, pages, conclusions, sealAnchors }),
  );
}

export function mcpUrl(server: Deno.HttpServer): string {
  const addr = server.addr;
  if (!("hostname" in addr) || !("port" in addr)) {
    throw new Error("mcp server is not a TCP listener");
  }
  return `http://${addr.hostname}:${addr.port}`;
}
