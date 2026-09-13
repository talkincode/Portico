export type Channel = "cli" | "mcp" | "web";
export type Visibility = "internal" | "public";
export type GovernanceState =
  | "draft"
  | "internal"
  | "pending_public"
  | "approved_public"
  | "rejected";
export type ActorKind = "human" | "agent";
export type ActorRole = "reader" | "maintainer" | "anonymous";
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
  createdAt: string;
  updatedAt: string;
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
