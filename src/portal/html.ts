import type { AgentSurface, Channel } from "../catalog/mod.ts";
import type { DashboardView } from "../catalog/dashboard.ts";
import { CHANNEL_LABEL } from "./design/tokens.ts";

export type { DashboardView };

export type ThemeMode = "light" | "dark" | "system";
export type ChannelFilter = Channel | null;

export interface MagazinePick {
  id: string;
  name: string;
  description: string;
  governanceState: string;
  channels: string[];
  version: string;
}

export interface MagazinePageInput {
  theme: ThemeMode;
  channel: ChannelFilter;
  q?: string;
  view: DashboardView;
  selected?: AgentSurface;
  picks?: MagazinePick[];
  path?: string;
  /** Signed-in identities may reach `/internal`. Anonymous chrome must not. */
  showInternal?: boolean;
  /**
   * Unfiltered `pending_public` count for signed-in chrome. Absent for anonymous
   * so the magazine never advertises `/internal/pending`.
   */
  pendingPublic?: number;
}

const TITLE_FONT =
  'Songti SC, "Noto Serif SC", "Source Han Serif", Palatino, "Palatino Linotype", serif';

const MAGAZINE_CSS = `
      :root {
        --accent: #4A9EFF;
        --accent-soft: rgba(74, 158, 255, 0.12);
        --accent-line: rgba(74, 158, 255, 0.35);
        --bg: #F5F6F8;
        --text: #16181A;
        --muted: #5C6370;
        --faint: #8A9099;
        --panel: #FFFFFF;
        --card-bg: #FFFFFF;
        --tag-bg: #EEF1F5;
        --rule: #E4E6EA;
        --title-font: ${TITLE_FONT};
        color-scheme: light;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --accent: #4A9EFF;
          --accent-soft: rgba(74, 158, 255, 0.15);
          --accent-line: rgba(74, 158, 255, 0.35);
          --bg: #0B0D0F;
          --text: #F2F4F6;
          --muted: #8A9099;
          --faint: #5C6370;
          --panel: #121417;
          --card-bg: #14171B;
          --tag-bg: #1C2025;
          --rule: #24282C;
          color-scheme: dark;
        }
      }
      [data-theme="light"] {
        --accent: #4A9EFF;
        --accent-soft: rgba(74, 158, 255, 0.12);
        --accent-line: rgba(74, 158, 255, 0.35);
        --bg: #F5F6F8;
        --text: #16181A;
        --muted: #5C6370;
        --faint: #8A9099;
        --panel: #FFFFFF;
        --card-bg: #FFFFFF;
        --tag-bg: #EEF1F5;
        --rule: #E4E6EA;
        color-scheme: light;
      }
      [data-theme="dark"] {
        --accent: #4A9EFF;
        --accent-soft: rgba(74, 158, 255, 0.15);
        --accent-line: rgba(74, 158, 255, 0.35);
        --bg: #0B0D0F;
        --text: #F2F4F6;
        --muted: #8A9099;
        --faint: #5C6370;
        --panel: #121417;
        --card-bg: #14171B;
        --tag-bg: #1C2025;
        --rule: #24282C;
        color-scheme: dark;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; background: var(--bg); color: var(--text); }
      body {
        min-height: 100vh;
        font-family: Palatino, "Palatino Linotype", "Songti SC", serif;
        letter-spacing: 0.01em;
        line-height: 1.6;
      }
      a { color: inherit; text-decoration: none; }
      a:hover { color: var(--accent); }

      /* Topbar / Masthead */
      .topbar {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 0.85rem 2rem;
        background: var(--panel);
        border-bottom: 1px solid var(--rule);
        position: sticky;
        top: 0;
        z-index: 50;
      }
      .brand-wrap {
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }
      .brand-logo-icon {
        width: 22px;
        height: 22px;
        color: var(--accent);
      }
      .brand {
        font-family: var(--title-font);
        font-size: 1.15rem;
        font-weight: 700;
        letter-spacing: 0.24em;
        color: var(--text);
        text-decoration: none;
      }
      .brand:hover { color: var(--accent); text-decoration: none; }
      .nav { display: flex; gap: 1.4rem; font-size: 0.95rem; margin-left: 1.5rem; }
      .nav a { color: var(--text); padding-bottom: 0.25rem; font-weight: 500; }
      .nav a.active {
        color: var(--accent);
        border-bottom: 2px solid var(--accent);
      }
      .nav [aria-disabled="true"] { color: var(--muted); cursor: not-allowed; }

      .topbar-right {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 1.25rem;
      }
      .review-entry a {
        font-size: 0.8rem;
        color: var(--muted);
        text-decoration: none;
        white-space: nowrap;
      }
      .review-entry a:hover { color: var(--text); }
      .search-box {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: var(--tag-bg);
        border: 1px solid var(--rule);
        border-radius: 6px;
        padding: 0.35rem 0.55rem 0.35rem 0.85rem;
        font-size: 0.82rem;
        color: var(--muted);
        min-width: 220px;
        margin: 0;
      }
      .search-box svg { width: 14px; height: 14px; stroke: var(--muted); flex: none; }
      .search-box input[type="search"] {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        color: var(--text);
        font: inherit;
        outline: none;
      }
      .search-box button {
        border: 0;
        background: transparent;
        color: var(--accent);
        font: inherit;
        font-size: 0.78rem;
        font-weight: 600;
        cursor: pointer;
        padding: 0.15rem 0.35rem;
      }
      .motto {
        font-size: 0.75rem;
        line-height: 1.35;
        color: var(--muted);
        border-left: 1px solid var(--rule);
        padding-left: 1rem;
        text-align: right;
      }
      .themes {
        display: flex;
        gap: 0.5rem;
        font-size: 0.8rem;
        border-left: 1px solid var(--rule);
        padding-left: 1rem;
      }
      .themes a {
        color: var(--muted);
        padding: 0.2rem 0.4rem;
        border-radius: 4px;
      }
      .themes a:hover {
        background: var(--tag-bg);
        color: var(--text);
        text-decoration: none;
      }

      /* Layout frames */
      .frame {
        width: min(86rem, calc(100% - 3rem));
        margin: 0 auto;
        padding: 2rem 0 4rem;
      }
      .home {
        display: grid;
        grid-template-columns: minmax(0, 1.85fr) minmax(19rem, 0.85fr);
        gap: 2.75rem;
      }

      /* Hero Section */
      .hero {
        background: var(--card-bg);
        border: 1px solid var(--rule);
        border-radius: 12px;
        padding: 2rem;
        margin-bottom: 2rem;
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: 2rem;
        align-items: stretch;
      }
      .hero-title {
        font-family: var(--title-font);
        font-size: clamp(2rem, 3.2vw, 2.75rem);
        font-weight: 700;
        margin: 0 0 0.85rem;
        line-height: 1.25;
      }
      .hero-title a { color: var(--text); }
      .hero-title a:hover { color: var(--accent); text-decoration: none; }
      .kicker {
        margin: 0 0 0.6rem;
        color: var(--accent);
        font-size: 0.82rem;
        font-weight: 600;
        letter-spacing: 0.08em;
      }
      .hero-desc {
        margin: 0 0 1.25rem;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.75;
      }
      .hero-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.84rem;
        color: var(--muted);
      }
      .hero-graphic-card {
        background: linear-gradient(135deg, #10151C 0%, #06080B 100%);
        border: 1px solid #202732;
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 1.5rem;
        position: relative;
        min-height: 220px;
      }
      .hero-graphic-card svg {
        position: absolute;
        right: -10px;
        top: 10px;
        width: 170px;
        height: 170px;
        opacity: 0.9;
      }
      .hero-graphic-text {
        position: relative;
        z-index: 2;
        margin-top: auto;
      }
      .hero-graphic-text .en-sub {
        font-size: 0.72rem;
        letter-spacing: 0.2em;
        color: #8A96A8;
        display: block;
        margin-bottom: 0.35rem;
      }
      .hero-graphic-text .line-bar {
        width: 18px;
        height: 2px;
        background: var(--accent);
        margin-bottom: 0.5rem;
      }
      .hero-graphic-text .cn-sub {
        font-size: 0.86rem;
        line-height: 1.45;
        color: #D4DCE8;
      }

      /* Horizontal Filter Tabs */
      .filter-tabs {
        display: flex;
        align-items: center;
        gap: 1.75rem;
        border-bottom: 1px solid var(--rule);
        margin-bottom: 1.75rem;
        padding-bottom: 0.1rem;
      }
      .filter-tabs a {
        color: var(--muted);
        font-size: 0.95rem;
        font-weight: 500;
        padding-bottom: 0.65rem;
        position: relative;
      }
      .filter-tabs a.active {
        color: var(--accent);
        font-weight: 600;
        border-bottom: 2px solid var(--accent);
        margin-bottom: -1px;
      }

      /* Stream Feed Cards */
      .stream .card {
        background: var(--card-bg);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 1.4rem;
        margin-bottom: 1.4rem;
        display: grid;
        grid-template-columns: 190px 1fr;
        gap: 1.6rem;
        transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
      }
      .stream .card:hover {
        border-color: var(--accent-line);
        box-shadow: 0 6px 22px rgba(0, 0, 0, 0.06);
      }
      .card-thumb {
        border-radius: 8px;
        overflow: hidden;
        background: var(--tag-bg);
        border: 1px solid var(--rule);
        display: flex;
        align-items: center;
        justify-content: center;
        height: 125px;
      }
      .card-thumb svg { width: 100%; height: 100%; }
      .card-content {
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      .card h2 {
        font-family: var(--title-font);
        font-size: 1.35rem;
        font-weight: 600;
        margin: 0.25rem 0 0.45rem;
        line-height: 1.35;
      }
      .card h2 a { color: var(--text); }
      .card h2 a:hover { color: var(--accent); text-decoration: none; }
      .card .desc {
        margin: 0 0 0.6rem;
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.6;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .badge-chip {
        display: inline-block;
        padding: 0.15rem 0.55rem;
        border-radius: 4px;
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        background: var(--accent-soft);
        color: var(--accent);
        margin-right: 0.5rem;
      }
      .meta-footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.65rem;
        font-size: 0.82rem;
        color: var(--muted);
        margin-top: 0.25rem;
      }
      .meta-tag {
        color: var(--faint);
      }
      .entry { margin: 0.45rem 0 0; font-size: 0.86rem; }

      /* Sidebar (Home) */
      .sidebar {
        display: flex;
        flex-direction: column;
        gap: 2rem;
      }
      .side-section {
        background: var(--card-bg);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 1.35rem;
      }
      .side-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.1rem;
      }
      .side-header .kicker { margin: 0; font-size: 0.9rem; color: var(--text); }
      .side-header .more-link {
        font-size: 0.78rem;
        color: var(--accent);
      }
      .topic-list {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .topic-card {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding: 0.65rem;
        border-radius: 8px;
        background: var(--tag-bg);
        transition: background 0.15s;
      }
      .topic-card:hover { background: var(--accent-soft); text-decoration: none; }
      .topic-icon-wrap {
        width: 44px;
        height: 44px;
        border-radius: 6px;
        overflow: hidden;
        flex-shrink: 0;
        background: #0E1217;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .topic-icon-wrap svg { width: 44px; height: 44px; }
      .topic-info h4 { margin: 0 0 0.2rem; font-size: 0.88rem; font-weight: 600; color: var(--text); }
      .topic-info p { margin: 0; font-size: 0.75rem; color: var(--muted); }

      .picks-list {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .pick-item {
        display: flex;
        gap: 0.85rem;
        padding-bottom: 0.85rem;
        border-bottom: 1px solid var(--rule);
      }
      .pick-item:last-child { border-bottom: 0; padding-bottom: 0; }
      .pick-num {
        font-family: var(--title-font);
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--accent);
        line-height: 1.2;
        width: 1.75rem;
        flex-shrink: 0;
      }
      .pick-content h2 {
        font-family: var(--title-font);
        font-size: 0.95rem;
        font-weight: 600;
        margin: 0 0 0.3rem;
        line-height: 1.35;
      }
      .pick-content h2 a { color: var(--text); }
      .pick-content h2 a:hover { color: var(--accent); }
      .pick-content .desc { margin: 0 0 0.3rem; font-size: 0.82rem; color: var(--muted); }
      .pick-content .meta { margin: 0; font-size: 0.75rem; color: var(--faint); }

      .slogan-card {
        background: linear-gradient(135deg, #101419 0%, #06080B 100%);
        border: 1px solid #202630;
        border-radius: 10px;
        padding: 1.75rem 1.4rem;
        color: #F0F4F8;
        position: relative;
        overflow: hidden;
      }
      .slogan-card svg {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 100%;
        height: 100%;
        opacity: 0.25;
        pointer-events: none;
      }
      .slogan-card h4 {
        margin: 0 0 0.75rem;
        font-family: var(--title-font);
        font-size: 1.05rem;
        line-height: 1.5;
        position: relative;
        z-index: 2;
      }
      .slogan-card .brand-mark {
        font-family: var(--title-font);
        font-size: 0.82rem;
        letter-spacing: 0.2em;
        color: var(--accent);
        position: relative;
        z-index: 2;
      }

      /* Reading 3-Column Layout */
      .reading {
        display: grid;
        grid-template-columns: 200px 310px minmax(0, 1fr);
        gap: 2rem;
        align-items: start;
      }
      .read-rail {
        position: sticky;
        top: 5rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .rail-header {
        padding: 0 0.5rem;
      }
      .rail-heading {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: var(--muted);
        text-transform: uppercase;
      }
      .rail-nav {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .rail-link {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.6rem 0.85rem;
        border-radius: 8px;
        font-size: 0.9rem;
        color: var(--text);
        font-weight: 500;
        transition: background 0.15s, color 0.15s;
      }
      .rail-link svg { width: 16px; height: 16px; stroke: currentColor; }
      .rail-link:hover { background: var(--tag-bg); color: var(--accent); text-decoration: none; }
      .rail-link.active {
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: 600;
      }
      .rail-link[aria-disabled="true"] { color: var(--faint); cursor: not-allowed; }
      .rail-promo-card {
        background: var(--panel);
        border: 1px solid var(--rule);
        border-radius: 8px;
        padding: 1.1rem;
        font-size: 0.8rem;
        line-height: 1.55;
        color: var(--muted);
      }
      .rail-promo-card strong {
        display: block;
        color: var(--accent);
        font-family: var(--title-font);
        letter-spacing: 0.15em;
        margin-bottom: 0.35rem;
      }

      /* Compact middle list */
      .list-compact {
        background: var(--card-bg);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }
      .list-compact-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid var(--rule);
        margin-bottom: 0.25rem;
      }
      .list-compact-header h3 { margin: 0; font-size: 0.95rem; font-weight: 600; }
      .count-badge {
        font-size: 0.75rem;
        color: var(--muted);
        background: var(--tag-bg);
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
      }
      .compact-card {
        display: flex;
        gap: 0.75rem;
        padding: 0.75rem;
        border-radius: 8px;
        border: 1px solid transparent;
        transition: background 0.15s, border-color 0.15s;
      }
      .compact-card:hover { background: var(--tag-bg); text-decoration: none; }
      .compact-card.current {
        background: var(--accent-soft);
        border-left: 3px solid var(--accent);
      }
      .compact-thumb {
        width: 50px;
        height: 50px;
        border-radius: 6px;
        overflow: hidden;
        flex-shrink: 0;
        background: var(--tag-bg);
      }
      .compact-thumb svg { width: 100%; height: 100%; }
      .compact-body { flex: 1; min-width: 0; }
      .compact-body h2 {
        font-family: var(--title-font);
        font-size: 0.88rem;
        font-weight: 600;
        margin: 0 0 0.25rem;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .compact-body h2 a { color: var(--text); }
      .compact-body .meta { font-size: 0.72rem; color: var(--muted); margin: 0; }

      /* Agent Detail Pane */
      .detail {
        background: var(--card-bg);
        border: 1px solid var(--rule);
        border-radius: 12px;
        padding: 2.5rem;
      }
      .breadcrumbs {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        font-size: 0.82rem;
        color: var(--muted);
        margin-bottom: 0.55rem;
      }
      .reading-exit {
        margin: 0 0 1.25rem;
        font-size: 0.82rem;
      }
      .back-to-list { color: var(--accent); font-weight: 600; }
      .detail-header {
        border-bottom: 1px solid var(--rule);
        padding-bottom: 1.5rem;
        margin-bottom: 1.75rem;
      }
      .detail-kicker-row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-bottom: 0.75rem;
        flex-wrap: wrap;
      }
      .version-tag {
        font-size: 0.75rem;
        color: var(--muted);
        background: var(--tag-bg);
        padding: 0.15rem 0.45rem;
        border-radius: 4px;
        border: 1px solid var(--rule);
      }
      .detail h1 {
        font-family: var(--title-font);
        font-size: clamp(2rem, 3.2vw, 2.75rem);
        font-weight: 700;
        line-height: 1.25;
        margin: 0 0 0.75rem;
      }
      .lead-paragraph {
        font-size: 1.05rem;
        line-height: 1.75;
        color: var(--muted);
        margin: 0;
      }

      /* Access and Connection Box */
      .access-box {
        background: var(--panel);
        border: 1px solid var(--accent-line);
        border-radius: 10px;
        padding: 1.5rem;
        margin: 1.75rem 0;
        box-shadow: 0 4px 16px rgba(74, 158, 255, 0.08);
      }
      .access-box-header {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        margin-bottom: 1.25rem;
      }
      .access-icon-wrap {
        width: 38px;
        height: 38px;
        border-radius: 8px;
        background: var(--accent-soft);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .access-icon-wrap svg {
        width: 20px;
        height: 20px;
        stroke: var(--accent);
      }
      .access-box-title {
        font-size: 1.05rem;
        font-weight: 700;
        margin: 0 0 0.25rem;
        color: var(--text);
      }
      .access-box-sub {
        font-size: 0.82rem;
        color: var(--muted);
        margin: 0;
        line-height: 1.5;
      }
      .access-box-body {
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
      }
      .entry-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        background: var(--tag-bg);
        border: 1px solid var(--rule);
        border-radius: 6px;
        font-size: 0.88rem;
        flex-wrap: wrap;
      }
      .entry-label {
        font-weight: 600;
        color: var(--text);
        flex-shrink: 0;
      }
      .entry-value {
        word-break: break-all;
        flex: 1;
      }
      .entry-value a {
        color: var(--accent);
        font-weight: 600;
      }
      .access-action-row {
        margin-top: 0.25rem;
      }
      .btn-access {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        background: var(--accent);
        color: #FFFFFF !important;
        padding: 0.6rem 1.25rem;
        border-radius: 6px;
        font-size: 0.88rem;
        font-weight: 600;
        text-decoration: none !important;
        transition: opacity 0.15s;
      }
      .btn-access:hover {
        opacity: 0.9;
      }
      .command-box {
        margin-top: 0.5rem;
      }
      .command-box-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted);
        margin-bottom: 0.35rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .code-snippet {
        background: #0E1217;
        color: #E6EDF3;
        border: 1px solid var(--rule);
        border-radius: 6px;
        padding: 0.85rem 1.1rem;
        margin: 0;
        font-family: ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
        font-size: 0.85rem;
        line-height: 1.5;
        overflow-x: auto;
      }
      .code-snippet code {
        background: transparent;
        padding: 0;
        border: 0;
        color: inherit;
      }

      /* Governance spec panel */
      .governance-panel {
        background: var(--tag-bg);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 1.5rem;
        margin-top: 2rem;
      }
      .panel-heading {
        font-size: 0.95rem;
        font-weight: 700;
        margin: 0 0 1rem;
        color: var(--text);
      }
      .gov-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem 1.5rem;
        margin: 0 0 1.25rem;
      }
      .gov-item dt {
        font-size: 0.75rem;
        color: var(--muted);
        margin-bottom: 0.25rem;
      }
      .gov-item dd {
        margin: 0;
        font-size: 0.88rem;
        font-weight: 500;
        color: var(--text);
      }
      .gov-trust-note {
        display: flex;
        align-items: flex-start;
        gap: 0.65rem;
        border-top: 1px solid var(--rule);
        padding-top: 1rem;
        font-size: 0.8rem;
        line-height: 1.55;
        color: var(--muted);
      }
      .shield-icon {
        font-size: 1rem;
        flex-shrink: 0;
      }
      .badge { color: var(--accent); font-weight: 600; }
      code {
        font-family: ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
        font-size: 0.86em;
        background: var(--panel);
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
        border: 1px solid var(--rule);
      }
      .empty { color: var(--muted); }

      @media (max-width: 1180px) {
        .reading { grid-template-columns: 260px minmax(0, 1fr); }
        .read-rail { display: none; }
        .hero { grid-template-columns: 1fr; }
      }
      @media (max-width: 850px) {
        .home, .reading { grid-template-columns: 1fr; }
        .sidebar { border-top: 1px solid var(--rule); padding-top: 1.5rem; }
        .stream .card { grid-template-columns: 1fr; }
        .card-thumb { height: 160px; }
        .topbar-right .search-box, .topbar-right .motto { display: none; }
      }
`;

