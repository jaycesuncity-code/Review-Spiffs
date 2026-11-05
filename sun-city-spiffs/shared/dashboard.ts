// Pure helpers for the Dashboard home page. No React, no I/O, so they are unit-tested.

export type GroupKey = "plumbing" | "hvac" | "install" | "other";

/** Only used to pick an icon for a department; the dashboard itself shows real department names. */
export function groupOfDepartment(department: string): GroupKey {
  const d = department.toLowerCase();
  if (d.includes("plumbing")) return "plumbing";
  if (d.includes("hvac")) return "hvac";
  if (d.includes("shop") || d.includes("install")) return "install";
  return "other";
}

/** Distinct department names a review's employees belong to, in order of first mention. */
export function departmentsOfReview(mentions: { department_name_snapshot: string }[]): string[] {
  return [...new Set(mentions.map((m) => m.department_name_snapshot))];
}

/**
 * Reviews per department. A review naming people from two departments counts once in each, so
 * the numbers can add up to more than the month's total. `order` (e.g. the directory's department
 * order) goes first and always appears, even at 0; departments only found on reviews follow A-Z.
 */
export function countByDepartment(reviews: { mentions: { department_name_snapshot: string }[] }[], order: string[] = []): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of reviews) for (const d of departmentsOfReview(r.mentions)) counts.set(d, (counts.get(d) ?? 0) + 1);
  const known = order.map((name) => ({ name, count: counts.get(name) ?? 0 }));
  const extras = [...counts.keys()].filter((n) => !order.includes(n)).sort((x, y) => x.localeCompare(y)).map((name) => ({ name, count: counts.get(name)! }));
  return [...known, ...extras];
}

export interface EmployeeTotal {
  employee_id: number;
  name: string;
  department: string;
  mentions: number;
  total_cents: number;
}

/** Ranked by review quantity (never by dollars); ties broken by name so the order is stable. */
export function rankByReviews<T extends { name: string; mentions: number }>(people: T[]): T[] {
  return [...people].sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export function topEmployees<T extends { name: string; mentions: number }>(people: T[], n = 5): T[] {
  return rankByReviews(people).slice(0, n);
}

export interface DonutSlice {
  label: string;
  value: number;
  /** 0-100, one decimal place. */
  pct: number;
  /** True for the combined "Everyone else" slice. */
  rest: boolean;
}

/** Top `max` employees by review count, plus one combined slice for everyone else. */
export function donutSlices(people: { name: string; mentions: number }[], max = 5): { slices: DonutSlice[]; total: number } {
  const ranked = rankByReviews(people).filter((p) => p.mentions > 0);
  const total = ranked.reduce((s, p) => s + p.mentions, 0);
  if (total === 0) return { slices: [], total: 0 };
  const pct = (v: number) => Math.round((v / total) * 1000) / 10;
  const slices: DonutSlice[] = ranked.slice(0, max).map((p) => ({ label: p.name, value: p.mentions, pct: pct(p.mentions), rest: false }));
  const restValue = ranked.slice(max).reduce((s, p) => s + p.mentions, 0);
  if (restValue > 0) slices.push({ label: "Everyone else", value: restValue, pct: pct(restValue), rest: true });
  return { slices, total };
}
