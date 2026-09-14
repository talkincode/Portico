/**
 * Theme and token contract.
 *
 * The palette is the one place a colour can enter the product, so these tests
 * guard the properties that would otherwise fail silently and invisibly:
 * unreadable contrast, and a colour token that shadows a layout token.
 */

import { assert, assertEquals } from "./assert.ts";
import {
  auditContrast,
  BASE_CSS,
  contrastRatio,
  findPreset,
  INTERNAL_CSS,
  MODES,
  paletteVars,
  parseHex,
  presetFor,
  PUBLIC_CSS,
  relativeLuminance,
  resolveTheme,
  STATE_LABEL,
  stateAttr,
  stateVars,
  THEME_PRESETS,
  themeCssBlock,
  themeStyleSheet,
  TONES,
} from "../src/portal/design/mod.ts";
import type { ThemePreset } from "../src/portal/design/mod.ts";

const PRESETS = Object.keys(THEME_PRESETS) as ThemePreset[];

Deno.test("every preset clears its contrast floor in both tones", () => {
  for (const preset of PRESETS) {
    for (const check of auditContrast(preset)) {
      assert(
        check.passes,
        `${preset} · ${check.name} is ${check.ratio}:1, below the ${check.floor}:1 floor`,
      );
    }
  }
});

Deno.test("governance state colours stay readable on their own soft ground", () => {
  for (const tone of TONES) {
    for (const mode of MODES) {
      for (const state of Object.keys(STATE_LABEL)) {
        const vars = stateVars(state as keyof typeof STATE_LABEL, mode);
        const ratio = contrastRatio(vars["--tk-state"], vars["--tk-state-soft"]);
        assert(
          ratio >= 4.5,
          `${tone}/${mode} ${state}: state colour on soft ground is ${ratio.toFixed(2)}:1`,
        );
      }
    }
  }
});

Deno.test("a colour token never shadows a layout token", () => {
  // Regression: the palette once carried a colour named `rail`, which produced
  // `--tk-rail: #131a1b` and silently overrode the `--tk-rail: 232px` layout
  // width. `grid-template-columns` then became invalid, and every grid silently
  // collapsed to one column.
  const layoutTokens = new Set([
    "--tk-shell",
    "--tk-read",
    "--tk-rail",
    "--tk-list",
    "--tk-header-h",
    "--tk-s1",
    "--tk-s2",
    "--tk-s3",
    "--tk-s4",
    "--tk-s5",
    "--tk-s6",
    "--tk-s7",
    "--tk-s8",
    "--tk-s9",
    "--tk-s10",
    "--tk-r-xs",
    "--tk-r-sm",
    "--tk-r-md",
    "--tk-r-lg",
    "--tk-r-xl",
    "--tk-r-pill",
  ]);

  for (const tone of TONES) {
    for (const mode of MODES) {
      for (const name of Object.keys(paletteVars(tone, mode))) {
        assert(
          !layoutTokens.has(name),
          `${tone}/${mode} palette emits ${name}, which collides with a layout token`,
        );
      }
    }
  }
});

