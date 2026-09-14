import type { AgentSurface } from "./types.ts";

/**
 * The governance summary every entrance shares.
 *
 * This lives in the catalog layer, not in the portal, because it is derived
 * purely from catalog records: the Portal renders it, `GET /api/dashboard`
 * serialises it, and the MCP entrance exposes it as `portico_dashboard`. The
 * three must not be able to drift, so they read the same function.
 */
export interface DashboardView {
  counts: {
    visible: number;
    draft: number;
    internal: number;
    pending_public: number;
    approved_public: number;
    rejected: number;
  };
  surfaces: AgentSurface[];
}

export function dashboardFrom(surfaces: AgentSurface[]): DashboardView {
  const counts = {
    visible: surfaces.length,
    draft: 0,
    internal: 0,
    pending_public: 0,
    approved_public: 0,
    rejected: 0,
  };
  for (const surface of surfaces) {
    if (surface.governanceState === "draft") counts.draft += 1;
    else if (surface.governanceState === "internal") counts.internal += 1;
    else if (surface.governanceState === "pending_public") counts.pending_public += 1;
    else if (surface.governanceState === "approved_public") counts.approved_public += 1;
    else if (surface.governanceState === "rejected") counts.rejected += 1;
  }
  const ordered = [...surfaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { counts, surfaces: ordered };
}
