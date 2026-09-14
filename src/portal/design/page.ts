/**
 * Page shell: `<head>`, token application, and the CSS-only theme switch.
 *
 * Mode and preset are pure CSS attributes on `<body>`. That is a correctness
 * requirement, not a shortcut: Portico answers with `default-src 'none'`, so a
 * theme that needed script to apply would be a theme the portal cannot ship.
 */

import { BASE_CSS } from "./css.ts";
import { esc } from "./components.ts";
import {
  contrastRatio,
  paletteVars,
  resolveTheme,
  THEME_PRESETS,
  themeCssBlock,
  type ThemePreset,
  themeStyleSheet,
  type Tone,
} from "./tokens.ts";
import { INTERNAL_CSS } from "./internal.ts";
import { PUBLIC_CSS } from "./public.ts";
import type { PageTheme } from "./views/types.ts";

export type { PageTheme, ThemeRequestValue } from "./views/types.ts";

export interface ShellOptions {
  title: string;
  tone: Tone;
  theme: PageTheme;
  /** Kept in the shell so a theme switch preserves the path, not just the tone. */
  path: string;
  body: string;
  /** Extra `<body>` attributes, e.g. a surface id for a detail page. */
  bodyAttrs?: string;
  /** Head extras; must not introduce script or remote references. */
  head?: string;
}

/**
 * Serve-time resolution of the reader's preference.
 *
 * Precedence: an explicit `?theme=` wins, then the OS hint the caller read from
 * the request, then the surface default. We cannot store a preference without
 * script, so the resolved mode is also what the switch links encode.
 */
export function resolvePageTheme(
  tone: Tone,
  requested: string | null,
  prefersDarkHint: boolean,
): PageTheme {
  return {
    theme: resolveTheme(tone, { requested, prefersDark: prefersDarkHint }),
    request: requested,
  };
}

export function renderShell(options: ShellOptions): string {
  const { theme } = options.theme;
  // Paint exactly the resolved preset; `auto` still resolves to a concrete mode
  // so the response never depends on a second media query for its base colours.
  const paint = themeCssBlock(`body[data-theme="${theme.preset}"]`, theme.tone, theme.mode);

  return `<!DOCTYPE html>
<html lang="zh-CN" data-tone="${theme.tone}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="${theme.mode}">
    <meta name="description" content="Portico 是组织的 Agent 门户与治理层：登记、发布、发现、授权与访问。">
    <title>${esc(options.title)} · Portico</title>
    <style>
${paint}

${BASE_CSS}

${themeStyleSheet()}

${theme.tone === "internal" ? INTERNAL_CSS : PUBLIC_CSS}
    </style>${options.head ?? ""}
  </head>
  <body data-tone="${theme.tone}" data-theme="${theme.preset}" data-mode="${theme.mode}"${
    options.bodyAttrs ?? ""
  }>
${options.body}
  </body>
</html>
`;
}

/**
 * Theme switch. Links, not buttons: without script the only honest control is
 * navigation, and a link keeps the choice bookmarkable and cache-correct.
 */
export function themeSwitch(current: PageTheme, path: string): string {
  const options: Array<{ preset: ThemePreset; label: string }> = current.theme.tone === "internal"
    ? [
      { preset: "portico-internal-light", label: "浅色" },
      { preset: "portico-internal-dark", label: "深色" },
    ]
    : [
      { preset: "portico-editorial-light", label: "浅色" },
      { preset: "portico-editorial-dark", label: "深色" },
    ];

  const links = options.map((option) => {
    const active = option.preset === current.theme.preset;
    return `<a class="tk-themeswitch__option" href="${esc(withTheme(path, option.preset))}"${
      active ? ' aria-current="true"' : ""
    }>${esc(option.label)}</a>`;
  }).join("");

  return `<span class="tk-themeswitch" role="group" aria-label="颜色主题">${links}</span>`;
}

/** Append or replace the `theme` query parameter, preserving everything else. */
export function withTheme(path: string, preset: ThemePreset): string {
  const [base, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  params.set("theme", preset);
  return `${base}?${params.toString()}`;
}

/**
 * Decide the initial mode from request headers. Used before any explicit
 * `?theme=`, and pure so the portal never depends on client capability.
 */
export function prefersDark(headers: Headers): boolean {
  const hint = headers.get("sec-ch-prefers-color-scheme") ??
    headers.get("x-portico-prefers-color-scheme");
  return hint?.toLowerCase().includes("dark") ?? false;
}

/**
 * Guard used by tests and by the portal at construction time: every token pair
 * that carries meaning must clear a readable contrast floor. Kept here so the
 * spec document and the code cannot drift apart.
 */
export interface ContrastCheck {
  name: string;
  ratio: number;
  floor: number;
  passes: boolean;
}

export function auditContrast(preset: ThemePreset): ContrastCheck[] {
  const { tone, mode } = THEME_PRESETS[preset];
  const vars = paletteVars(tone, mode);
  const checks: Array<[string, string, string, number]> = [
    ["正文 / 画布", "--tk-ink", "--tk-canvas", 7],
    ["次要文字 / 画布", "--tk-muted", "--tk-canvas", 4.5],
    ["弱化文字 / 表面", "--tk-faint", "--tk-surface", 4.5],
    ["强调色 / 表面", "--tk-accent", "--tk-surface", 4.5],
    ["强调填充 / 其上文字", "--tk-accent-ink", "--tk-accent", 4.5],
    ["侧栏文字 / 侧栏底", "--tk-panel-ink", "--tk-panel", 7],
    ["侧栏次要文字 / 侧栏底", "--tk-panel-muted", "--tk-panel", 4.5],
  ];
  return checks.map(([name, fg, bg, floor]) => {
    const ratio = contrastRatio(vars[fg]!, vars[bg]!);
    return { name, ratio: Math.round(ratio * 100) / 100, floor, passes: ratio >= floor };
  });
}