Deno.test("the layout tokens the grid depends on are lengths, not colours", () => {
  for (const token of ["--tk-rail", "--tk-list", "--tk-shell", "--tk-header-h", "--tk-read"]) {
    const declared = new RegExp(`\\s${token}:\\s*([^;]+);`).exec(BASE_CSS);
    assert(declared !== null, `${token} must be declared in the base stylesheet`);
    const value = (declared as RegExpExecArray)[1].trim();
    assert(
      /^\d+(\.\d+)?(px|rem|em)$/.test(value),
      `${token} must be a length, got '${value}'`,
    );
  }

  // A layout token must never also be declared as a colour somewhere else.
  const declaredLayout = new Set(
    [...BASE_CSS.matchAll(/(--tk-[a-z0-9-]+):\s*\d+(?:\.\d+)?(?:px|rem|em)\b/g)].map((m) => m[1]),
  );
  for (const css of [BASE_CSS, INTERNAL_CSS, PUBLIC_CSS]) {
    for (const match of css.matchAll(/(--tk-[a-z0-9-]+):\s*#[0-9a-fA-F]{3,8}\b/g)) {
      assert(
        !declaredLayout.has(match[1]),
        `${match[1]} is a layout token but is also declared as a colour`,
      );
    }
  }
});

Deno.test("theme resolution honours an explicit preset, then the OS hint, then the tone default", () => {
  assertEquals(resolveTheme("internal", { requested: "internal-dark" }), {
    tone: "internal",
    mode: "dark",
    preset: "portico-internal-dark",
  });
  // A preset belonging to the other tone is refused rather than leaked across.
  assertEquals(
    resolveTheme("internal", { requested: "portico-editorial-dark" }).preset,
    "portico-internal-light",
  );
  // An unknown name degrades to the OS hint instead of throwing at a reader.
  assertEquals(resolveTheme("public", { requested: "nonsense", prefersDark: true }), {
    tone: "public",
    mode: "dark",
    preset: "portico-editorial-dark",
  });
  assertEquals(resolveTheme("public", {}).preset, "portico-editorial-light");
  assertEquals(resolveTheme("internal", { prefersDark: true }).preset, "portico-internal-dark");
});

Deno.test("preset aliases resolve and unknown names stay undefined", () => {
  assertEquals(findPreset("internal"), "portico-internal-light");
  assertEquals(findPreset("editorial-dark"), "portico-editorial-dark");
  assertEquals(findPreset("public"), "portico-editorial-light");
  assertEquals(findPreset("dark"), "portico-internal-dark");
  assertEquals(findPreset("portico-internal-dark"), "portico-internal-dark");
  assertEquals(findPreset(" PORTICO-EDITORIAL-LIGHT "), "portico-editorial-light");
  assertEquals(findPreset("purple"), undefined);
  assertEquals(findPreset(null), undefined);
  assertEquals(findPreset(""), undefined);
  assertEquals(presetFor("public", "dark"), "portico-editorial-dark");
});

Deno.test("the two tones are visually distinct, not tints of one theme", () => {
  for (const mode of MODES) {
    const internal = paletteVars("internal", mode);
    const published = paletteVars("public", mode);
    assert(
      internal["--tk-accent"] !== published["--tk-accent"],
      `${mode}: both tones share the same accent, so the surfaces are indistinguishable`,
    );
    assert(
      internal["--tk-canvas"] !== published["--tk-canvas"],
      `${mode}: both tones share the same canvas`,
    );
  }
});

Deno.test("the theme sheet is script-free and covers every preset", () => {
  const sheet = themeStyleSheet();
  assert(!/<script/i.test(sheet), "the theme sheet must not contain script");
  assert(!/url\(/i.test(sheet), "the theme sheet must not reference remote resources");
  for (const preset of PRESETS) {
    assert(
      sheet.includes(`[data-theme="${preset}"]`),
      `theme sheet is missing the ${preset} block`,
    );
  }
  assert(
    sheet.includes("prefers-color-scheme"),
    "theme sheet must keep the OS-preference fallback",
  );

  const painted = themeCssBlock("body", "internal", "dark");
  assert(painted.includes("--tk-ink:"), "painted block must carry the palette");
  assert(painted.includes("color-scheme: dark"), "painted block must declare color-scheme");
});

Deno.test("governance states map to distinct, stable tokens", () => {
  const tokens = new Set<string>();
  for (const state of Object.keys(STATE_LABEL)) {
    const token = stateAttr(state as keyof typeof STATE_LABEL);
    assert(token.startsWith("state-"), `state token '${token}' must be namespaced`);
    assert(!tokens.has(token), `duplicate state token '${token}'`);
    tokens.add(token);
  }
  assertEquals(stateAttr("pending_public"), "state-pending");
  assertEquals(stateAttr("approved_public"), "state-public");
});

Deno.test("no stylesheet hard-codes a raw accent where a token belongs", () => {
  // Only `tokens.ts` may hold a palette hex. A stylesheet may still use pure
  // black/white for masks and shadows, which carry no semantic colour.
  const neutral = new Set(["#000", "#fff", "#000000", "#ffffff"]);
  for (const css of [BASE_CSS, INTERNAL_CSS, PUBLIC_CSS]) {
    for (const match of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      assert(
        neutral.has(match[0].toLowerCase()),
        `stylesheet hard-codes ${match[0]}; use a --tk-* token instead`,
      );
    }
  }
});

Deno.test("contrast maths matches known WCAG reference values", () => {
  assertEquals(Math.round(contrastRatio("#000000", "#ffffff") * 100) / 100, 21);
  assertEquals(Math.round(contrastRatio("#ffffff", "#ffffff") * 100) / 100, 1);
  assertEquals(Math.round(relativeLuminance("#ffffff") * 1000) / 1000, 1);
  assertEquals(Math.round(relativeLuminance("#000000") * 1000) / 1000, 0);
  assertEquals(parseHex("#0a7262"), { r: 10, g: 114, b: 98 });
  assertEquals(parseHex("#fff"), { r: 255, g: 255, b: 255 });
});
