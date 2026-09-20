/**
 * Which Review entrance this deployment actually serves.
 *
 * The Portal is a discovery surface, so it may only advertise an entrance that
 * exists. The reference deployment reverse-proxies `/review*` to the Review
 * process on the same origin; a deployment that ships only the read-only
 * entrances has no Review behind it and must not link to one. The deployment
 * declares which of those it is — the Portal never probes for it, because a
 * discovery page that guesses is a discovery page that lies.
 *
 * `PORTICO_REVIEW_ORIGIN`:
 *   - unset or empty → same origin (`/review`, `/review/login`): the default,
 *     and what a reverse-proxied deployment wants.
 *   - `off` → this deployment serves no Review entrance; no link anywhere.
 *   - an absolute `http(s)` origin → that origin, for a Review process on
 *     another host. A path is kept (`https://host/review`), a trailing slash
 *     is dropped.
 *   - anything else → no link. Fail closed: a typo hides the entry instead of
 *     publishing a link this deployment cannot stand behind.
 */

export type ReviewEntry =
  | { kind: "same-origin" }
  | { kind: "origin"; origin: string }
  | { kind: "none" };

const OFF = "off";

export function parseReviewEntry(env: Record<string, string | undefined>): ReviewEntry {
  const raw = env.PORTICO_REVIEW_ORIGIN?.trim() ?? "";
  if (raw === "") return { kind: "same-origin" };
  if (raw.toLowerCase() === OFF) return { kind: "none" };
  const origin = absoluteOrigin(raw);
  return origin ? { kind: "origin", origin } : { kind: "none" };
}

/** Only a bare absolute origin is accepted; credentials and query parts are not. */
function absoluteOrigin(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * The entry href for one caller, or `undefined` when this deployment serves no
 * Review entrance. Signed-in humans land on the queue; everyone else gets the
 * login entry first. `entry` absent means the field was not threaded through,
 * which keeps the same-origin default.
 */
export function reviewHref(
  entry: ReviewEntry | undefined,
  signedIn: boolean,
): string | undefined {
  const base = entry === undefined || entry.kind === "same-origin"
    ? "/review"
    : entry.kind === "origin"
    ? entry.origin
    : undefined;
  if (base === undefined) return undefined;
  return signedIn ? base : `${base}/login`;
}

/** True when this deployment advertises a Review entrance at all. */
export function reviewEntryVisible(entry: ReviewEntry | undefined): boolean {
  return reviewHref(entry, true) !== undefined;
}
