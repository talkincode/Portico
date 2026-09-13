import { CatalogError, CatalogService, ErrorCode } from "../catalog/mod.ts";
import type { Actor } from "../catalog/types.ts";
import type { GatewayAuditStore } from "./store.ts";
import type { GatewayAuditRecord, GatewayRoute } from "./types.ts";

export class GatewayService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly audit: GatewayAuditStore,
  ) {}

  async authorize(actor: Actor, surfaceId: string): Promise<GatewayRoute> {
    try {
      const connection = await this.catalog.describeMcp(actor, surfaceId);
      const now = new Date().toISOString();
      const id = routeId(surfaceId, now);
      const record: GatewayAuditRecord = {
        id,
        surfaceId: connection.id,
        decision: "allowed",
        reason: "authorized",
        actor: { id: actor.id, kind: actor.kind, role: actor.role },
        at: now,
        endpoint: { ...connection.endpoint },
      };
      await this.audit.append(record);
      return {
        id,
        surfaceId: connection.id,
        name: connection.name,
        endpoint: { ...connection.endpoint },
        connect: { mode: "direct" },
        authorizedAt: now,
        actor: { id: actor.id, kind: actor.kind, role: actor.role },
      };
    } catch (error) {
      await this.#recordDenied(actor, surfaceId, error);
      throw error;
    }
  }

  async listAudit(actor: Actor): Promise<GatewayAuditRecord[]> {
    if (!actor || typeof actor !== "object") {
      throw new CatalogError(ErrorCode.INVALID_INPUT, "actor is required");
    }
    if (actor.kind !== "human" || actor.role !== "auditor") {
      throw new CatalogError(
        ErrorCode.FORBIDDEN,
        "only a human auditor may read gateway access audit",
      );
    }
    const records = await this.audit.list();
    return records.map((record) => structuredClone(record));
  }

  async #recordDenied(actor: Actor, surfaceId: string, error: unknown): Promise<void> {
    const now = new Date().toISOString();
    const code = error instanceof CatalogError ? error.code : ErrorCode.INVALID_INPUT;
    const record: GatewayAuditRecord = {
      id: routeId(surfaceId || "unknown", now),
      surfaceId,
      decision: "denied",
      reason: code,
      actor: { id: actor.id, kind: actor.kind, role: actor.role },
      at: now,
    };
    await this.audit.append(record);
  }
}

function routeId(surfaceId: string, at: string): string {
  const safe = surfaceId.replaceAll(/[^a-z0-9-]/gi, "-");
  return `gwa-${safe}-${at.replaceAll(/[^0-9]/g, "")}`;
}
