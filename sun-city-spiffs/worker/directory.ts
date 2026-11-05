import type { SpiffType } from "../shared/schemas";
import type { DirEmployee } from "./matching";

interface EmpRow {
  id: number;
  full_name: string;
  department_id: number;
  department_name: string;
  spiff_type: SpiffType;
  active: number;
  sort_order: number;
}

/** Full directory with aliases (both active and inactive; callers filter). */
export async function loadDirectory(db: D1Database): Promise<DirEmployee[]> {
  const [emps, aliases] = await db.batch([
    db.prepare(
      `SELECT e.id, e.full_name, e.department_id, d.name AS department_name, d.spiff_type, e.active, d.sort_order
       FROM employees e JOIN departments d ON d.id = e.department_id
       ORDER BY d.sort_order, e.full_name COLLATE NOCASE`,
    ),
    db.prepare("SELECT employee_id, alias FROM employee_aliases ORDER BY alias COLLATE NOCASE"),
  ]);
  const byEmp = new Map<number, string[]>();
  for (const a of aliases.results as { employee_id: number; alias: string }[]) {
    const list = byEmp.get(a.employee_id) ?? [];
    list.push(a.alias);
    byEmp.set(a.employee_id, list);
  }
  return (emps.results as EmpRow[]).map((e) => ({
    id: e.id,
    full_name: e.full_name,
    department_id: e.department_id,
    department_name: e.department_name,
    spiff_type: e.spiff_type,
    active: e.active === 1,
    aliases: byEmp.get(e.id) ?? [],
  }));
}
