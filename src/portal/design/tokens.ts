/**
 * Portico design tokens.
 *
 * Two surfaces, one token vocabulary:
 *   tone=internal  → 内部笔记台 (dense, plain, work-first)
 *   tone=public    → 公开发布 (editorial, atmospheric, reading-first)
 *
 * Every rule downstream reads only `var(--…)` semantic names, so a surface is
 * restyled by swapping the palette under the same vocabulary. Nothing here
 * carries catalog data: Portico renders inline CSS only and ships no script,
 * so a theme can never become a maintainer-authored style channel.
 */

import type { Channel, GovernanceState } from "../../catalog/types.ts";

/** Which product surface is being rendered. */
export type Tone = "internal" | "public";
/** Resolved colour mode. Never `auto` — the caller resolves it first. */
export type Mode = "light" | "dark";
/** A requested colour mode; `auto` follows the reader's OS preference. */
export type ModeRequest = Mode | "auto";

export const TONES: readonly Tone[] = ["internal", "public"];
export const MODES: readonly Mode[] = ["light", "dark"];

/**
 * Stable, linkable names for a palette combination. `?theme=` accepts the
 * short form (`internal`, `editorial-dark`) and the long form (`editorial-dark`
 * expands to tone `public`). Names are part of the URL surface, so they are
 * deliberately stable and free of implementation detail.
 */
export const THEME_PRESETS = {
  "portico-internal-light": { tone: "internal", mode: "light" },
  "portico-internal-dark": { tone: "internal", mode: "dark" },
  "portico-editorial-light": { tone: "public", mode: "light" },
  "portico-editorial-dark": { tone: "public", mode: "dark" },
} as const satisfies Record<string, { tone: Tone; mode: Mode }>;

export type ThemePreset = keyof typeof THEME_PRESETS;

export interface Theme {
  tone: Tone;
  mode: Mode;
  preset: ThemePreset;
}

interface Palette {
  canvas: string;
  surface: string;
  /** A raised surface that must read as distinct from `surface`. */
  raised: string;
  sunken: string;
  border: string;
  borderStrong: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  accentLine: string;
  rule: string;
  /** Sidebar / panel wash. Internal keeps this near-neutral; public leans dark. */
  panel: string;
  panelBorder: string;
  panelInk: string;
  panelMuted: string;
  panelActive: string;
  /** Ink that stays readable on a filled accent (`accent` on `accentInk`). */
  accentOnFill: string;
  /** Ink for the public masthead on its own ground. */
  mastheadInk: string;
  mastheadMuted: string;
}

const INTERNAL_LIGHT: Palette = {
  canvas: "#f4f6f5",
  surface: "#ffffff",
  raised: "#ffffff",
  sunken: "#eceff0",
  border: "#dfe4e3",
  borderStrong: "#c4cbca",
  ink: "#161b1e",
  muted: "#5d6b70",
  faint: "#6d777a",
  accent: "#0a7262",
  accentInk: "#ffffff",
  accentSoft: "#dff1ec",
  accentLine: "#a9d8cc",
  rule: "#e6ebea",
  panel: "#f8fbfa",
  panelBorder: "#e3e8e7",
  panelInk: "#33403f",
  panelMuted: "#6a7575",
  panelActive: "#e4f2ee",
  accentOnFill: "#ffffff",
  mastheadInk: "#161b1e",
  mastheadMuted: "#5d6b70",
};

const INTERNAL_DARK: Palette = {
  canvas: "#0f1415",
  surface: "#161d1e",
  raised: "#1c2425",
  sunken: "#111819",
  border: "#2a3436",
  borderStrong: "#3c494b",
  ink: "#e9efee",
  muted: "#a3b1b0",
  faint: "#7c8a89",
  accent: "#54c6ae",
  accentInk: "#0d1a18",
  accentSoft: "#123430",
  accentLine: "#1f5148",
  rule: "#242e2f",
  panel: "#131a1b",
  panelBorder: "#242e2f",
  panelInk: "#d3dedc",
  panelMuted: "#869392",
  panelActive: "#1b2f2c",
  accentOnFill: "#0d1a18",
  mastheadInk: "#e9efee",
  mastheadMuted: "#a3b1b0",
};

const PUBLIC_LIGHT: Palette = {
  canvas: "#faf8f5",
  surface: "#ffffff",
  raised: "#ffffff",
  sunken: "#f1eee9",
  border: "#e5e0d8",
  borderStrong: "#c4bdb1",
  ink: "#191713",
  muted: "#5c574e",
  faint: "#7b756b",
  // A deep editorial crimson. Warm palettes drift toward "beige blog"; a red
  // accent reads as a masthead and keeps this surface distinct from the console.
  accent: "#9e2b25",
  accentInk: "#ffffff",
  accentSoft: "#fbeceb",
  accentLine: "#eab8b5",
  rule: "#eae5dd",
  panel: "#f4f1ec",
  panelBorder: "#e5e0d8",
  panelInk: "#26231e",
  panelMuted: "#6b665c",
  panelActive: "#ece7de",
  accentOnFill: "#fff8f7",
  mastheadInk: "#191713",
  mastheadMuted: "#5c574e",
};

