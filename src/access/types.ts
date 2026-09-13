import type { Actor, ActorKind, ActorRole, MaintainerRef } from "../catalog/types.ts";

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

export interface IssueCredentialInput {
  id: string;
}

export interface IssuedCredential {
  id: string;
  subjectId: string;
  credentialRef: string;
  token: string;
  issuedAt: string;
}

export interface LoginInput {
  id: string;
  token: string;
  ttlSeconds?: number;
}

export interface SessionView {
  sessionId: string;
  token: string;
  actor: Actor;
  expiresAt: string;
}

export interface LogoutResult {
  sessionId: string;
  revoked: true;
}

export interface RequestActorInput {
  sessionToken?: string | null;
  claimed?: Actor | null;
}

export interface CredentialRecord {
  id: string;
  subjectId: string;
  credentialRef: string;
  secretHash: string;
  issuedBy: MaintainerRef;
  issuedAt: string;
}

export interface SessionRecord {
  id: string;
  subjectId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}