export function parseTheme(raw: string | null): ThemeMode {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function parseChannel(raw: string | null): ChannelFilter {
  if (raw === "web" || raw === "cli" || raw === "mcp") return raw;
  return null;
}

export function renderMagazinePage(input: MagazinePageInput): string {
  const picks = input.picks ?? [];
  const selected = input.selected;
  const path = input.path ?? (selected ? `/s/${encodeURIComponent(selected.id)}` : "/");
  const hero = selected
    ? undefined
    : input.view.surfaces.find((item) => item.governanceState === "approved_public");
  const main = selected
    ? renderReading(input.view.surfaces, selected, input.theme, input.channel, input.q)
    : renderHome(input.view.surfaces, hero, input.theme, input.channel, input.q);
  const side = selected ? "" : renderSidebar(picks, input.theme, input.channel, path);
  const frameClass = selected ? "frame reading" : "frame home";
  return renderChrome({
    theme: input.theme,
    channel: input.channel,
    q: input.q,
    path,
    title: selected ? selected.name : "Portico",
    showInternal: input.showInternal === true,
    pendingPublic: input.pendingPublic,
    body: `<div class="${frameClass}">${main}${side}</div>`,
  });
}

export function renderNotFoundPage(theme: ThemeMode = "system"): string {
  return renderChrome({
    theme,
    channel: null,
    path: "/",
    title: "Portico",
    body: `<div class="frame"><p class="empty">没有这个入口，或你无权看见。</p></div>`,
  });
}

export function renderDiscoveryPage(view: DashboardView): string {
  return renderMagazinePage({ theme: "system", channel: null, view, picks: [] });
}

// `dashboardFrom` now lives in `../catalog/dashboard.ts`: it is derived purely
// from catalog records and the MCP entrance consumes it too.

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderChrome(input: {
  theme: ThemeMode;
  channel: ChannelFilter;
  q?: string;
  path: string;
  title: string;
  body: string;
  showInternal?: boolean;
  pendingPublic?: number;
}): string {
  const themeAttr = input.theme === "system" ? "" : ` data-theme="${input.theme}"`;
  const q = input.q;
  const contentHref = withQuery("/", input.theme, null, q);
  const topicHref = withQuery("/", input.theme, input.channel, q);
  const contentActive = input.channel === null ? " active" : "";
  const topicActive = input.channel !== null ? " active" : "";
  const internalLink = input.showInternal === true
    ? `\n        <a class="" href="/internal">内部笔记</a>`
    : "";
  const pendingLink = input.showInternal === true && input.pendingPublic !== undefined
    ? `\n        <a class="" href="/internal/pending">待审 ${input.pendingPublic}</a>`
    : "";
  // One-click human path: anonymous callers get the login entry, signed-in
  // callers jump straight to the pending list. Neither leaks /internal.
  const reviewLink = input.showInternal === true
    ? `\n        <a class="" href="/review">去审核</a>`
    : `\n        <a class="" href="/review/login">审核登录</a>`;
  return `<!DOCTYPE html>
<html lang="zh-CN"${themeAttr}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)} · Portico</title>
    <style>${MAGAZINE_CSS}
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="brand-wrap">
        <svg class="brand-logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <path d="M9 4v16"/>
          <path d="M14 9l3 3-3 3"/>
        </svg>
        <a class="brand" href="${escapeHtml(contentHref)}">PORTICO</a>
      </div>
      <nav class="nav">
        <a class="${contentActive.trim()}" href="${escapeHtml(contentHref)}">内容</a>
        <a class="${topicActive.trim()}" href="${escapeHtml(topicHref)}">专题</a>
        <a class="" href="/public">公开发布</a>${internalLink}${pendingLink}
        <span aria-disabled="true">收藏</span>
      </nav>
      <div class="topbar-right">
        ${reviewLink ? `<span class="review-entry">${reviewLink.trim()}</span>` : ""}
        <form class="search-box" method="get" action="/" role="search">
          ${
    input.theme === "system"
      ? ""
      : `<input type="hidden" name="theme" value="${escapeHtml(input.theme)}">`
  }
          ${
    input.channel ? `<input type="hidden" name="channel" value="${escapeHtml(input.channel)}">` : ""
  }
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input type="search" name="q" value="${
    escapeHtml(q ?? "")
  }" placeholder="搜索已授权入口" maxlength="120" aria-label="搜索已授权入口">
          <button type="submit">搜索</button>
        </form>
        <div class="motto">受控治理与发现<br>独立审批 · 客户端直连</div>
        <p class="themes">
          <a href="${escapeHtml(withQuery(input.path, "light", input.channel, q))}">日</a>
          <a href="${escapeHtml(withQuery(input.path, "dark", input.channel, q))}">夜</a>
          <a href="${escapeHtml(withQuery(input.path, "system", input.channel, q))}">自动</a>
        </p>
      </div>
    </header>
    ${input.body}
  </body>
</html>
`;
}

function renderHome(
  surfaces: AgentSurface[],
  hero: AgentSurface | undefined,
  theme: ThemeMode,
  channel: ChannelFilter,
  q?: string,
): string {
  const empty = surfaces.length === 0 ? `<p class="empty">没有可见的 Agent 表面。</p>` : "";
  const heroHtml = hero ? renderHero(hero, theme, channel) : "";
  const filterTabs = renderFilterTabs(theme, channel, "/", q);
  const cards = surfaces.map((surface, idx) => renderCard(surface, theme, channel, { index: idx }))
    .join("");
  return `<main>
      ${heroHtml}
      ${filterTabs}
      <section class="stream">${empty}${cards}</section>
    </main>`;
}

function renderFilterTabs(
  theme: ThemeMode,
  channel: ChannelFilter,
  path: string,
  q?: string,
): string {
  const items: Array<{ id: ChannelFilter; label: string }> = [
    { id: null, label: "全部" },
    { id: "web", label: "Web" },
    { id: "cli", label: "CLI" },
    { id: "mcp", label: "MCP" },
  ];
  const links = items.map((item) => {
    const href = withQuery(path.startsWith("/s/") ? path : "/", theme, item.id, q);
    const active = channel === item.id ? " active" : "";
    return `<a class="${active.trim()}" href="${escapeHtml(href)}">${item.label}</a>`;
  }).join("");
  return `<nav class="filter-tabs">${links}</nav>`;
}

function renderReading(
  surfaces: AgentSurface[],
  selected: AgentSurface,
  theme: ThemeMode,
  channel: ChannelFilter,
  q?: string,
): string {
  const contentHref = withQuery("/", theme, null, q);
  const crumbChannel = readingChannel(selected, channel);
  const crumbHref = withQuery("/", theme, crumbChannel, q);
  const cards = surfaces.map((surface, idx) =>
    renderCard(surface, theme, channel, { compact: true, currentId: selected.id, index: idx })
  ).join("");

  return `
    <!-- Column 1: Left Rail Navigation -->
    <aside class="read-rail">
      <div class="rail-header">
        <span class="rail-heading">服务渠道</span>
      </div>
      <nav class="rail-nav">
        <a class="rail-link${channel === null ? " active" : ""}" href="${
    escapeHtml(withQuery("/", theme, null, q))
  }">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          <span>全部服务</span>
        </a>
        <a class="rail-link${channel === "web" ? " active" : ""}" href="${
    escapeHtml(withQuery("/", theme, "web", q))
  }">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span>${escapeHtml(CHANNEL_LABEL.web)}</span>
        </a>
        <a class="rail-link${channel === "cli" ? " active" : ""}" href="${
    escapeHtml(withQuery("/", theme, "cli", q))
  }">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>
          <span>${escapeHtml(CHANNEL_LABEL.cli)}</span>
        </a>
        <a class="rail-link${channel === "mcp" ? " active" : ""}" href="${
    escapeHtml(withQuery("/", theme, "mcp", q))
  }">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          <span>${escapeHtml(CHANNEL_LABEL.mcp)}</span>
        </a>
      </nav>
      <div class="rail-promo-card">
        <strong>PORTICO</strong>
        <span>受控的 Agent 治理门户。Agent 在外部独立运行，此处仅做登记、发布、发现、授权与审计，不代理流量，不代跑 Agent。</span>
      </div>
    </aside>

    <!-- Column 2: Middle Stream List -->
    <section class="list-compact">
      <div class="list-compact-header">
        <h3>已登记服务</h3>
        <span class="count-badge">${surfaces.length} 个入口</span>
      </div>
      ${cards || `<p class="empty">没有可见的 Agent 表面。</p>`}
    </section>

    <!-- Column 3: Agent Detail Pane -->
    <article class="detail" data-surface="${escapeHtml(selected.id)}" data-governance="${
    escapeHtml(selected.governanceState)
  }">
      <nav class="breadcrumbs">
        <a href="${escapeHtml(contentHref)}">首页</a> &gt; <a href="${escapeHtml(crumbHref)}">${
    escapeHtml(CHANNEL_LABEL[crumbChannel])
  }</a> &gt; <span>${escapeHtml(selected.name)}</span>
      </nav>
      <p class="reading-exit"><a class="back-to-list" href="${
    escapeHtml(withQuery("/", theme, channel, q))
  }">返回列表</a></p>

      <div class="detail-header">
        <div class="detail-kicker-row">
          <span class="badge-chip">${escapeHtml(channelLabel(selected.channels))}</span>
          <span class="kicker">${governanceLabel(selected.governanceState)}</span>
          <span class="version-tag">v${escapeHtml(selected.version)}</span>
        </div>
        <h1>${escapeHtml(selected.name)}</h1>
        <p class="lead-paragraph">${escapeHtml(selected.description)}</p>
      </div>

      <!-- Access and Direct Connection Box -->
      ${renderAccessBox(selected)}

      <!-- Governance and Spec Box -->
      <div class="governance-panel">
        <h3 class="panel-heading">治理与审计规格</h3>
        <dl class="gov-grid">
          <div class="gov-item">
            <dt>标识 (ID)</dt>
            <dd><code>${escapeHtml(selected.id)}</code></dd>
          </div>
          <div class="gov-item">
            <dt>服务渠道</dt>
            <dd>${escapeHtml(channelLabel(selected.channels))}</dd>
          </div>
          <div class="gov-item">
            <dt>当前版本</dt>
            <dd>v${escapeHtml(selected.version)}</dd>
          </div>
          <div class="gov-item">
            <dt>维护主体</dt>
            <dd>${escapeHtml(byline(selected))}</dd>
          </div>
          <div class="gov-item">
            <dt>治理状态</dt>
            <dd>${governanceLabel(selected.governanceState)}</dd>
          </div>
          <div class="gov-item">
            <dt>连接模式</dt>
            <dd>客户端直连 (Direct)</dd>
          </div>
        </dl>
        <div class="gov-trust-note">
          <span class="shield-icon" aria-hidden="true">🛡️</span>
          <span><strong>信任边界保障：</strong>Portico 仅维护目录登记、授权状态与网关路由门卫，不代跑 Agent、不执行工具、不代理远程流量。公开入口经独立审批后方可对外暴露。</span>
        </div>
      </div>
    </article>`;
}

function renderAccessBox(selected: AgentSurface): string {
  const kind = selected.entry.kind;
  const val = selected.entry.value;

  if (kind === "url") {
    const isHttp = isDirectHttpHref(val);
    return `
      <div class="access-box">
        <div class="access-box-header">
          <div class="access-icon-wrap web">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <div>
            <h3 class="access-box-title">接入方式 · 外部 Web 页面</h3>
            <p class="access-box-sub">已授权的直连 Web 入口。由客户端直接访问，Portico 不代理页面与请求。</p>
          </div>
        </div>
        <div class="access-box-body">
          <div class="entry-row">
            <span class="entry-label">访问地址：</span>
            <div class="entry-value">${renderEntry(kind, val)}</div>
          </div>
          ${
      isHttp
        ? `<div class="access-action-row">
            <a href="${
          escapeHtml(val)
        }" target="_blank" rel="noopener noreferrer" class="btn-access">
              访问外部入口 ↗
            </a>
          </div>`
        : ""
    }
        </div>
      </div>`;
  }

  if (kind === "package") {
    return `
      <div class="access-box">
        <div class="access-box-header">
          <div class="access-icon-wrap cli">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>
          </div>
          <div>
            <h3 class="access-box-title">接入方式 · 命令行包坐标</h3>
            <p class="access-box-sub">受治理的分发包坐标。Portico 不代为安装或执行，请在本地通过包管理器调用。</p>
          </div>
        </div>
        <div class="access-box-body">
          <div class="entry-row">
            <span class="entry-label">包坐标：</span>
            <div class="entry-value">${renderEntry(kind, val)}</div>
          </div>
          <div class="command-box">
            <div class="command-box-label">快速调用命令</div>
            <pre class="code-snippet"><code>${renderCliCommand(val)}</code></pre>
          </div>
        </div>
      </div>`;
  }

  if (kind === "mcp_endpoint") {
    return `
      <div class="access-box">
        <div class="access-box-header">
          <div class="access-icon-wrap mcp">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          </div>
          <div>
            <h3 class="access-box-title">接入方式 · MCP 服务端点</h3>
            <p class="access-box-sub">受控的 Model Context Protocol 端点。Portico 提供身份鉴权与路由门卫，客户端直连调用。</p>
          </div>
        </div>
        <div class="access-box-body">
          <div class="entry-row">
            <span class="entry-label">服务端点：</span>
            <div class="entry-value">${renderEntry(kind, val)}</div>
          </div>
          <div class="command-box">
            <div class="command-box-label">客户端配置示例 (claude_desktop_config.json)</div>
            <pre class="code-snippet"><code>${renderMcpConfigSnippet(selected.id, val)}</code></pre>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="access-box">
      <div class="access-box-header">
        <div>
          <h3 class="access-box-title">接入方式 · 登记入口</h3>
          <p class="access-box-sub">Portico 登记的授权访问信息。</p>
        </div>
      </div>
      <div class="access-box-body">
        <div class="entry-row">
          <span class="entry-label">入口：</span>
          <div class="entry-value">${renderEntry(kind, val)}</div>
        </div>
      </div>
    </div>`;
}

function renderCliCommand(pkg: string): string {
  if (pkg.startsWith("jsr:")) {
    return escapeHtml(`deno run -A ${pkg}`);
  }
  if (pkg.startsWith("npm:")) {
    return escapeHtml(`npx ${pkg.slice(4)}`);
  }
  return escapeHtml(`# 运行包: ${pkg}`);
}

function renderMcpConfigSnippet(id: string, endpoint: string): string {
  const config = JSON.stringify(
    {
      mcpServers: {
        [id]: {
          url: endpoint,
        },
      },
    },
    null,
    2,
  );
  return escapeHtml(config);
}

function renderSidebar(
  picks: MagazinePick[],
  theme: ThemeMode,
  channel: ChannelFilter,
  _path: string,
): string {
  const pickHtml = picks.map((pick, index) => {
    const href = withQuery(`/s/${encodeURIComponent(pick.id)}`, theme, channel);
    const num = (index + 1).toString().padStart(2, "0");
    return `        <article class="pick-item" data-kind="catalog_card" data-id="${
      escapeHtml(pick.id)
    }" data-governance="${escapeHtml(pick.governanceState)}">
          <span class="pick-num">${num}</span>
          <div class="pick-content">
            <h2><a href="${escapeHtml(href)}">${escapeHtml(pick.name)}</a></h2>
            <p class="desc">${escapeHtml(pick.description)}</p>
            <p class="meta">${governanceLabel(pick.governanceState)} · ${
      escapeHtml(pick.version)
    }</p>
          </div>
        </article>`;
  }).join("");

  return `<aside class="sidebar">
      <!-- Section 1: 接入渠道 -->
      <section class="side-section">
        <div class="side-header">
          <h3 class="kicker">接入渠道</h3>
          <a class="more-link" href="${escapeHtml(withQuery("/", theme, null))}">全部服务 →</a>
        </div>
        <div class="topic-list">
          <a class="topic-card" href="${escapeHtml(withQuery("/", theme, "web"))}">
            <div class="topic-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="#4A9EFF" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            </div>
            <div class="topic-info">
              <h4>${escapeHtml(CHANNEL_LABEL.web)}</h4>
              <p>直连网页端点，不代理流量</p>
            </div>
          </a>
          <a class="topic-card" href="${escapeHtml(withQuery("/", theme, "cli"))}">
            <div class="topic-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="#4A9EFF" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>
            </div>
            <div class="topic-info">
              <h4>${escapeHtml(CHANNEL_LABEL.cli)}</h4>
              <p>受控包坐标 (jsr/npm)，本地运行</p>
            </div>
          </a>
          <a class="topic-card" href="${escapeHtml(withQuery("/", theme, "mcp"))}">
            <div class="topic-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="#4A9EFF" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            </div>
            <div class="topic-info">
              <h4>${escapeHtml(CHANNEL_LABEL.mcp)}</h4>
              <p>Model Context Protocol 发现与端点</p>
            </div>
          </a>
        </div>
      </section>

      <!-- Section 2: 推荐入口 -->
      <section class="side-section picks">
        <div class="side-header">
          <h3 class="kicker">推荐入口</h3>
        </div>
        <div class="picks-list">
          ${pickHtml || `<p class="empty">暂无推荐。</p>`}
        </div>
      </section>

      <!-- Section 3: 治理原则 -->
      <div class="slogan-card">
        <svg viewBox="0 0 200 120" fill="none">
          <path d="M0 120L60 40L110 85L160 20L220 120Z" fill="#1C2430"/>
        </svg>
        <h4>Agent 门户与治理层</h4>
        <p style="margin: 0 0 0.75rem; font-size: 0.8rem; color: #8A9099; position: relative; z-index: 2;">只做登记、发布、发现、授权与审计。公开须经独立审批，不代跑 Agent，不代理流量。</p>
        <span class="brand-mark">PORTICO</span>
      </div>
    </aside>`;
}

function renderHero(surface: AgentSurface, theme: ThemeMode, channel: ChannelFilter): string {
  const href = withQuery(`/s/${encodeURIComponent(surface.id)}`, theme, channel);
  return `<section class="hero" data-hero data-id="${escapeHtml(surface.id)}" data-governance="${
    escapeHtml(surface.governanceState)
  }">
        <div class="hero-content">
          <p class="kicker">推荐服务 / ${escapeHtml(channelLabel(surface.channels))} · ${
    governanceLabel(surface.governanceState)
  }</p>
          <h1 class="hero-title"><a href="${escapeHtml(href)}">${escapeHtml(surface.name)}</a></h1>
          <p class="desc hero-desc">${escapeHtml(surface.description)}</p>
          <div class="hero-meta">
            <span class="byline">维护者: ${escapeHtml(byline(surface))}</span>
            <span>·</span>
            <span>v${escapeHtml(surface.version)}</span>
            <span class="meta-tag">#${escapeHtml(surface.channels[0] ?? "agent")}</span>
          </div>
        </div>
        <div class="hero-graphic-card">
          <svg viewBox="0 0 160 160" fill="none">
            <!-- Isometric Stairs / Blocks -->
            <polygon points="80,20 130,48 80,76 30,48" stroke="#4A9EFF" stroke-width="1.8" fill="#152238"/>
            <polygon points="30,48 80,76 80,130 30,102" stroke="#3B82F6" stroke-width="1.5" fill="#0C1524"/>
            <polygon points="80,76 130,48 130,102 80,130" stroke="#1D4ED8" stroke-width="1.5" fill="#080F1B"/>
            <polygon points="55,34 95,56 70,70 30,48" stroke="#60A5FA" stroke-width="1" fill="#1E3A8A" opacity="0.6"/>
          </svg>
          <div class="hero-graphic-text">
            <span class="en-sub">AGENT GOVERNANCE PORTAL</span>
            <div class="line-bar"></div>
            <span class="cn-sub">受控接入与安全治理<br>直连端点 · 独立审批</span>
          </div>
        </div>
      </section>`;
}

function renderCard(
  surface: AgentSurface,
  theme: ThemeMode,
  channel: ChannelFilter,
  opts: { compact?: boolean; currentId?: string; index?: number } = {},
): string {
  const href = withQuery(`/s/${encodeURIComponent(surface.id)}`, theme, channel);
  const current = opts.currentId === surface.id ? " current" : "";

  if (opts.compact) {
    return `
      <a class="compact-card${current}" href="${escapeHtml(href)}" data-id="${
      escapeHtml(surface.id)
    }" data-governance="${escapeHtml(surface.governanceState)}">
        <div class="compact-thumb">
          ${renderThumbnailSvg(surface.channels, opts.index ?? 0, true)}
        </div>
        <div class="compact-body">
          <h2>${escapeHtml(surface.name)}</h2>
          <p class="meta">${escapeHtml(channelLabel(surface.channels))} · v${
      escapeHtml(surface.version)
    } · <code>${escapeHtml(surface.id)}</code></p>
        </div>
      </a>`;
  }

  const entry = `<p class="entry">${renderEntry(surface.entry.kind, surface.entry.value)}</p>`;
  const primaryChannel = surface.channels[0] ?? "cli";
  const channelBadgeLabel = primaryChannel === "cli"
    ? "CLI"
    : primaryChannel === "mcp"
    ? "MCP"
    : "Web";

  return `
        <article class="card${current}" data-id="${escapeHtml(surface.id)}" data-governance="${
    escapeHtml(surface.governanceState)
  }" data-channels="${escapeHtml(surface.channels.join(","))}">
          <div class="card-thumb">
            ${renderThumbnailSvg(surface.channels, opts.index ?? 0, false)}
          </div>
          <div class="card-content">
            <div class="card-kicker-row">
              <span class="badge-chip">${escapeHtml(channelBadgeLabel)}</span>
              <span class="kicker">${governanceLabel(surface.governanceState)}</span>
            </div>
            <h2><a href="${escapeHtml(href)}">${escapeHtml(surface.name)}</a></h2>
            <p class="desc">${escapeHtml(surface.description)}</p>
            <div class="meta-footer">
              <span class="byline">${escapeHtml(byline(surface))}</span>
              <span>·</span>
              <span>v${escapeHtml(surface.version)}</span>
              <span class="meta-tag">#${escapeHtml(primaryChannel)}</span>
              <span class="meta-tag">#Agent</span>
            </div>
            ${entry}
          </div>
        </article>`;
}

function renderThumbnailSvg(channels: Channel[], index: number, compact: boolean): string {
  const mod = index % 3;
  if (channels.includes("cli") || mod === 0) {
    // CLI / Terminal window illustration
    return `
      <svg viewBox="0 0 190 125" fill="none" style="background:#0D1117;">
        <rect x="0" y="0" width="190" height="22" fill="#161B22"/>
        <circle cx="12" cy="11" r="3" fill="#FF5F56"/>
        <circle cx="22" cy="11" r="3" fill="#FFBD2E"/>
        <circle cx="32" cy="11" r="3" fill="#27C93F"/>
        <text x="14" y="52" fill="#4A9EFF" font-family="ui-monospace, monospace" font-size="12" font-weight="bold">&gt;_</text>
        <rect x="36" y="42" width="60" height="12" rx="2" fill="#21262D"/>
        <rect x="14" y="68" width="110" height="8" rx="2" fill="#21262D"/>
        <rect x="14" y="84" width="80" height="8" rx="2" fill="#1C2128"/>
        ${
      compact
        ? ""
        : '<text x="14" y="112" fill="#58A6FF" font-family="sans-serif" font-size="9" opacity="0.8">CLI PACKAGE</text>'
    }
      </svg>`;
  }
  if (channels.includes("mcp") || mod === 1) {
    // Data visualization / Bar chart illustration
    return `
      <svg viewBox="0 0 190 125" fill="none" style="background:#0B1015;">
        <line x1="20" y1="100" x2="170" y2="100" stroke="#21262D" stroke-width="1"/>
        <rect x="30" y="55" width="12" height="45" rx="2" fill="#3B82F6"/>
        <rect x="46" y="40" width="12" height="60" rx="2" fill="#60A5FA"/>
        <rect x="70" y="65" width="12" height="35" rx="2" fill="#3B82F6"/>
        <rect x="86" y="30" width="12" height="70" rx="2" fill="#4A9EFF"/>
        <rect x="110" y="50" width="12" height="50" rx="2" fill="#3B82F6"/>
        <rect x="126" y="20" width="12" height="80" rx="2" fill="#93C5FD"/>
        <circle cx="150" cy="40" r="14" stroke="#4A9EFF" stroke-width="1.5" stroke-dasharray="3 3"/>
      </svg>`;
  }
  // Web / Network Globe illustration
  return `
    <svg viewBox="0 0 190 125" fill="none" style="background:#0A0E14;">
      <circle cx="95" cy="62" r="42" stroke="#2563EB" stroke-width="1.2" opacity="0.5"/>
      <ellipse cx="95" cy="62" rx="42" ry="18" stroke="#4A9EFF" stroke-width="1.2" opacity="0.7"/>
      <ellipse cx="95" cy="62" rx="18" ry="42" stroke="#38BDF8" stroke-width="1.2" opacity="0.7"/>
      <circle cx="85" cy="52" r="3" fill="#60A5FA"/>
      <circle cx="115" cy="70" r="3" fill="#38BDF8"/>
      <line x1="85" y1="52" x2="115" y2="70" stroke="#93C5FD" stroke-width="1" opacity="0.8"/>
    </svg>`;
}

function governanceLabel(state: string): string {
  if (state === "approved_public") return `<span class="badge">已公开</span> · 人工审核`;
  if (state === "pending_public") return "待审";
  if (state === "internal") return "内部";
  if (state === "draft") return "草稿";
  if (state === "rejected") return "已拒";
  return escapeHtml(state);
}

function readingChannel(selected: AgentSurface, channel: ChannelFilter): Channel {
  if (channel && selected.channels.includes(channel)) return channel;
  return selected.channels[0] ?? "web";
}

function channelLabel(channels: string[]): string {
  return channels.map((item) => CHANNEL_LABEL[item as Channel] ?? item).join(" · ");
}

function byline(surface: AgentSurface): string {
  const lead = surface.maintainers[0];
  return lead ? lead.id : "";
}

function renderEntry(kind: string, value: string): string {
  const safe = escapeHtml(value);
  if (kind === "url" && isDirectHttpHref(value)) {
    return `<a href="${safe}" rel="noopener noreferrer">${safe}</a>`;
  }
  return `<code>${escapeHtml(kind)}: ${safe}</code>`;
}

function isDirectHttpHref(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function queryOf(
  theme: ThemeMode,
  channel: ChannelFilter,
  q?: string,
): URLSearchParams {
  const params = new URLSearchParams();
  if (theme !== "system") params.set("theme", theme);
  if (channel) params.set("channel", channel);
  if (q) params.set("q", q);
  return params;
}

function withQuery(
  path: string,
  theme: ThemeMode,
  channel: ChannelFilter,
  q?: string,
): string {
  const query = queryOf(theme, channel, q).toString();
  return query ? `${path}?${query}` : path;
}
