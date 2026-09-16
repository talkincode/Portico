/**
 * Portico design system.
 *
 * Two surfaces share one token vocabulary:
 *   `internal` — 内部笔记台, the operator console at `/internal`
 *   `public`   — 公开发布, the editorial page at `/public`
 *
 * See `docs/ui-spec.md` for the full specification. Nothing in this module
 * accepts author-supplied styling: maintenance can change catalog records, not
 * the interface.
 */

export {
  auditContrast,
  type ContrastCheck,
  prefersDark,
  renderShell,
  resolvePageTheme,
  themeSwitch,
  withTheme,
} from "./page.ts";
export type { PageTheme, ThemeRequestValue } from "./views/types.ts";

export {
  CHANNEL_LABEL,
  CHANNEL_NOTE,
  contrastRatio,
  findPreset,
  type Mode,
  MODES,
  paletteVars,
  parseHex,
  presetFor,
  relativeLuminance,
  resolveTheme,
  STATE_LABEL,
  stateAttr,
  stateVars,
  type Theme,
  THEME_PRESETS,
  themeCssBlock,
  type ThemePreset,
  themeStyleSheet,
  type Tone,
  TONES,
} from "./tokens.ts";

export { BASE_CSS } from "./css.ts";
export { INTERNAL_CSS } from "./internal.ts";
export { PUBLIC_CSS } from "./public.ts";

export {
  boundaryNote,
  byChannel,
  channelChip,
  channelChips,
  channelDescription,
  countBadge,
  displayDate,
  displaySlashDate,
  dl,
  emptyState,
  entryValue,
  esc,
  isHttpUrl,
  maintainerChain,
  maintainerLabel,
  publicOnly,
  readingMinutes,
  relativeAge,
  stateChip,
} from "./components.ts";

export {
  type ApprovalsViewInput,
  type AuditViewInput,
  type CatalogViewInput,
  type ContentViewInput,
  type CountSummary,
  renderApprovalsView,
  renderAuditView,
  renderCatalogView,
  renderContentView,
  renderSurfaceView,
  summarize,
  type SurfaceViewInput,
  type ViewContext,
} from "./views/internal.ts";

export {
  type PublicArticleInput,
  type PublicContext,
  type PublicIndexInput,
  type PublicTopicInput,
  renderPublicArticle,
  renderPublicIndex,
  renderPublicTopic,
} from "./views/public.ts";
