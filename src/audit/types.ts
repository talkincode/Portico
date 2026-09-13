import type { ActorKind, ActorRole, EntryRef } from "../catalog/types.ts";

export type AuditKind = "catalog" | "grant" | "revoke" | "approval" | "gateway";

export interface AuditActor {
  id: string;
  kind: ActorKind;
  role?: ActorRole;
}

export interface AuditEvent {
  id: string;
  kind: AuditKind;
  at: string;
  actor: AuditActor;
  action: string;
  subjectId: string;
  summary: string;
  entry?: EntryRef;
}
