import type { Actor, ActorKind, ActorRole, EntryRef } from "../catalog/types.ts";

export type GatewayDecision = "allowed" | "denied";

export interface GatewayRoute {
  id: string;
  surfaceId: string;
  name: string;
  endpoint: EntryRef;
  connect: { mode: "direct" };
  authorizedAt: string;
  actor: Actor;
}

export interface GatewayAuditRecord {
  id: string;
  surfaceId: string;
  decision: GatewayDecision;
  reason: string;
  actor: { id: string; kind: ActorKind; role: ActorRole };
  at: string;
  endpoint?: EntryRef;
}
