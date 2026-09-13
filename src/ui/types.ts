import type {
  Actor,
  ActorKind,
  ActorRole,
  Channel,
  EntryRef,
  GovernanceState,
  MaintainerRef,
  Visibility,
} from "../catalog/types.ts";
import type { AuditEvent } from "../audit/types.ts";

export const COMPONENT_KINDS = [
  "catalog_card",
  "catalog_detail",
  "permission_hint",
  "approval_status",
  "audit_snippet",
] as const;

export type ComponentKind = typeof COMPONENT_KINDS[number];

export interface PageComponentSpec {
  kind: ComponentKind;
  id?: string;
  limit?: number;
}

export interface PageDocument {
  updatedAt: string;
  updatedBy: Actor;
  components: PageComponentSpec[];
}

export interface PageInput {
  components: PageComponentSpec[];
}

export interface CatalogCardView {
  kind: "catalog_card";
  id: string;
  name: string;
  description: string;
  governanceState: GovernanceState;
  visibility: Visibility;
  channels: Channel[];
  version: string;
}

export interface CatalogDetailView {
  kind: "catalog_detail";
  id: string;
  name: string;
  description: string;
  governanceState: GovernanceState;
  visibility: Visibility;
  channels: Channel[];
  version: string;
  entry: EntryRef;
  maintainers: MaintainerRef[];
}

export interface PermissionHintView {
  kind: "permission_hint";
  role: ActorRole;
  canMaintain: boolean;
  canAudit: boolean;
  canApprovePublic: boolean;
}

export interface ApprovalStatusView {
  kind: "approval_status";
  id: string;
  governanceState: GovernanceState;
  visibility: Visibility;
  public: boolean;
}

export interface AuditSnippetView {
  kind: "audit_snippet";
  events: AuditEvent[];
}

export type ResolvedComponent =
  | CatalogCardView
  | CatalogDetailView
  | PermissionHintView
  | ApprovalStatusView
  | AuditSnippetView;

export interface ResolvedPage {
  updatedAt?: string;
  updatedBy?: { id: string; kind: ActorKind; role: ActorRole };
  components: ResolvedComponent[];
}
