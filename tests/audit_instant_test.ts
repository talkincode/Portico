import { assertEquals, assertRejectsCode } from "./assert.ts";
import { parseAsOf } from "../src/audit/instant.ts";

/**
 * A cutoff is the one part of a historical question the machine cannot guess.
 *
 * Every record in this repository is stamped with `new Date().toISOString()`,
 * so a cutoff has one canonical form. Accepting a *day* or a *local wall clock*
 * would mean silently picking a zone and answering a different question than
 * the one asked — the same failure mode as rendering a cleared flag as current:
 * the reader cannot tell the answer apart from the question it did not ask.
 * These tests pin the grammar, and pin that a rejected cutoff is never
 * quietly reinterpreted as "now".
 */

function rejected(value: unknown): Promise<Error> {
  return assertRejectsCode(() => Promise.resolve(parseAsOf(value)), "INVALID_INPUT");
}

Deno.test("no cutoff means no cutoff", () => {
  assertEquals(parseAsOf(undefined), undefined);
  assertEquals(parseAsOf(null), undefined);
});

Deno.test("a cutoff must name an instant, not a day and not a wall clock", async () => {
  // A day is a range, not an instant: which midnight, in which zone?
  await rejected("2026-09-21");
  // No zone means the answer depends on the machine that happens to run it.
  await rejected("2026-09-21T12:00:00");
  await rejected("2026-09-21 12:00:00Z");
  await rejected("2026-09-21T12:00:00+0800");
  await rejected("2026-09-21T12:00:00z");
  await rejected("now");
  await rejected("yesterday");
  await rejected("2026-09-21T12:00:00Z extra");
});

Deno.test("a cutoff must be a real instant, not a rollover", async () => {
  // `Date.parse` rolls these over; a cutoff must not silently become another
  // day, because the reader would have no way to notice.
  await rejected("2026-02-30T00:00:00Z");
  await rejected("2025-02-29T00:00:00Z");
  await rejected("2026-04-31T00:00:00Z");
  await rejected("2026-13-01T00:00:00Z");
  await rejected("2026-00-10T00:00:00Z");
  await rejected("2026-09-00T00:00:00Z");
  await rejected("2026-09-21T24:00:00Z");
  await rejected("2026-09-21T12:60:00Z");
  await rejected("2026-09-21T12:00:61Z");
  await rejected("2026-09-21T12:00:00+24:00");
  await rejected("2026-09-21T12:00:00+08:60");
});

Deno.test("a cutoff is refused as input, not reinterpreted", async () => {
  await rejected(1_789_000_000_000);
  await rejected({});
  await rejected(true);
  // An interior control character cannot be smuggled into an instant. Padding
  // is trimmed like every other filter value, so it is not a rejection case.
  await rejected("2026-09-21T12:00:00\u0000Z");
  await rejected("2026-09\t21T12:00:00Z");
  await rejected("2026-09-21T12:00:00.0001Z");
  await rejected("2026-09-21T12:00:00.Z");
  // Over the accepted length: refused as input, not truncated into an instant.
  await rejected("2026-09-21T12:00:00Z".padEnd(48, "0"));
  await rejected("x".repeat(64));
});

Deno.test("any accepted cutoff is named the same way a record is", () => {
  // One canonical form, the one the trail writes, so a cutoff and a record
  // timestamp compare as the instants they are.
  assertEquals(parseAsOf("2026-09-21T12:00:00Z"), "2026-09-21T12:00:00.000Z");
  assertEquals(parseAsOf("2026-09-21T12:00:00.000Z"), "2026-09-21T12:00:00.000Z");
  assertEquals(parseAsOf("2026-09-21T12:00Z"), "2026-09-21T12:00:00.000Z");
  assertEquals(parseAsOf("2026-09-21T12:00:00.5Z"), "2026-09-21T12:00:00.500Z");
  assertEquals(parseAsOf("2026-09-21T20:00:00+08:00"), "2026-09-21T12:00:00.000Z");
  assertEquals(parseAsOf("2026-09-21T04:00:00-08:00"), "2026-09-21T12:00:00.000Z");
  assertEquals(parseAsOf(" 2026-09-21T12:00:00Z "), "2026-09-21T12:00:00.000Z");
  assertEquals(parseAsOf("2026-09-21T12:00:00Z\n"), "2026-09-21T12:00:00.000Z");
  // A leap day is real in a leap year, and only in a leap year.
  assertEquals(parseAsOf("2024-02-29T23:59:59.999Z"), "2024-02-29T23:59:59.999Z");
  assertEquals(parseAsOf("2100-02-28T00:00:00Z"), "2100-02-28T00:00:00.000Z");
});
