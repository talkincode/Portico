import { CatalogError, ErrorCode } from "../catalog/errors.ts";

/**
 * The cutoff of a historical question: "what stood as of *this* instant".
 *
 * A cutoff is the one part of such a question the machine cannot supply, so it
 * is also the one part it must not guess. Accepting a bare day (`2026-09-21`)
 * or a wall clock without a zone (`2026-09-21T12:00:00`) would mean silently
 * choosing a zone and answering a slightly different question than the one
 * asked — the reader cannot tell such an answer apart from an answer to a
 * question nobody asked. That is the same failure the standing view refuses
 * when it separates "flagged and later cleared" from "still flagged", and the
 * same reason a rejected cutoff is an error rather than a quiet fallback to
 * "now": a wrong window is worse than a refusal, because it looks like an
 * answer.
 *
 * The grammar is deliberately the one the trail itself writes — a date, a time
 * and an explicit zone — and every accepted value is returned in that single
 * canonical form, so a cutoff and a record timestamp compare as instants
 * instead of as strings.
 */

/** `<date>T<time>Z` is 20 characters, with an offset and millis at most 29. */
export const AS_OF_MAX_LENGTH = 32;

const AS_OF =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const GRAMMAR = "an instant like 2026-09-21T12:00:00Z (date, time and zone)";

/**
 * Parse the cutoff of a time-sliced read, or `undefined` when none was given.
 *
 * `undefined`, `null` and an empty string mean "no cutoff" — the same way every
 * other optional filter in this repository treats an empty value, so a caller
 * that passes through an unset form field does not get a refusal. Anything else
 * must be a real instant: a rollover such as `2026-02-30` is refused rather
 * than moved to another day, because the caller would never see that it was.
 */
export function parseAsOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `as-of must be ${GRAMMAR}`);
  }
  const raw = value.trim();
  if (raw === "") return undefined;
  if (raw.length > AS_OF_MAX_LENGTH) {
    throw new CatalogError(
      ErrorCode.INVALID_INPUT,
      `as-of must be at most ${AS_OF_MAX_LENGTH} characters — ${GRAMMAR}`,
    );
  }
  const match = AS_OF.exec(raw);
  if (!match) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `as-of must be ${GRAMMAR}`);
  }

  const [, year, month, day, hour, minute, second, fraction, sign, offsetHour, offsetMinute] =
    match;
  const parts = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second ?? "0"),
    millis: Number((fraction ?? "").padEnd(3, "0") || "0"),
  };

  // What the regex accepts as digits is not automatically a real date: month
  // 13, day 30 of February and second 61 are all well-formed nonsense, and the
  // engine would rather roll them over than complain.
  if (parts.month < 1 || parts.month > 12) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `as-of must be ${GRAMMAR}`);
  }
  if (parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `as-of must be ${GRAMMAR}`);
  }
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    throw new CatalogError(ErrorCode.INVALID_INPUT, `as-of must be ${GRAMMAR}`);
  }

  let offset = 0;
  if (sign) {
    const hours = Number(offsetHour);
    const minutes = Number(offsetMinute);
    if (hours > 23 || minutes > 59) {
      throw new CatalogError(ErrorCode.INVALID_INPUT, `as-of must be ${GRAMMAR}`);
    }
    // `+08:00` means the wall clock shown is eight hours ahead of UTC, so the
    // instant is eight hours earlier than the same wall clock read as UTC.
    offset = (sign === "-" ? -1 : 1) * (hours * 60 + minutes);
  }

  // Built field by field rather than through `Date.parse`: the caller's zone
  // never enters into it, and a four-digit year such as 0050 is that year and
  // not 1950.
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millis);
  const instant = new Date(date.getTime() - offset * 60_000);
  const canonical = instant.toISOString();
  if (canonical.length !== 24) {
    // Four-digit signed years only: outside them `toISOString` switches to an
    // expanded form that is no longer the shape a record carries.
    throw new CatalogError(ErrorCode.INVALID_INPUT, `as-of must be ${GRAMMAR}`);
  }
  return canonical;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Whether a record stamped `at` belongs in a window that ends at `cutoff`.
 *
 * Inclusive at the cutoff: a conclusion recorded exactly when the question was
 * asked stands at that moment. A record whose timestamp cannot be read at all
 * is *not* in any window — it cannot be placed on a timeline, and guessing a
 * place for it would be the same silent substitution the grammar above
 * refuses. It stays visible in the unsliced view, and tampering with the file
 * is what the seal verdict beside it is for.
 */
export function withinAsOf(at: string, cutoff: string | undefined): boolean {
  if (cutoff === undefined) return true;
  const atMs = Date.parse(at);
  if (Number.isNaN(atMs)) return false;
  return atMs <= Date.parse(cutoff);
}
