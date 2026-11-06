// The PDF report's data model. Pure: no I/O, no React, so it is unit-tested.
//
// Two naming conventions are used on purpose, matching the rest of the app:
//  - Employee summary: CURRENT employee and department names (from the directory, grouped by
//    employee id), exactly like the totals CSV and the dashboard leaderboard.
//  - Department subtotals and the review log: the HISTORICAL snapshots saved on each mention,
//    so past credit stays with the department it was recorded under.
// Money is integer cents end to end. Nothing here recalculates a spiff: every amount is a saved one.
import type { EmployeeTotal } from "./dashboard";
import type { Period } from "./period";

export interface ReportMention {
  id: number;
  employee_id: number;
  employee_name_snapshot: string;
  department_name_snapshot: string;
  amount_cents: number;
}

export interface ReportReview {
  id: number;
  posted_date: string;
  customer_name: string;
  star_rating: number | null;
  mentions: ReportMention[];
}

/** What `GET /api/report` returns. `summary` is counted separately in SQL and used as a cross-check. */
export interface ReportData extends Period {
  reviews: ReportReview[];
  per_employee: EmployeeTotal[];
  summary: { count: number; mentions: number; total_cents: number };
}

export interface DepartmentTotal {
  name: string;
  mentions: number;
  total_cents: number;
}

export interface ReportLogRow extends ReportReview {
  /** Sum of this review's saved mention amounts, counted once per mention. */
  total_cents: number;
}

export interface ReportModel extends Period {
  /** # Of Reviews: unique review records. */
  reviewCount: number;
  /** Employee Mentioned: credited employee mentions (not unique people). */
  mentionCount: number;
  /** Total Spiff $'s: sum of saved mention amounts. */
  totalCents: number;
  employees: EmployeeTotal[];
  departments: DepartmentTotal[];
  reviews: ReportLogRow[];
}

export class ReconcileError extends Error {}

const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

export function buildReportModel(data: ReportData): ReportModel {
  const seen = new Set<number>();
  const reviews: ReportLogRow[] = data.reviews.map((r) => {
    if (seen.has(r.id)) throw new ReconcileError(`Review ${r.id} appears twice.`);
    seen.add(r.id);
    if (r.posted_date < data.start || r.posted_date > data.end) throw new ReconcileError(`Review ${r.id} is outside the reporting period.`);
    const mentions = [...r.mentions].sort((a, b) => a.id - b.id);
    for (const m of mentions) if (!Number.isInteger(m.amount_cents)) throw new ReconcileError("A spiff amount is not whole cents.");
    return { ...r, mentions, total_cents: mentions.reduce((s, m) => s + m.amount_cents, 0) };
  });
  reviews.sort((a, b) => (a.posted_date < b.posted_date ? -1 : a.posted_date > b.posted_date ? 1 : a.id - b.id));

  const deptMap = new Map<string, DepartmentTotal>();
  for (const r of reviews) {
    for (const m of r.mentions) {
      const d = deptMap.get(m.department_name_snapshot) ?? { name: m.department_name_snapshot, mentions: 0, total_cents: 0 };
      d.mentions += 1;
      d.total_cents += m.amount_cents;
      deptMap.set(d.name, d);
    }
  }
  const departments = [...deptMap.values()].sort((a, b) => b.total_cents - a.total_cents || b.mentions - a.mentions || byName(a.name, b.name));

  const employees = [...data.per_employee].sort((a, b) => b.total_cents - a.total_cents || byName(a.name, b.name) || a.employee_id - b.employee_id);

  const reviewCount = reviews.length;
  const mentionCount = reviews.reduce((s, r) => s + r.mentions.length, 0);
  const totalCents = reviews.reduce((s, r) => s + r.total_cents, 0);

  // Every view of the same records must add up to the same numbers, or no report is produced.
  const sum = (xs: { mentions: number; total_cents: number }[]) => xs.reduce((s, x) => ({ m: s.m + x.mentions, c: s.c + x.total_cents }), { m: 0, c: 0 });
  const emp = sum(employees);
  const dep = sum(departments);
  const checks: [string, number, number][] = [
    ["review count", reviewCount, data.summary.count],
    ["mention count", mentionCount, data.summary.mentions],
    ["spiff total", totalCents, data.summary.total_cents],
    ["employee mention count", emp.m, mentionCount],
    ["employee spiff total", emp.c, totalCents],
    ["department mention count", dep.m, mentionCount],
    ["department spiff total", dep.c, totalCents],
  ];
  for (const [what, got, want] of checks) {
    if (got !== want) throw new ReconcileError(`The report's ${what} does not reconcile (${got} vs ${want}).`);
  }

  return { start: data.start, end: data.end, reviewCount, mentionCount, totalCents, employees, departments, reviews };
}
