import type { Actor, ActorKind, ActorRole, MaintainerRef } from "../catalog/types.ts";

export type GrantRole = Exclude<ActorRole, "anonymous">;

export interface Identity {
  id: string;
  kind: ActorKind;
  role: GrantRole;
  /** Optional unique address for a human identity. Never a second proof. */
  email?: string;
}

export interface GrantInput {
  id: string;
  kind: ActorKind;
  role: GrantRole;
  email?: string;
}

export interface GrantRecord {
  id: string;
  subjectId: string;
  kind: ActorKind;
  role: GrantRole;
  grantedBy: MaintainerRef;
  grantedAt: string;
}

export interface RevokeInput {
  id: string;
}

export interface RevokeRecord {
  id: string;
  subjectId: string;
  kind: ActorKind;
  role: GrantRole;
  revokedBy: MaintainerRef;
  revokedAt: string;
}

export interface RevokeResult {
  id: string;
  subjectId: string;
  kind: ActorKind;
  role: GrantRole;
  revoked: true;
  revokedAt: string;
}

export interface CredentialRevokeRecord {
  id: string;
  subjectId: string;
  kind: ActorKind;
  role: GrantRole;
  revokedBy: MaintainerRef;
  revokedAt: string;
  credentials: number;
  sessions: number;
}

export interface CredentialRevokeResult {
  id: string;
  subjectId: string;
  kind: ActorKind;
  role: GrantRole;
  revokedCredentials: number;
  revokedSessions: number;
  identityRemains: true;
  revokedAt: string;
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
  revokedAt?: string;
}

export interface SessionRecord {
  id: string;
  subjectId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

/**
 * Auditor-facing session row. Tokens and hashes stay off this projection so
 * CLI / Portal / MCP cannot disagree about what an audit view may show.
 */
export interface SessionAuditView {
  id: string;
  subjectId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

/**
 * Auditor-facing credential row. The one-time token and its hash stay in the
 * store; this projection is identity, issuer and timestamps only.
 */
export interface CredentialAuditView {
  id: string;
  subjectId: string;
  credentialRef: string;
  issuedBy: MaintainerRef;
  issuedAt: string;
  revokedAt?: string;
}

/**
 * Why this process cannot sign a browser session in.
 *
 * `POST /login` writes one row to the session store, so whether it can work is
 * a property of the running process and not of the deployment document: a Portal
 * started without that scoped write answers `403`, and the reader cannot tell a
 * wrong credential from a deployment that cannot do this at all. The reason is
 * reported as a fact so the page that renders it can say which one it is.
 */
export type SignInBlocker =
  | { code: "sessions_not_configured" }
  | { code: "sessions_not_writable"; path: string };
