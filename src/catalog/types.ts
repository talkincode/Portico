export type Channel = "cli" | "mcp" | "web";
export type Visibility = "internal" | "public";
export type GovernanceState =
  | "draft"
  | "internal"
  | "pending_public"
  | "approved_public"
  | "rejected";
export type ActorKind = "human" | "agent";
export type ActorRole = "reader" | "maintainer" | "auditor" | "anonymous";
export type ApprovalDecision = "approved" | "rejected";
/** A public-boundary decision recorded in the approval trail. `withdrawn` ends
 * public reachability of an already approved surface; it is not an approval. */
export type PublicDecision = ApprovalDecision | "withdrawn";
export type EntryKind = "url" | "package" | "mcp_endpoint";

export interface Actor {
  id: string;
  kind: ActorKind;
  role: ActorRole;
}

export interface EntryRef {
  kind: EntryKind;
  value: string;
}

export interface MaintainerRef {
  id: string;
  kind: ActorKind;
}

export interface PublicSubmission {
  submittedBy: MaintainerRef;
  submittedAt: string;
}

export interface AgentSurface {
  id: string;
  name: string;
  description: string;
  channels: Channel[];
  version: string;
  visibility: Visibility;
  entry: EntryRef;
  maintainers: MaintainerRef[];
  governanceState: GovernanceState;
  publicSubmission?: PublicSubmission;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  surfaceId: string;
  decision: PublicDecision;
  submittedBy: MaintainerRef;
  reviewedBy: MaintainerRef;
  reviewedAt: string;
  entry: EntryRef;
  version: string;
  name: string;
  /** Optional auditor note. Omitted when the decision carried none. */
  note?: string;
}

export type CatalogChangeAction =
  | "register"
  | "draft"
  | "publish_internal"
  | "publish_public_candidate"
  | "update";

export interface CatalogChangeRecord {
  id: string;
  surfaceId: string;
  action: CatalogChangeAction;
  actor: Actor;
  at: string;
  governanceState: GovernanceState;
  visibility: Visibility;
  entry: EntryRef;
  version: string;
  name: string;
}

export interface McpConnectionInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  visibility: Visibility;
  governanceState: GovernanceState;
  endpoint: EntryRef;
  connect: { mode: "direct" };
}

export interface WebConnectionInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  visibility: Visibility;
  governanceState: GovernanceState;
  href: EntryRef;
  connect: { mode: "direct" };
}

/** Authorized CLI package coordinate. Portico does not install or run it. */
export interface CliPackageInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  visibility: Visibility;
  governanceState: GovernanceState;
  package: EntryRef;
  connect: { mode: "coordinate" };
}

export interface RegisterInput {
  id: string;
  name: string;
  description: string;
  channels: Channel[];
  version: string;
  visibility: Visibility;
  entry: EntryRef;
  maintainers: MaintainerRef[];
}

export interface PublishInput {
  id: string;
  visibility: Visibility;
}

export interface UpdateInput {
  id: string;
  name?: string;
  description?: string;
  channels?: Channel[];
  version?: string;
  entry?: EntryRef;
}

export interface ApprovalDecisionInput {
  id: string;
  /** Optional human-readable reason. Not a secret field; control chars rejected. */
  note?: string;
}

/** One roster identity as the audience report names it. No contact details. */
export interface AudienceSubject {
  id: string;
  kind: ActorKind;
  role: ActorRole;
  /** Whether this identity reaches the surface through the ordinary read path. */
  reachable: boolean;
}

/**
 * Where a surface's own fields stand against its approval trail.
 *
 * A record whose public claim is not backed by the trail reads as internal, and
 * a record the trail still approves can be written back to internal without a
 * matching decision. Both shapes are reported rather than hidden, because an
 * auditor reconstructing them from two separate reads is how a governance
 * disagreement turns into an unnoticed exposure.
 */
export type BoundaryMismatch =
  | "claimed_public_without_approval"
  | "approved_without_public_record";

/**
 * One catalog surface seen from the public trust boundary.
 *
 * `claimed` is what the record's own bytes carry; `served` is what the read path
 * hands back once the approval trail has been applied. They are equal in every
 * sanctioned state and differ only where a write bypassed the public approval.
 */
export interface SurfaceBoundary {
  id: string;
  name: string;
  claimed: { visibility: Visibility; governanceState: GovernanceState };
  served: { visibility: Visibility; governanceState: GovernanceState };
  /** Whether an anonymous caller reaches this surface. */
  reachable: boolean;
  /** The newest decision on the trail for this surface, if the trail has one. */
  decision: PublicDecision | null;
  /** Set when the bytes and the trail disagree, otherwise null. */
  mismatch: BoundaryMismatch | null;
}

export interface AudienceReport extends SurfaceBoundary {
  /** The roster, ordered by identity id. */
  subjects: AudienceSubject[];
}