const PUBLIC_DARK: Palette = {
  canvas: "#0b0d12",
  surface: "#12151c",
  raised: "#171b24",
  sunken: "#0e1117",
  border: "#242a35",
  borderStrong: "#343c49",
  ink: "#efede8",
  muted: "#a9a59c",
  faint: "#827e76",
  accent: "#e0827c",
  accentInk: "#2a0f0d",
  accentSoft: "#2a1517",
  accentLine: "#4c2527",
  rule: "#202631",
  panel: "#0e1117",
  panelBorder: "#222834",
  panelInk: "#e0ddd6",
  panelMuted: "#8d8981",
  panelActive: "#1c212b",
  accentOnFill: "#2a0f0d",
  mastheadInk: "#f4f2ec",
  mastheadMuted: "#a9a59c",
};

function paletteFor(tone: Tone, mode: Mode): Palette {
  if (tone === "internal") return mode === "light" ? INTERNAL_LIGHT : INTERNAL_DARK;
  return mode === "light" ? PUBLIC_LIGHT : PUBLIC_DARK;
}

const PRESET_NAMES = Object.keys(THEME_PRESETS) as ThemePreset[];

const PRESET_ALIASES: Record<string, ThemePreset> = {
  // Short forms are part of the linkable URL surface.
  internal: "portico-internal-light",
  "internal-light": "portico-internal-light",
  "internal-dark": "portico-internal-dark",
  editorial: "portico-editorial-light",
  "editorial-light": "portico-editorial-light",
  "editorial-dark": "portico-editorial-dark",
  public: "portico-editorial-light",
  "public-light": "portico-editorial-light",
  "public-dark": "portico-editorial-dark",
  light: "portico-internal-light",
  dark: "portico-internal-dark",
};

/**
 * Resolve a caller-supplied theme name. Unknown names return `undefined` so a
 * typo degrades to the surface default instead of throwing a 500 at a reader.
 */
export function findPreset(value: string | null | undefined): ThemePreset | undefined {
  if (!value) return undefined;
  const needle = value.trim().toLowerCase();
  if (!needle) return undefined;
  if ((PRESET_NAMES as string[]).includes(needle)) return needle as ThemePreset;
  return PRESET_ALIASES[needle];
}

/** Convenience: the preset name for a tone/mode pair. */
export function presetFor(tone: Tone, mode: Mode): ThemePreset {
  return `${tone === "internal" ? "portico-internal" : "portico-editorial"}-${mode}` as ThemePreset;
}

export interface ThemeRequest {
  /** `?theme=` verbatim, or `null` when absent. */
  requested?: string | null;
  /** The reader's OS hint, already read from request headers. */
  prefersDark?: boolean;
}

/**
 * Resolve the theme to paint.
 *
 * Precedence: an explicit valid `?theme=` wins; an invalid one falls through to
 * the OS hint rather than erroring; the tone then supplies the default preset.
 */
export function resolveTheme(tone: Tone, request: ThemeRequest = {}): Theme {
  const explicit = findPreset(request.requested);
  if (explicit && THEME_PRESETS[explicit].tone === tone) {
    return { tone, mode: THEME_PRESETS[explicit].mode, preset: explicit };
  }
  const mode: Mode = request.prefersDark ? "dark" : "light";
  return { tone, mode, preset: presetFor(tone, mode) };
}

/**
 * Semantic colour for a governance state. Draft and rejected stay deliberately
 * neutral: a muted chip must never look as settled as an approved one.
 */
const STATE_COLOR: Record<GovernanceState, string> = {
  draft: "state-draft",
  internal: "state-internal",
  pending_public: "state-pending",
  approved_public: "state-public",
  rejected: "state-rejected",
};

/** [text, soft background, hairline] per governance state. */
type StateTriple = readonly [ink: string, soft: string, line: string];

/**
 * Governance-state colours per mode. These are semantic, not decorative: the
 * same meaning (待审公开 needs a human) reads as the same amber in both tones.
 * Rows were contrast-checked against their own `soft` ground; see
 * `tests/portal_theme_test.ts`, which asserts the floor rather than trusting it.
 */
const STATE_TRIPLES: Record<Mode, Record<GovernanceState, StateTriple>> = {
  light: {
    draft: ["#4d595c", "#e8ecec", "#ccd3d3"],
    internal: ["#0b6a5b", "#ddf1ec", "#a6d6ca"],
    pending_public: ["#7a4a06", "#f9ecd2", "#e3c68a"],
    approved_public: ["#1c5c39", "#dcf0e3", "#a9d3ba"],
    // A rejected surface is not a warning any more; it is simply inert.
    rejected: ["#636b6d", "#e9ebeb", "#d3d7d7"],
  },
  dark: {
    draft: ["#b6c2c2", "#242d2e", "#333e3f"],
    internal: ["#6fd6bd", "#123430", "#1f5148"],
    pending_public: ["#e8bd72", "#33280f", "#4d3c17"],
    approved_public: ["#79d49b", "#12301f", "#215c3a"],
    rejected: ["#8a9295", "#202728", "#2d3435"],
  },
};

