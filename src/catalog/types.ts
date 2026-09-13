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
}

export type CatalogChangeAction =
  | "register"
  | "draft"
  | "publish_internal"
  | "publish_public_candidate";

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

export interface ApprovalDecisionInput {
  id: string;
}
