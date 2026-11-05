// The one place money is decided. Used by /api/calc (preview) and by every save path.
import type { SpiffLine, SpiffType } from "../shared/schemas";
import { formatCents } from "../shared/text";
import { HttpError } from "./http";
import { placeholders } from "./db";

export interface RateRow {
  spiff_type: "install" | "service";
  solo_amount_cents: number;
  shared_amount_cents: number;
  effective_from: string;
}

export interface CalcEmployee {
  employee_id: number;
  employee_name: string;
  department_name: string;
  spiff_type: SpiffType;
}

export interface SpiffResult {
  lines: SpiffLine[];
  total_cents: number;
  counted_headcount: number;
}

const TYPE_LABEL = { install: "Install", service: "Service" } as const;

/**
 * Pure spiff math.
 * Headcount = distinct mentioned employees whose department type is install or service (managers excluded).
 * Each counted employee gets their type's solo amount when headcount is 1, otherwise the shared amount.
 * Install seeds solo = shared = $30 ("$30 each regardless of headcount"); service seeds $30 solo / $15 shared.
 */
export function computeSpiffs(
  employees: CalcEmployee[],
  rates: { install: RateRow | null; service: RateRow | null },
): SpiffResult {
  const seen = new Set<number>();
  const unique = employees.filter((e) => (seen.has(e.employee_id) ? false : (seen.add(e.employee_id), true)));
  const counted = unique.filter((e) => e.spiff_type === "install" || e.spiff_type === "service").length;

  const lines: SpiffLine[] = unique.map((e) => {
    if (e.spiff_type === "none") {
      return { ...e, amount_cents: 0, rule_note: `Recognition only (${e.department_name}), $0` };
    }
    const rate = rates[e.spiff_type];
    const label = TYPE_LABEL[e.spiff_type];
    if (!rate) {
      return { ...e, amount_cents: 0, rule_note: `${label}: no rate in effect on this date, $0` };
    }
    const amount = counted === 1 ? rate.solo_amount_cents : rate.shared_amount_cents;
    let note: string;
    if (rate.solo_amount_cents === rate.shared_amount_cents) {
      note = `${label}, ${formatCents(amount)} each`;
    } else if (counted === 1) {
      note = `${label}, 1 counted employee, ${formatCents(amount)}`;
    } else {
      note = `${label}, ${counted} counted employees, ${formatCents(amount)} each`;
    }
    return { ...e, amount_cents: amount, rule_note: note };
  });

  return { lines, total_cents: lines.reduce((s, l) => s + l.amount_cents, 0), counted_headcount: counted };
}

/** Rate row in effect for a type on a date: latest effective_from <= date. */
export async function ratesOn(db: D1Database, date: string): Promise<{ install: RateRow | null; service: RateRow | null }> {
  const sql = `SELECT spiff_type, solo_amount_cents, shared_amount_cents, effective_from FROM spiff_rules
               WHERE spiff_type = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1`;
  const [install, service] = await db.batch<RateRow>([db.prepare(sql).bind("install", date), db.prepare(sql).bind("service", date)]);
  return { install: install.results[0] ?? null, service: service.results[0] ?? null };
}

/** calculateSpiffs(postedDate, employeeIds): the shared server function for preview and save. */
export async function calculateSpiffs(db: D1Database, postedDate: string, employeeIds: number[]): Promise<SpiffResult> {
  const ids = [...new Set(employeeIds)];
  if (ids.length === 0) return { lines: [], total_cents: 0, counted_headcount: 0 };

  const { results } = await db
    .prepare(
      `SELECT e.id AS employee_id, e.full_name AS employee_name, d.name AS department_name, d.spiff_type
       FROM employees e JOIN departments d ON d.id = e.department_id
       WHERE e.id IN (${placeholders(ids.length)})`,
    )
    .bind(...ids)
    .all<CalcEmployee>();
  const byId = new Map(results.map((r) => [r.employee_id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new HttpError(400, `Unknown employee id(s): ${missing.join(", ")}`);

  const rates = await ratesOn(db, postedDate);
  return computeSpiffs(
    ids.map((id) => byId.get(id)!),
    rates,
  );
}
