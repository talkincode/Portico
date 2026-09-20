export { handlePortalRequest } from "./handler.ts";
export type { PortalCfAccess, PortalContext } from "./handler.ts";
export { listenPortal, portalUrl } from "./server.ts";
export type { PortalListenOptions } from "./server.ts";
export {
  escapeHtml,
  parseChannel,
  parseTheme,
  renderDiscoveryPage,
  renderMagazinePage,
  renderNotFoundPage,
} from "./html.ts";
export type { ChannelFilter, MagazinePageInput, ThemeMode } from "./html.ts";
export { parseReviewEntry, reviewHref } from "./review-entry.ts";
export type { ReviewEntry } from "./review-entry.ts";
// The governance summary lives in the catalog layer: it is derived purely from
// catalog records and the MCP entrance consumes it too, so it must not sit
// inside one presentation layer.
export { dashboardFrom } from "../catalog/dashboard.ts";
export type { DashboardView } from "../catalog/dashboard.ts";
