import type { ActorKind, ActorRole, MaintainerRef } from "../catalog/types.ts";

export type GrantRole = Exclude<ActorRole, "anonymous">;

export interface Identity {
  id: string;
  kind: ActorKind;
  role: GrantRole;
}

export interface GrantInput {
  id: string;
  kind: ActorKind;
  role: GrantRole;
}

export interface GrantRecord {
  id: string;
  subjectId: string;
  kind: ActorKind;
  role: GrantRole;
  grantedBy: MaintainerRef;
  grantedAt: string;
}
