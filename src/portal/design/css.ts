/**
 * Portico base stylesheet: the reusable layer both surfaces share.
 *
 * Rules here are tone-agnostic — they only ever read semantic tokens, so the
 * same markup renders as a dense internal console or as an editorial page by
 * swapping `data-theme`. Surface-specific composition lives in `internal.ts`
 * and `public.ts`.
 *
 * Constraint: the portal serves `default-src 'none'`, so this sheet may not
 * reference images, fonts, or scripts. All texture is CSS.
 */

export const BASE_CSS = `
/* ── reset ─────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--tk-canvas);
  color: var(--tk-ink);
  font-family: var(--tk-font-body);
  font-size: 15px;
  line-height: 1.6;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { margin: 0; font-weight: 600; line-height: 1.25; }
p { margin: 0; }
ul, ol { margin: 0; padding: 0; list-style: none; }
a { color: inherit; text-decoration: none; }
img, svg { max-width: 100%; display: block; }
button, input, select, textarea { font: inherit; color: inherit; }
table { border-collapse: collapse; width: 100%; }
code, kbd, samp, pre { font-family: var(--tk-font-mono); font-size: 0.92em; }
hr { border: 0; border-top: 1px solid var(--tk-rule); margin: 0; }

/* ── token defaults ────────────────────────────────────────────────────── */
:root {
  --tk-font-app: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif;
  --tk-font-body: var(--tk-font-app);
  --tk-font-display: var(--tk-font-app);
  --tk-font-mono: ui-monospace, SFMono-Regular, "SF Mono", "JetBrains Mono", Menlo,
    Consolas, "Liberation Mono", monospace;
  --tk-font-num: var(--tk-font-mono);

  --tk-r-xs: 4px;
  --tk-r-sm: 6px;
  --tk-r-md: 10px;
  --tk-r-lg: 14px;
  --tk-r-xl: 20px;
  --tk-r-pill: 999px;

  --tk-s1: 4px;
  --tk-s2: 8px;
  --tk-s3: 12px;
  --tk-s4: 16px;
  --tk-s5: 20px;
  --tk-s6: 24px;
  --tk-s7: 32px;
  --tk-s8: 40px;
  --tk-s9: 56px;
  --tk-s10: 80px;

  --tk-shell: 1440px;
  --tk-read: 42rem;
  --tk-rail: 232px;
  --tk-list: 336px;
  --tk-header-h: 56px;

  --tk-mono-xs: 0.7rem;
  --tk-ease: cubic-bezier(0.2, 0.7, 0.3, 1);
}

/* The internal console reads as an instrument: sans everywhere, tabular
   figures, and no display serif to soften a governance state. */
[data-tone="internal"] {
  --tk-font-body: var(--tk-font-app);
  --tk-font-display: var(--tk-font-app);
}

/* The editorial surface pairs a serif voice with a sans apparatus, so a
   headline and its metadata never look like the same voice. */
[data-tone="public"] {
  --tk-font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia,
    "Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", serif;
  --tk-font-body: var(--tk-font-app);
}

/* ── layout primitives ─────────────────────────────────────────────────── */
.tk-shell {
  width: 100%;
  max-width: var(--tk-shell);
  margin: 0 auto;
  padding-inline: var(--tk-s6);
}
.tk-stack { display: flex; flex-direction: column; }
.tk-row { display: flex; align-items: center; }
.tk-spread { display: flex; align-items: center; justify-content: space-between; gap: var(--tk-s4); }
.tk-grow { flex: 1 1 auto; min-width: 0; }
.tk-cluster { display: flex; flex-wrap: wrap; align-items: center; gap: var(--tk-s2); }
.tk-rule { border-top: 1px solid var(--tk-rule); }

.tk-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tk-clamp-2, .tk-clamp-3 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tk-clamp-2 { -webkit-line-clamp: 2; }
.tk-clamp-3 { -webkit-line-clamp: 3; }
.tk-sr {
  position: absolute; width: 1px; height: 1px; margin: -1px;
  padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}

/* ── typography ────────────────────────────────────────────────────────── */
.tk-eyebrow {
  font-size: var(--tk-mono-xs);
  font-family: var(--tk-font-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--tk-faint);
  font-weight: 600;
}
.tk-kicker {
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--tk-accent);
  font-weight: 700;
}
.tk-lede { font-size: 1.02rem; color: var(--tk-muted); line-height: 1.7; }
.tk-meta {
  font-size: 0.76rem;
  font-family: var(--tk-font-mono);
  color: var(--tk-faint);
  font-variant-numeric: tabular-nums;
}
.tk-label { font-size: 0.86rem; font-weight: 600; }
.tk-dim { color: var(--tk-muted); }
.tk-faint { color: var(--tk-faint); }
.tk-num { font-family: var(--tk-font-num); font-variant-numeric: tabular-nums; }
.tk-id {
  font-family: var(--tk-font-mono);
  font-size: 0.74rem;
  color: var(--tk-faint);
  background: var(--tk-sunken);
  border-radius: var(--tk-r-xs);
  padding: 1px 6px;
}

/* ── brand ─────────────────────────────────────────────────────────────── */
.tk-brand { display: inline-flex; align-items: baseline; gap: 10px; color: var(--tk-ink); }
.tk-brand__mark {
  font-family: var(--tk-font-mono);
  font-weight: 700;
  font-size: 0.96rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
}
.tk-brand__sub {
  font-size: 0.68rem;
  font-family: var(--tk-font-mono);
  letter-spacing: 0.08em;
  color: var(--tk-faint);
}
.tk-brand__dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--tk-accent);
  display: inline-block;
  align-self: center;
}

/* ── chips ─────────────────────────────────────────────────────────────── */
.tk-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 21px;
  padding: 0 8px;
  border-radius: var(--tk-r-pill);
  border: 1px solid var(--tk-border);
  background: var(--tk-sunken);
  color: var(--tk-muted);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
}
.tk-chip--state {
  border-color: var(--tk-state-line);
  background: var(--tk-state-soft);
  color: var(--tk-state);
}
.tk-chip--state::before {
  content: "";
  width: 5px; height: 5px; border-radius: 50%;
  background: currentColor;
}
.tk-chip--accent {
  border-color: var(--tk-accent-line);
  background: var(--tk-accent-soft);
  color: var(--tk-accent);
}
.tk-chip--plain { background: transparent; }
.tk-chip--channel {
  font-family: var(--tk-font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 0.66rem;
}
.tk-chip--pending { border-style: dashed; }

/* ── panel / card ──────────────────────────────────────────────────────── */
.tk-panel {
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-lg);
}
.tk-panel--flush { border-radius: 0; border-inline: 0; }
.tk-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--tk-s3);
  padding: var(--tk-s4) var(--tk-s5);
  border-bottom: 1px solid var(--tk-rule);
}
.tk-panel__body { padding: var(--tk-s5); }
.tk-panel__title {
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.tk-card {
  display: block;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-md);
  padding: var(--tk-s4) var(--tk-s5);
  transition: border-color 140ms var(--tk-ease), transform 140ms var(--tk-ease),
    box-shadow 140ms var(--tk-ease);
}
a.tk-card:hover, a.tk-card:focus-visible {
  border-color: var(--tk-border-strong);
  box-shadow: var(--tk-shadow);
}
a.tk-card:hover { transform: translateY(-1px); }

/* ── buttons / toolbar ─────────────────────────────────────────────────── */
.tk-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--tk-r-sm);
  border: 1px solid var(--tk-border);
  background: var(--tk-surface);
  color: var(--tk-ink);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms var(--tk-ease), border-color 120ms var(--tk-ease);
}
.tk-btn:hover { background: var(--tk-sunken); border-color: var(--tk-border-strong); }
.tk-btn--quiet { background: transparent; border-color: transparent; color: var(--tk-muted); }
.tk-btn--quiet:hover { background: var(--tk-sunken); color: var(--tk-ink); }
.tk-btn--accent {
  background: var(--tk-accent);
  border-color: var(--tk-accent);
  color: var(--tk-accent-ink);
}
.tk-btn--accent:hover { background: var(--tk-accent); filter: brightness(1.08); }

/* A search affordance is decorative here: the portal is read-only and ships no
   script, so it is rendered as a non-interactive field, never a fake input. */
.tk-search {
  display: inline-flex;
  align-items: center;
  gap: var(--tk-s2);
  height: 32px;
  min-width: 200px;
  padding: 0 10px;
  border-radius: var(--tk-r-sm);
  border: 1px solid var(--tk-border);
  background: var(--tk-sunken);
  color: var(--tk-faint);
  font-size: 0.8rem;
}
.tk-search__key {
  margin-left: auto;
  font-family: var(--tk-font-mono);
  font-size: 0.66rem;
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-xs);
  padding: 0 5px;
  background: var(--tk-surface);
}

/* ── segmented filter row ──────────────────────────────────────────────── */
.tk-tabs { display: flex; align-items: center; gap: var(--tk-s1); }
.tk-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: var(--tk-r-sm);
  color: var(--tk-muted);
  font-size: 0.84rem;
  font-weight: 600;
}
.tk-tab:hover { background: var(--tk-sunken); color: var(--tk-ink); }
.tk-tab[aria-current="true"] { background: var(--tk-accent-soft); color: var(--tk-accent); }
.tk-tab__count {
  font-family: var(--tk-font-mono);
  font-size: 0.68rem;
  opacity: 0.7;
}

/* ── nav rail ──────────────────────────────────────────────────────────── */
.tk-rail {
  background: var(--tk-panel);
  border-right: 1px solid var(--tk-panel-border);
  color: var(--tk-panel-ink);
}
.tk-rail__group { padding: var(--tk-s3) var(--tk-s2); }
.tk-rail__heading {
  font-size: var(--tk-mono-xs);
  font-family: var(--tk-font-mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--tk-panel-muted);
  padding: 0 var(--tk-s3) var(--tk-s2);
}
.tk-navitem {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 var(--tk-s3);
  border-radius: var(--tk-r-sm);
  color: var(--tk-panel-ink);
  font-size: 0.86rem;
  font-weight: 500;
}
.tk-navitem:hover { background: var(--tk-panel-active); }
.tk-navitem[aria-current="page"] {
  background: var(--tk-panel-active);
  color: var(--tk-accent);
  font-weight: 650;
}
.tk-navitem__glyph {
  width: 18px;
  text-align: center;
  font-family: var(--tk-font-mono);
  font-size: 0.8rem;
  opacity: 0.85;
}
.tk-navitem__count {
  margin-left: auto;
  font-family: var(--tk-font-mono);
  font-size: 0.7rem;
  color: var(--tk-panel-muted);
}

/* ── stat ──────────────────────────────────────────────────────────────── */
.tk-stat { display: flex; flex-direction: column; gap: 2px; }
a.tk-stat:hover { background: var(--tk-raised); }
a.tk-stat:hover .tk-stat__label { color: var(--tk-accent); }
.tk-stat__value {
  font-family: var(--tk-font-num);
  font-variant-numeric: tabular-nums;
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.tk-stat__label { font-size: 0.74rem; color: var(--tk-faint); }
.tk-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1px;
  background: var(--tk-border);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-md);
  overflow: hidden;
}
.tk-stats > * { background: var(--tk-surface); padding: var(--tk-s4); }

/* ── definition list ───────────────────────────────────────────────────── */
.tk-dl { display: grid; grid-template-columns: minmax(84px, max-content) 1fr; gap: 10px var(--tk-s4); }
.tk-dl dt { font-size: 0.78rem; color: var(--tk-faint); }
.tk-dl dd { margin: 0; font-size: 0.86rem; min-width: 0; overflow-wrap: anywhere; }

/* ── table ─────────────────────────────────────────────────────────────── */
.tk-table th {
  text-align: left;
  font-size: var(--tk-mono-xs);
  font-family: var(--tk-font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--tk-faint);
  font-weight: 600;
  padding: 10px var(--tk-s4);
  border-bottom: 1px solid var(--tk-border);
  white-space: nowrap;
}
.tk-table td {
  padding: 12px var(--tk-s4);
  border-bottom: 1px solid var(--tk-rule);
  font-size: 0.86rem;
  vertical-align: middle;
}
.tk-table tbody tr:last-child td { border-bottom: 0; }
.tk-table tbody tr:hover { background: var(--tk-sunken); }

/* ── states ────────────────────────────────────────────────────────────── */
.tk-empty {
  padding: var(--tk-s8) var(--tk-s5);
  text-align: center;
  color: var(--tk-faint);
  font-size: 0.9rem;
}
.tk-empty__title { color: var(--tk-muted); font-weight: 600; margin-bottom: var(--tk-s1); }

.tk-note {
  display: flex;
  gap: var(--tk-s3);
  padding: var(--tk-s3) var(--tk-s4);
  border-radius: var(--tk-r-sm);
  border: 1px solid var(--tk-border);
  background: var(--tk-sunken);
  font-size: 0.82rem;
  color: var(--tk-muted);
}
.tk-note--boundary {
  border-color: var(--tk-state-line);
  background: var(--tk-state-soft);
  color: var(--tk-state);
  font-weight: 500;
}
.tk-note__glyph { font-family: var(--tk-font-mono); flex: none; }

/* ── timeline ──────────────────────────────────────────────────────────── */
.tk-timeline { position: relative; padding-left: var(--tk-s5); }
.tk-timeline::before {
  content: "";
  position: absolute;
  left: 5px; top: 4px; bottom: 4px;
  width: 1px;
  background: var(--tk-border);
}
.tk-timeline__item { position: relative; padding-bottom: var(--tk-s4); }
.tk-timeline__item::before {
  content: "";
  position: absolute;
  left: calc(-1 * var(--tk-s5) + 2px);
  top: 6px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--tk-surface);
  border: 1.5px solid var(--tk-border-strong);
}
.tk-timeline__item[data-kind="approval"]::before { border-color: var(--tk-state-pending); }
.tk-timeline__item[data-kind="credential"]::before { border-color: var(--tk-state-public); }

/* ── code / coordinate ─────────────────────────────────────────────────── */
.tk-code {
  display: inline-block;
  font-family: var(--tk-font-mono);
  font-size: 0.78rem;
  padding: 2px 7px;
  border-radius: var(--tk-r-xs);
  border: 1px solid var(--tk-border);
  background: var(--tk-sunken);
  color: var(--tk-ink);
  overflow-wrap: anywhere;
}
.tk-link {
  color: var(--tk-accent);
  text-decoration: underline;
  text-decoration-color: var(--tk-accent-line);
  text-underline-offset: 3px;
  overflow-wrap: anywhere;
}
.tk-link:hover { text-decoration-color: currentColor; }

/* ── focus ─────────────────────────────────────────────────────────────── */
:focus-visible {
  outline: 2px solid var(--tk-accent);
  outline-offset: 2px;
  border-radius: var(--tk-r-xs);
}

/* ── footer ────────────────────────────────────────────────────────────── */
.tk-footer {
  border-top: 1px solid var(--tk-rule);
  margin-top: var(--tk-s9);
  padding: var(--tk-s6) 0 var(--tk-s8);
  color: var(--tk-faint);
  font-size: 0.78rem;
}

/* ── theme switch ──────────────────────────────────────────────────────── */
.tk-themeswitch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--tk-r-pill);
  border: 1px solid var(--tk-border);
  background: var(--tk-sunken);
}
.tk-themeswitch__option {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border-radius: var(--tk-r-pill);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--tk-faint);
}
.tk-themeswitch__option:hover { color: var(--tk-ink); }
.tk-themeswitch__option[aria-current="true"] {
  background: var(--tk-surface);
  color: var(--tk-ink);
  box-shadow: var(--tk-shadow);
}

/* ── response ──────────────────────────────────────────────────────────── */
@media (max-width: 1080px) {
  .tk-shell { padding-inline: var(--tk-s4); }
}
@media (max-width: 720px) {
  body { font-size: 14.5px; }
  .tk-dl { grid-template-columns: 1fr; gap: 2px var(--tk-s4); }
  .tk-dl dt { margin-top: var(--tk-s2); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
`.trim();
