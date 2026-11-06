// Reporting periods for exports: an inclusive range of posted_date values (YYYY-MM-DD).
// Pure helpers, shared by the Worker (validation, SQL bounds) and the browser (labels, filenames).
import { isValidDate, isValidMonth, TIME_ZONE } from "./dates";

export interface Period {
  /** First posted_date included (YYYY-MM-DD). */
  start: string;
  /** Last posted_date included (YYYY-MM-DD). */
  end: string;
}

/** A period chosen as a whole month keeps its month, so legacy month URLs and filenames stay the same. */
export type ExportPeriod = { kind: "month"; month: string } | { kind: "range"; start: string; end: string };

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, "0")}`;
}

export function monthPeriod(month: string): Period {
  return { start: `${month}-01`, end: lastDayOfMonth(month) };
}

export function toPeriod(p: ExportPeriod): Period {
  return p.kind === "month" ? monthPeriod(p.month) : { start: p.start, end: p.end };
}

/** Why a start/end pair is not usable, or null when it is. Never swaps or normalizes the dates. */
export function periodError(start: string, end: string): string | null {
  if (!start || !end) return "Choose both a start date and an end date.";
  if (!isValidDate(start)) return "The start date is not a real calendar date.";
  if (!isValidDate(end)) return "The end date is not a real calendar date.";
  if (end < start) return "The end date is before the start date.";
  return null;
}

/**
 * Reads the period from export query parameters. Exactly one form is allowed:
 * `month=YYYY-MM`, or `start=YYYY-MM-DD&end=YYYY-MM-DD` (inclusive). Anything else is rejected.
 */
export function parsePeriodParams(sp: URLSearchParams): { ok: true; period: ExportPeriod } | { ok: false; error: string } {
  const months = sp.getAll("month");
  const starts = sp.getAll("start");
  const ends = sp.getAll("end");
  if (months.length > 1 || starts.length > 1 || ends.length > 1) return { ok: false, error: "Each date parameter may only be given once." };
  const hasRange = starts.length > 0 || ends.length > 0;
  if (months.length && hasRange) return { ok: false, error: "Give either month or start and end, not both." };
  if (months.length) {
    return isValidMonth(months[0]) ? { ok: true, period: { kind: "month", month: months[0] } } : { ok: false, error: "month must be YYYY-MM" };
  }
  if (!hasRange) return { ok: false, error: "Give month=YYYY-MM or start=YYYY-MM-DD and end=YYYY-MM-DD." };
  const err = periodError(starts[0] ?? "", ends[0] ?? "");
  if (err) return { ok: false, error: err };
  return { ok: true, period: { kind: "range", start: starts[0], end: ends[0] } };
}

/** Query string for an export request (no leading "?"). */
export function periodQuery(p: ExportPeriod): string {
  return p.kind === "month" ? `month=${p.month}` : `start=${p.start}&end=${p.end}`;
}

/** Filename part: `2026-10` for a month, `2026-10-15_to_2026-11-05` for a custom range. */
export function periodSlug(p: ExportPeriod): string {
  return p.kind === "month" ? p.month : `${p.start}_to_${p.end}`;
}

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const name = (month: "long" | "short") => dt.toLocaleString("en-US", { month, timeZone: "UTC" });
  return { y, m, d, long: name("long"), short: name("short") };
}

/** True when the period is exactly one whole calendar month. */
export function isWholeMonth(p: Period): boolean {
  return p.start.endsWith("-01") && p.end === lastDayOfMonth(p.start.slice(0, 7));
}

/**
 * Human-readable period: "October 2026", "October 3, 2026", "October 3–17, 2026",
 * "October 15 – November 5, 2026", "December 15, 2026 – January 5, 2027".
 * Works on the date strings directly, so a date never drifts across a time zone.
 */
export function periodTitle(p: Period): string {
  const a = parts(p.start);
  const b = parts(p.end);
  if (isWholeMonth(p)) return `${a.long} ${a.y}`;
  if (p.start === p.end) return `${a.long} ${a.d}, ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.long} ${a.d}–${b.d}, ${a.y}`;
  if (a.y === b.y) return `${a.long} ${a.d} – ${b.long} ${b.d}, ${a.y}`;
  return `${a.long} ${a.d}, ${a.y} – ${b.long} ${b.d}, ${b.y}`;
}

/** Short inclusive range: "Oct 1 – Oct 31, 2026" or "Dec 15, 2026 – Jan 5, 2027". */
export function periodRangeShort(p: Period): string {
  const a = parts(p.start);
  const b = parts(p.end);
  if (a.y === b.y) return `${a.short} ${a.d} – ${b.short} ${b.d}, ${a.y}`;
  return `${a.short} ${a.d}, ${a.y} – ${b.short} ${b.d}, ${b.y}`;
}

/** Report date column: "Oct 3, 2026". */
export function shortDate(date: string): string {
  const a = parts(date);
  return `${a.short} ${a.d}, ${a.y}`;
}

/** Generation stamp in America/Denver, e.g. "November 6, 2026 at 2:15 PM MST". */
export function formatGeneratedAt(now: Date): string {
  const date = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "long", day: "numeric", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(now);
  return `${date} at ${time}`;
}
