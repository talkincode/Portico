/**
 * Types shared by the render layer.
 *
 * Kept apart from `page.ts` so view modules can consume them without importing
 * the shell (which imports the view stylesheets) and creating a cycle.
 */

import type { Theme } from "../tokens.ts";

/** The `?theme=` value exactly as it arrived, or `null` when absent. */
export type ThemeRequestValue = string | null;

export interface PageTheme {
  /** Resolved colours actually painted by this response. */
  theme: Theme;
  /** The reader's request, retained so the switch can show what was asked for. */
  request: ThemeRequestValue;
}
