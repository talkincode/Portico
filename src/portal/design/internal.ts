/**
 * Internal console: the dense, work-first surface.
 *
 * Layout is a three-pane instrument — navigation rail, record list, reader —
 * because an internal operator is comparing records, not reading a story. All
 * colour still comes from tokens, so this file only decides composition.
 */

export const INTERNAL_CSS = `
/* ── top bar ───────────────────────────────────────────────────────────── */
.int-top {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: var(--tk-s5);
  height: var(--tk-header-h);
  padding-inline: var(--tk-s5);
  background: var(--tk-surface);
  border-bottom: 1px solid var(--tk-border);
}
.int-top__nav { display: flex; align-items: center; gap: var(--tk-s1); }
.int-top__tools { display: flex; align-items: center; gap: var(--tk-s3); margin-left: auto; }

.int-identity {
  display: flex;
  align-items: center;
  gap: var(--tk-s2);
  padding-left: var(--tk-s4);
  border-left: 1px solid var(--tk-border);
}
.int-identity__role {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--tk-ink);
}
.int-identity__id {
  font-family: var(--tk-font-mono);
  font-size: 0.7rem;
  color: var(--tk-faint);
  max-width: 18ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── shell ─────────────────────────────────────────────────────────────── */
.int-body {
  display: grid;
  grid-template-columns: var(--tk-rail) minmax(0, 1fr);
  min-height: calc(100vh - var(--tk-header-h));
}
.int-body[data-panes="three"] {
  grid-template-columns: var(--tk-rail) var(--tk-list) minmax(0, 1fr);
}

/* ── navigation rail ───────────────────────────────────────────────────── */
.int-rail {
  position: sticky;
  top: var(--tk-header-h);
  align-self: start;
  height: calc(100vh - var(--tk-header-h));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.int-rail__spacer { flex: 1 1 auto; }
.int-rail__foot {
  padding: var(--tk-s3) var(--tk-s4) var(--tk-s5);
  border-top: 1px solid var(--tk-panel-border);
}
.int-rail__note {
  font-size: 0.72rem;
  line-height: 1.55;
  color: var(--tk-panel-muted);
}
.int-rail__note strong { color: var(--tk-panel-ink); font-weight: 600; }

.int-rail__mark {
  margin: var(--tk-s4) var(--tk-s3);
  padding: var(--tk-s4);
  border-radius: var(--tk-r-md);
  border: 1px solid var(--tk-panel-border);
  background: var(--tk-surface);
}
.int-rail__mark p { font-size: 0.74rem; color: var(--tk-panel-muted); line-height: 1.5; }
.int-rail__mark .tk-brand__mark { font-size: 0.8rem; }

/* ── record list ───────────────────────────────────────────────────────── */
.int-list {
  position: sticky;
  top: var(--tk-header-h);
  align-self: start;
  height: calc(100vh - var(--tk-header-h));
  overflow-y: auto;
  border-right: 1px solid var(--tk-border);
  background: var(--tk-surface);
}
.int-list__head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--tk-s3);
  padding: var(--tk-s4) var(--tk-s4) var(--tk-s3);
  background: var(--tk-surface);
  border-bottom: 1px solid var(--tk-rule);
}
.int-list__title { font-size: 0.9rem; font-weight: 700; }
.int-list__sort {
  font-size: 0.72rem;
  color: var(--tk-faint);
  font-family: var(--tk-font-mono);
}
.int-list__items { padding: var(--tk-s3); display: flex; flex-direction: column; gap: var(--tk-s2); }

/* A record row: thumbnail, headline, one-line abstract, provenance. */
.int-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: var(--tk-s3);
  padding: var(--tk-s3) var(--tk-s3) var(--tk-s3) var(--tk-s2);
  border: 1px solid transparent;
  border-radius: var(--tk-r-md);
  transition: background-color 120ms var(--tk-ease), border-color 120ms var(--tk-ease);
}
.int-row:hover { background: var(--tk-sunken); border-color: var(--tk-border); }
.int-row[aria-current="true"] {
  background: var(--tk-accent-soft);
  border-color: var(--tk-accent-line);
}
.int-row__title {
  font-size: 0.86rem;
  font-weight: 650;
  line-height: 1.4;
  margin-bottom: 3px;
}
.int-row__abs {
  font-size: 0.76rem;
  color: var(--tk-muted);
  line-height: 1.5;
  margin-bottom: 6px;
}
.int-row__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }

/* ── generated thumbnail ───────────────────────────────────────────────── */
.int-thumb {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: var(--tk-r-sm);
  border: 1px solid var(--tk-border);
  overflow: hidden;
  display: grid;
  place-items: center;
  background-color: var(--tk-sunken);
  flex: none;
}
.int-thumb::before {
  content: "";
  position: absolute;
  inset: 0;
  opacity: 0.85;
}
.int-thumb::after {
  content: attr(data-glyph);
  position: relative;
  font-family: var(--tk-font-mono);
  font-size: 0.82rem;
  color: var(--tk-accent);
}
.int-thumb[data-pattern="0"]::before {
  background-image: linear-gradient(var(--tk-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--tk-border) 1px, transparent 1px);
  background-size: 10px 10px;
}
.int-thumb[data-pattern="1"]::before {
  background-image: repeating-linear-gradient(
    -45deg,
    var(--tk-accent-soft) 0 5px,
    transparent 5px 11px
  );
}
.int-thumb[data-pattern="2"]::before {
  background-image: radial-gradient(circle at 30% 30%, var(--tk-accent-soft), transparent 62%);
}
.int-thumb--lg { width: 76px; height: 76px; border-radius: var(--tk-r-md); }
.int-thumb--lg::after { font-size: 1.15rem; }

/* ── reader pane ───────────────────────────────────────────────────────── */
.int-reader { min-width: 0; padding: var(--tk-s6) var(--tk-s7) var(--tk-s9); }

.int-crumb {
  display: flex;
  align-items: center;
  gap: var(--tk-s2);
  font-size: 0.76rem;
  color: var(--tk-faint);
  font-family: var(--tk-font-mono);
  margin-bottom: var(--tk-s5);
}
.int-crumb a:hover { color: var(--tk-accent); }
.int-crumb__sep { opacity: 0.5; }

.int-doc { max-width: var(--tk-read); }
.int-doc__kicker { display: flex; align-items: center; gap: var(--tk-s2); margin-bottom: var(--tk-s3); }
.int-doc__title {
  font-size: clamp(1.55rem, 2.4vw, 2rem);
  font-weight: 680;
  letter-spacing: -0.02em;
  line-height: 1.24;
  margin-bottom: var(--tk-s3);
}
.int-doc__lede { font-size: 0.98rem; color: var(--tk-muted); line-height: 1.75; }

.int-byline {
  display: flex;
  align-items: center;
  gap: var(--tk-s3);
  flex-wrap: wrap;
  padding: var(--tk-s4) 0;
  margin-bottom: var(--tk-s4);
  border-bottom: 1px solid var(--tk-rule);
}
.int-byline__who {
  display: flex;
  align-items: center;
  gap: var(--tk-s2);
  font-size: 0.82rem;
  font-weight: 600;
}
.int-byline__avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--tk-accent-soft);
  color: var(--tk-accent);
  font-family: var(--tk-font-mono);
  font-size: 0.68rem;
  font-weight: 700;
  border: 1px solid var(--tk-accent-line);
}

.int-actions { display: flex; align-items: center; gap: var(--tk-s2); margin-left: auto; }

.int-section { margin-top: var(--tk-s7); }
.int-section__title {
  display: flex;
  align-items: baseline;
  gap: var(--tk-s3);
  font-size: 1rem;
  font-weight: 680;
  padding-bottom: var(--tk-s2);
  border-bottom: 1px solid var(--tk-rule);
  margin-bottom: var(--tk-s4);
}
.int-section__index {
  font-family: var(--tk-font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  color: var(--tk-accent);
}
.int-section__body { font-size: 0.92rem; line-height: 1.85; color: var(--tk-ink); }
.int-section__body p + p { margin-top: var(--tk-s3); }

/* ── pipeline strip ────────────────────────────────────────────────────── */
.int-pipe { display: flex; align-items: stretch; gap: var(--tk-s2); flex-wrap: wrap; }
.int-pipe__step {
  flex: 1 1 128px;
  padding: var(--tk-s3) var(--tk-s4);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-md);
  background: var(--tk-surface);
}
.int-pipe__arrow {
  align-self: center;
  color: var(--tk-border-strong);
  font-family: var(--tk-font-mono);
}
.int-pipe__name { font-size: 0.82rem; font-weight: 650; }
.int-pipe__note { font-size: 0.7rem; color: var(--tk-faint); margin-top: 2px; }

/* ── catalogue table page ──────────────────────────────────────────────── */
.int-page { padding: var(--tk-s6) var(--tk-s7) var(--tk-s9); min-width: 0; }
.int-page__head { margin-bottom: var(--tk-s5); }
.int-page__title { font-size: 1.5rem; font-weight: 680; letter-spacing: -0.02em; }
.int-page__sub { font-size: 0.88rem; color: var(--tk-muted); margin-top: var(--tk-s1); }

.int-filters {
  display: flex;
  align-items: center;
  gap: var(--tk-s2);
  flex-wrap: wrap;
  margin: var(--tk-s5) 0;
  padding-bottom: var(--tk-s4);
  border-bottom: 1px solid var(--tk-rule);
}

/* ── audit timeline ────────────────────────────────────────────────────── */
.int-audit__event { display: flex; flex-direction: column; gap: 3px; }.int-audit__summary { font-size: 0.88rem; }

/* ── audit conclusions: what stands, and as of when ────────────────────── */
.int-standings {
  margin: var(--tk-s5) 0;
  padding: var(--tk-s5);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-md);
  background: var(--tk-surface);
}
.int-standings__intro { margin-bottom: var(--tk-s4); }
.int-standings__title { font-size: 1rem; font-weight: 660; letter-spacing: -0.01em; }
.int-standings__sub, .int-standings__window {
  font-size: 0.8rem;
  color: var(--tk-muted);
  margin-top: var(--tk-s1);
}
.int-standings__window {
  padding: var(--tk-s2) var(--tk-s3);
  margin-top: var(--tk-s2);
  border-left: 2px solid var(--tk-border-strong);
  background: var(--tk-sunken);
  font-family: var(--tk-font-mono);
  font-size: 0.74rem;
}
.int-standings__rows { display: grid; gap: var(--tk-s2); list-style: none; }
.int-standings__row {
  padding: var(--tk-s3);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-sm);
}
.int-standings__head { display: flex; align-items: center; gap: var(--tk-s2); flex-wrap: wrap; }
.int-standings__subject { font-weight: 620; font-family: var(--tk-font-mono); font-size: 0.84rem; }
.int-standings__meta, .int-standings__source {
  font-size: 0.72rem;
  color: var(--tk-faint);
  font-family: var(--tk-font-mono);
  margin-top: 3px;
}
.int-standings__note { font-size: 0.84rem; margin-top: var(--tk-s2); }

/* Both window declarations read alike: they state a fact about the reader's
   window, and are not part of the verdict they sit beside. */
.int-integrity__scope {
  margin-top: var(--tk-s2);
  padding: var(--tk-s2) var(--tk-s3);
  border-left: 2px solid var(--tk-border-strong);
  background: var(--tk-sunken);
  font-size: 0.8rem;
  color: var(--tk-muted);
}

.int-filters__hint {
  flex-basis: 100%;
  font-size: 0.72rem;
  color: var(--tk-faint);
}
.int-filters__reset { font-size: 0.78rem; }.int-audit__summary { font-size: 0.88rem; }.int-audit__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tk-s2);
  font-size: 0.72rem;
  font-family: var(--tk-font-mono);
  color: var(--tk-faint);
}

/* ── responsive ────────────────────────────────────────────────────────── */
@media (max-width: 1180px) {
  .int-body[data-panes="three"] { grid-template-columns: var(--tk-rail) minmax(0, 1fr); }
  .int-body[data-panes="three"] .int-list { display: none; }
}
@media (max-width: 900px) {
  .int-body, .int-body[data-panes="three"] { grid-template-columns: minmax(0, 1fr); }
  .int-rail { display: none; }
  .int-reader, .int-page { padding: var(--tk-s5) var(--tk-s4) var(--tk-s8); }
  .int-top { gap: var(--tk-s3); padding-inline: var(--tk-s4); }
  .int-top__nav { display: none; }
}
`.trim();
