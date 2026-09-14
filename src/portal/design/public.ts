/**
 * Public surface: the editorial page.
 *
 * Same tokens, opposite temperament — a masthead, a lead story, an asymmetric
 * two-column well, and a rail of topic indexes. Nothing here is authored by a
 * maintainer: every "article" is an approved catalog record rendered through a
 * fixed template, so the publication can never become a CMS.
 */

export const PUBLIC_CSS = `
/* ── masthead ──────────────────────────────────────────────────────────── */
.pub-masthead {
  position: sticky;
  top: 0;
  z-index: 20;
  background: color-mix(in srgb, var(--tk-surface) 88%, transparent);
  backdrop-filter: saturate(140%) blur(10px);
  border-bottom: 1px solid var(--tk-border);
}
.pub-masthead__inner {
  display: flex;
  align-items: center;
  gap: var(--tk-s6);
  height: 58px;
}
.pub-masthead .tk-brand__mark { font-size: 1.02rem; }
.pub-nav { display: flex; align-items: center; gap: var(--tk-s5); }
.pub-nav__link {
  font-size: 0.86rem;
  font-weight: 550;
  color: var(--tk-muted);
  padding: 4px 0;
  border-bottom: 2px solid transparent;
}
.pub-nav__link:hover { color: var(--tk-ink); }
.pub-nav__link[aria-current="page"] {
  color: var(--tk-ink);
  border-bottom-color: var(--tk-accent);
}
.pub-masthead__tools { display: flex; align-items: center; gap: var(--tk-s3); margin-left: auto; }

.pub-notice {
  background: var(--tk-sunken);
  border-bottom: 1px solid var(--tk-rule);
  font-size: 0.76rem;
  color: var(--tk-faint);
}
.pub-notice__inner {
  display: flex;
  align-items: center;
  gap: var(--tk-s3);
  height: 34px;
  font-family: var(--tk-font-mono);
}
.pub-notice__dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--tk-accent);
  flex: none;
}

/* ── page title band ───────────────────────────────────────────────────── */
.pub-band { padding: var(--tk-s8) 0 var(--tk-s6); }
.pub-band__eyebrow { margin-bottom: var(--tk-s3); }
.pub-band__title {
  font-family: var(--tk-font-display);
  font-size: clamp(2rem, 4.2vw, 3.1rem);
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.1;
  max-width: 20ch;
}
.pub-band__lede {
  margin-top: var(--tk-s4);
  max-width: 46ch;
  font-size: 1.02rem;
  color: var(--tk-muted);
  line-height: 1.7;
}
.pub-band__rule {
  margin-top: var(--tk-s6);
  height: 1px;
  background: linear-gradient(90deg, var(--tk-border-strong), transparent);
}

/* ── lead story ────────────────────────────────────────────────────────── */
.pub-lead {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: var(--tk-s7);
  align-items: stretch;
  padding: var(--tk-s6) 0 var(--tk-s7);
  border-bottom: 1px solid var(--tk-rule);
}
.pub-lead__kicker { display: flex; align-items: center; gap: var(--tk-s2); margin-bottom: var(--tk-s3); }
.pub-lead__title {
  font-family: var(--tk-font-display);
  font-size: clamp(1.6rem, 2.8vw, 2.35rem);
  font-weight: 600;
  line-height: 1.18;
  letter-spacing: -0.02em;
  margin-bottom: var(--tk-s3);
}
.pub-lead__title a:hover { color: var(--tk-accent); }
.pub-lead__abs { font-size: 1rem; color: var(--tk-muted); line-height: 1.75; max-width: 54ch; }
.pub-lead__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tk-s3);
  margin-top: var(--tk-s4);
  font-size: 0.76rem;
  font-family: var(--tk-font-mono);
  color: var(--tk-faint);
}
.pub-lead__art { min-height: 260px; }

/* ── generated editorial art ───────────────────────────────────────────── */
.pub-art {
  position: relative;
  height: 100%;
  min-height: 160px;
  border-radius: var(--tk-r-lg);
  border: 1px solid var(--tk-border);
  overflow: hidden;
  background: var(--tk-sunken);
  display: grid;
  place-items: center;
  isolation: isolate;
}
.pub-art::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
}
.pub-art__glyph {
  font-family: var(--tk-font-display);
  font-size: clamp(2.4rem, 5vw, 3.6rem);
  color: var(--tk-accent);
  opacity: 0.9;
}
.pub-art__caption {
  position: absolute;
  left: var(--tk-s4);
  bottom: var(--tk-s3);
  font-family: var(--tk-font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--tk-faint);
}
.pub-art[data-pattern="0"]::before {
  background-image:
    linear-gradient(var(--tk-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--tk-border) 1px, transparent 1px);
  background-size: 28px 28px;
  mask-image: radial-gradient(circle at 50% 45%, #000 20%, transparent 72%);
}
.pub-art[data-pattern="1"]::before {
  background-image: repeating-linear-gradient(
    115deg,
    var(--tk-accent-soft) 0 14px,
    transparent 14px 34px
  );
}
.pub-art[data-pattern="2"]::before {
  background-image: radial-gradient(circle at 25% 20%, var(--tk-accent-soft), transparent 60%),
    radial-gradient(circle at 80% 85%, var(--tk-accent-soft), transparent 55%);
}
/* Fine rules read as an engraved plate rather than a decorative blob. */
.pub-art[data-pattern="3"]::before {
  background-image: repeating-linear-gradient(
    0deg,
    var(--tk-border) 0 1px,
    transparent 1px 7px
  );
  mask-image: linear-gradient(90deg, #000 0%, transparent 85%);
}
.pub-art--sm { min-height: 96px; border-radius: var(--tk-r-md); }
.pub-art--sm .pub-art__glyph { font-size: 1.5rem; }

/* ── two-column well ───────────────────────────────────────────────────── */
.pub-well {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 328px;
  gap: var(--tk-s8);
  align-items: start;
  padding-top: var(--tk-s7);
}

/* ── story rows ────────────────────────────────────────────────────────── */
.pub-group { margin-bottom: var(--tk-s7); }
.pub-group__head {
  display: flex;
  align-items: baseline;
  gap: var(--tk-s3);
  padding-bottom: var(--tk-s3);
  border-bottom: 2px solid var(--tk-ink);
  margin-bottom: var(--tk-s4);
}
.pub-group__title {
  font-family: var(--tk-font-display);
  font-size: 1.22rem;
  font-weight: 620;
}
.pub-group__note { font-size: 0.76rem; color: var(--tk-faint); margin-left: auto; }

.pub-story {
  display: grid;
  grid-template-columns: 148px minmax(0, 1fr);
  gap: var(--tk-s5);
  padding: var(--tk-s5) 0;
  border-bottom: 1px solid var(--tk-rule);
}
.pub-story:last-child { border-bottom: 0; }
.pub-story__badge {
  font-family: var(--tk-font-mono);
  font-size: var(--tk-mono-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--tk-accent);
  font-weight: 700;
  margin-bottom: var(--tk-s2);
}
.pub-story__title {
  font-family: var(--tk-font-display);
  font-size: 1.24rem;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: var(--tk-s2);
}
.pub-story__title a:hover { color: var(--tk-accent); }
.pub-story__abs { font-size: 0.88rem; color: var(--tk-muted); line-height: 1.7; }
.pub-story__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tk-s3);
  margin-top: var(--tk-s3);
  font-size: 0.72rem;
  font-family: var(--tk-font-mono);
  color: var(--tk-faint);
}

/* ── rail ──────────────────────────────────────────────────────────────── */
.pub-rail { position: sticky; top: 82px; display: flex; flex-direction: column; gap: var(--tk-s6); }
.pub-rail__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--tk-s3);
  padding-bottom: var(--tk-s3);
  border-bottom: 1px solid var(--tk-border);
  margin-bottom: var(--tk-s4);
}
.pub-rail__title { font-size: 0.94rem; font-weight: 700; }
.pub-rail__more { font-size: 0.72rem; color: var(--tk-accent); font-family: var(--tk-font-mono); }

.pub-topic {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  gap: var(--tk-s3);
  padding: var(--tk-s3) 0;
  border-bottom: 1px solid var(--tk-rule);
}
.pub-topic:last-child { border-bottom: 0; }
.pub-topic__name { font-size: 0.86rem; font-weight: 650; margin-bottom: 3px; }
.pub-topic__note { font-size: 0.74rem; color: var(--tk-muted); line-height: 1.55; }
.pub-topic__count {
  font-size: 0.68rem;
  font-family: var(--tk-font-mono);
  color: var(--tk-faint);
  margin-top: 5px;
}

.pub-pick {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: var(--tk-s3);
  padding: var(--tk-s3) 0;
  border-bottom: 1px solid var(--tk-rule);
}
.pub-pick:last-child { border-bottom: 0; }
.pub-pick__index {
  font-family: var(--tk-font-display);
  font-size: 1.06rem;
  color: var(--tk-accent);
  line-height: 1.2;
}
.pub-pick__title { font-size: 0.88rem; font-weight: 620; line-height: 1.45; margin-bottom: 3px; }
.pub-pick__abs { font-size: 0.74rem; color: var(--tk-muted); line-height: 1.55; }
.pub-pick__date {
  font-size: 0.68rem;
  font-family: var(--tk-font-mono);
  color: var(--tk-faint);
  margin-top: 5px;
}

.pub-card {
  padding: var(--tk-s4);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-md);
  background: var(--tk-surface);
}
.pub-card--tinted { background: var(--tk-accent-soft); border-color: var(--tk-accent-line); }
.pub-card__quote {
  font-family: var(--tk-font-display);
  font-size: 0.94rem;
  line-height: 1.6;
}
.pub-card__sig {
  margin-top: var(--tk-s3);
  font-size: 0.72rem;
  font-family: var(--tk-font-mono);
  color: var(--tk-muted);
}

/* ── article ───────────────────────────────────────────────────────────── */
.pub-article { padding: var(--tk-s6) 0 var(--tk-s9); }
.pub-article__head { max-width: 46rem; }
.pub-article__eyebrow { display: flex; align-items: center; gap: var(--tk-s2); margin-bottom: var(--tk-s4); }
.pub-article__title {
  font-family: var(--tk-font-display);
  font-size: clamp(1.9rem, 4vw, 2.9rem);
  font-weight: 600;
  line-height: 1.14;
  letter-spacing: -0.025em;
  margin-bottom: var(--tk-s4);
}
.pub-article__lede { font-size: 1.08rem; color: var(--tk-muted); line-height: 1.8; }
.pub-article__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--tk-s4);
  margin-top: var(--tk-s5);
  padding: var(--tk-s4) 0;
  border-top: 1px solid var(--tk-rule);
  border-bottom: 1px solid var(--tk-rule);
  font-size: 0.78rem;
  color: var(--tk-faint);
  font-family: var(--tk-font-mono);
}
.pub-article__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: var(--tk-s8);
  align-items: start;
  margin-top: var(--tk-s7);
}
.pub-prose { max-width: var(--tk-read); font-size: 1rem; line-height: 1.9; }
.pub-prose p + p { margin-top: var(--tk-s4); }
.pub-prose h2 {
  font-family: var(--tk-font-display);
  font-size: 1.35rem;
  font-weight: 620;
  margin: var(--tk-s7) 0 var(--tk-s3);
  padding-top: var(--tk-s3);
  border-top: 1px solid var(--tk-rule);
}
.pub-prose h2:first-child { margin-top: 0; border-top: 0; padding-top: 0; }
.pub-prose h2 .pub-prose__index {
  font-family: var(--tk-font-mono);
  font-size: 0.8rem;
  color: var(--tk-accent);
  margin-right: var(--tk-s3);
  letter-spacing: 0.08em;
}
.pub-prose h3 { font-size: 1.02rem; font-weight: 680; margin: var(--tk-s5) 0 var(--tk-s2); }
.pub-prose ul { margin: var(--tk-s3) 0; padding-left: 1.1rem; list-style: none; }
.pub-prose li { position: relative; padding-left: var(--tk-s4); margin-bottom: var(--tk-s2); }
.pub-prose li::before {
  content: "";
  position: absolute;
  left: 0; top: 0.68em;
  width: 5px; height: 1px;
  background: var(--tk-accent);
}

.pub-quote {
  margin: var(--tk-s6) 0;
  padding: var(--tk-s2) 0 var(--tk-s2) var(--tk-s5);
  border-left: 2px solid var(--tk-accent);
  font-family: var(--tk-font-display);
  font-size: 1.12rem;
  line-height: 1.66;
  color: var(--tk-ink);
}
.pub-quote cite {
  display: block;
  margin-top: var(--tk-s3);
  font-family: var(--tk-font-mono);
  font-size: 0.74rem;
  font-style: normal;
  color: var(--tk-faint);
}

/* ── flow diagram (the one editorial figure) ───────────────────────────── */
.pub-flow {
  display: flex;
  align-items: center;
  gap: var(--tk-s2);
  flex-wrap: wrap;
  margin: var(--tk-s6) 0;
  padding: var(--tk-s4);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-md);
  background: var(--tk-sunken);
}
.pub-flow__step {
  flex: 1 1 118px;
  text-align: center;
  padding: var(--tk-s3) var(--tk-s2);
  border-radius: var(--tk-r-sm);
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
}
.pub-flow__icon { font-family: var(--tk-font-mono); color: var(--tk-accent); font-size: 0.94rem; }
.pub-flow__name { font-size: 0.8rem; font-weight: 650; margin-top: 4px; }
.pub-flow__note { font-size: 0.68rem; color: var(--tk-faint); margin-top: 2px; }
.pub-flow__arrow { color: var(--tk-border-strong); font-family: var(--tk-font-mono); }

/* ── surface facts block ───────────────────────────────────────────────── */
.pub-facts {
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-r-md);
  background: var(--tk-surface);
  overflow: hidden;
}
.pub-facts__head {
  padding: var(--tk-s3) var(--tk-s4);
  border-bottom: 1px solid var(--tk-rule);
  font-size: 0.82rem;
  font-weight: 700;
}
.pub-facts__body { padding: var(--tk-s4); }

/* ── responsive / print ────────────────────────────────────────────────── */
@media (max-width: 1080px) {
  .pub-well { grid-template-columns: minmax(0, 1fr); gap: var(--tk-s7); }
  .pub-rail { position: static; }
  .pub-article__grid { grid-template-columns: minmax(0, 1fr); gap: var(--tk-s6); }
}
@media (max-width: 820px) {
  .pub-lead { grid-template-columns: minmax(0, 1fr); }
  .pub-lead__art { min-height: 180px; order: -1; }
  .pub-story { grid-template-columns: minmax(0, 1fr); }
  .pub-story__art { max-width: 220px; }
  .pub-nav { display: none; }
}
@media print {
  .pub-masthead, .pub-rail, .tk-themeswitch, .pub-notice { display: none; }
  body { background: #fff; }
  .pub-well { grid-template-columns: minmax(0, 1fr); }
  .pub-art { display: none; }
  a { text-decoration: underline; }
}
`.trim();