/** Every semantic token a governance state needs, in `--tk-*` form. */
export function stateVars(state: GovernanceState, mode: Mode): Record<string, string> {
  const [ink, soft, line] = STATE_TRIPLES[mode][state];
  return {
    "--tk-state": ink,
    "--tk-state-soft": soft,
    "--tk-state-line": line,
  };
}

/** The `data-state` attribute value that paints a governance state. */
export function stateAttr(state: GovernanceState): string {
  return STATE_COLOR[state];
}

/** Human label for a governance state, shared by both surfaces. */
export const STATE_LABEL: Record<GovernanceState, string> = {
  draft: "草稿",
  internal: "内部",
  pending_public: "待审公开",
  approved_public: "已公开",
  rejected: "已拒绝",
};

/** Registry channel, spelled out; never abbreviated to a bare letter. */
export const CHANNEL_LABEL: Record<Channel, string> = {
  cli: "CLI",
  mcp: "MCP",
  web: "Web",
};

/** Long-form channel meaning, for the internal legend and public section notes. */
export const CHANNEL_NOTE: Record<Channel, string> = {
  cli: "包坐标，客户端自行安装",
  mcp: "外部 MCP Server，客户端直连",
  web: "Web 入口，客户端直达页面",
};

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` / `#rrggbb` into channels. Throws on anything else. */
export function parseHex(value: string): RGB {
  const hex = value.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`not a hex colour: ${value}`);
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function relativeLuminance(color: string): number {
  const { r, g, b } = parseHex(color);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two hex colours, 1 – 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The `--tk-*` palette variables a tone/mode pair paints, without selector chrome. */
export function paletteVars(tone: Tone, mode: Mode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(paletteFor(tone, mode))) {
    out[`--tk-${kebab(name)}`] = value;
  }
  return out;
}

/**
 * Render one theme as a CSS rule block. The output is deterministic so tests
 * can assert on it and reviewers can diff a palette change.
 */
export function themeCssBlock(selector: string, tone: Tone, mode: Mode): string {
  const lines: string[] = [`${selector} {`, `  color-scheme: ${mode};`];
  for (const [name, value] of Object.entries(paletteVars(tone, mode))) {
    lines.push(`  ${name}: ${value};`);
  }
  lines.push(
    `  --tk-shadow: ${
      mode === "light" ? "0 1px 2px rgb(16 24 26 / 6%)" : "0 1px 2px rgb(0 0 0 / 40%)"
    };`,
    `  --tk-shadow-lift: ${
      mode === "light"
        ? "0 10px 30px -12px rgb(16 24 26 / 22%)"
        : "0 14px 34px -14px rgb(0 0 0 / 70%)"
    };`,
  );
  lines.push("}");
  return lines.join("\n");
}

/**
 * The full theme sheet: every preset under `[data-theme]`, plus the
 * `prefers-color-scheme` fallback for readers who never chose a mode.
 *
 * The shell always paints an explicit preset on `<body>`, so these rules are
 * the fallback for a bare `data-tone` container (tests, embedded previews) and
 * for readers whose tone block carries no explicit preset.
 *
 * Colour modes are pure CSS on purpose. Portico renders with
 * `default-src 'none'`, so a mode that needed script would be a mode the
 * portal could not ship.
 */
export function themeStyleSheet(): string {
  const blocks: string[] = [];
  for (const [preset, { tone, mode }] of Object.entries(THEME_PRESETS)) {
    blocks.push(themeCssBlock(`[data-theme="${preset}"]`, tone, mode));
  }

  // No explicit choice: follow the reader's OS, per tone.
  const auto: string[] = [];
  for (const tone of TONES) {
    const root = tone === "internal" ? ":root" : `[data-tone="${tone}"]`;
    const selector = `${root}:not([data-theme])`;
    auto.push(themeCssBlock(selector, tone, "light"));
    const dark = themeCssBlock(selector, tone, "dark");
    auto.push(`@media (prefers-color-scheme: dark) {\n${indent(dark)}\n}`);
  }

  // Governance-state tokens are semantic, not decorative: they are identical in
  // both tones and differ only by mode.
  const seen = new Set<string>();
  const stateRules: string[] = [];
  for (const mode of MODES) {
    const rules: string[] = [];
    for (const state of Object.keys(STATE_LABEL) as GovernanceState[]) {
      const vars = Object.entries(stateVars(state, mode))
        .map(([name, value]) => `${name}: ${value}`)
        .join("; ");
      const rule = `[data-state="${stateAttr(state)}"] {\n  ${vars};\n}`;
      if (!seen.has(rule)) {
        seen.add(rule);
        rules.push(rule);
      }
    }
    const body = rules.join("\n");
    stateRules.push(
      mode === "light" ? body : `@media (prefers-color-scheme: dark) {\n${indent(body)}\n}`,
    );
  }

  return `${blocks.join("\n\n")}\n\n${auto.join("\n\n")}\n\n${stateRules.join("\n\n")}\n`;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function indent(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}
