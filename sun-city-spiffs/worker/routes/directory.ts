import { todayDenver } from "../../shared/dates";
import { normalizeName } from "../../shared/names";
import { DepartmentUpdateBody, EmployeeCreateBody, EmployeeUpdateBody, SpiffRuleCreateBody } from "../../shared/schemas";
import { formatCents } from "../../shared/text";
import { logStmt, nowIso, placeholders } from "../db";
import { loadDirectory } from "../directory";
import type { Env } from "../env";
import { HttpError, parseWith } from "../http";
import { ratesOn } from "../spiffs";

// ---------- Employees ----------
export async function listEmployees(db: D1Database, url: URL) {
  const includeInactive = url.searchParams.get("include_inactive") === "1";
  const q = normalizeName(url.searchParams.get("q") ?? "");
  let list = await loadDirectory(db);
  if (!includeInactive) list = list.filter((e) => e.active);
  if (q) list = list.filter((e) => [e.full_name, ...e.aliases].some((n) => normalizeName(n).includes(q)));
  return { employees: list };
}

async function departmentName(db: D1Database, id: number): Promise<string> {
  const d = await db.prepare("SELECT name FROM departments WHERE id = ?").bind(id).first<{ name: string }>();
  if (!d) throw new HttpError(400, "Unknown department");
  return d.name;
}

function cleanAliases(aliases: string[], fullName: string): { alias: string; norm: string }[] {
  const out = new Map<string, string>();
  const own = normalizeName(fullName);
  for (const a of aliases) {
    const norm = normalizeName(a);
    if (norm && norm !== own && !out.has(norm)) out.set(norm, a.trim());
  }
  return [...out].map(([norm, alias]) => ({ alias, norm }));
}

async function assertAliasesFree(db: D1Database, norms: string[], employeeId: number | null) {
  if (!norms.length) return;
  const { results } = await db
    .prepare(
      `SELECT a.alias, e.full_name FROM employee_aliases a JOIN employees e ON e.id = a.employee_id
       WHERE a.alias_norm IN (${placeholders(norms.length)}) AND a.employee_id != ?`,
    )
    .bind(...norms, employeeId ?? 0)
    .all<{ alias: string; full_name: string }>();
  if (results.length) throw new HttpError(409, `Alias "${results[0].alias}" already belongs to ${results[0].full_name}.`);
}

export async function createEmployee(env: Env, user: string, raw: unknown) {
  const b = parseWith(EmployeeCreateBody, raw);
  const db = env.DB;
  const fullName = b.full_name.replace(/\s+/g, " ");
  const dup = await db.prepare("SELECT id, active FROM employees WHERE full_name = ? COLLATE NOCASE").bind(fullName).first<{ id: number; active: number }>();
  if (dup) throw new HttpError(409, dup.active ? `${fullName} is already in the directory.` : `${fullName} exists but is deactivated. Reactivate them in Settings > Employees.`, { employee_id: dup.id });
  const dept = await departmentName(db, b.department_id);
  const aliases = cleanAliases(b.aliases, fullName);
  await assertAliasesFree(db, aliases.map((a) => a.norm), null);

  const at = nowIso();
  const ref = { sql: "(SELECT id FROM employees WHERE full_name = ? COLLATE NOCASE)", params: [fullName] };
  const stmts: D1PreparedStatement[] = [
    db.prepare("INSERT INTO employees (full_name, department_id, active, created_at) VALUES (?, ?, 1, ?)").bind(fullName, b.department_id, at),
    logStmt(db, user, { entity_type: "employee", entity_id: ref, action: "create", new_value: { full_name: fullName, department: dept }, summary: `Added employee ${fullName} (${dept})` }, at),
  ];
  for (const a of aliases) {
    stmts.push(
      db.prepare("INSERT INTO employee_aliases (employee_id, alias, alias_norm) VALUES ((SELECT id FROM employees WHERE full_name = ? COLLATE NOCASE), ?, ?)").bind(fullName, a.alias, a.norm),
      logStmt(db, user, { entity_type: "employee_alias", entity_id: { sql: "(SELECT id FROM employee_aliases WHERE alias_norm = ?)", params: [a.norm] }, action: "create", new_value: a.alias, summary: `Added alias "${a.alias}" for ${fullName}` }, at),
    );
  }
  await db.batch(stmts);
  const dir = await loadDirectory(db);
  return { employee: dir.find((e) => e.full_name.toLowerCase() === fullName.toLowerCase()) };
}

export async function updateEmployee(env: Env, user: string, id: number, raw: unknown) {
  const b = parseWith(EmployeeUpdateBody, raw);
  const db = env.DB;
  const dir = await loadDirectory(db);
  const cur = dir.find((e) => e.id === id);
  if (!cur) throw new HttpError(404, "Employee not found");
  const at = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const name = (b.full_name ?? cur.full_name).replace(/\s+/g, " ");

  if (b.full_name !== undefined && name !== cur.full_name) {
    const dup = await db.prepare("SELECT id FROM employees WHERE full_name = ? COLLATE NOCASE AND id != ?").bind(name, id).first();
    if (dup) throw new HttpError(409, `${name} is already in the directory.`);
    stmts.push(
      db.prepare("UPDATE employees SET full_name = ? WHERE id = ?").bind(name, id),
      logStmt(db, user, { entity_type: "employee", entity_id: id, action: "update", field: "full_name", old_value: cur.full_name, new_value: name, summary: `Renamed ${cur.full_name} to ${name}` }, at),
    );
  }
  if (b.department_id !== undefined && b.department_id !== cur.department_id) {
    const dept = await departmentName(db, b.department_id);
    stmts.push(
      db.prepare("UPDATE employees SET department_id = ? WHERE id = ?").bind(b.department_id, id),
      logStmt(db, user, { entity_type: "employee", entity_id: id, action: "update", field: "department", old_value: cur.department_name, new_value: dept, summary: `Moved ${name} from ${cur.department_name} to ${dept}` }, at),
    );
  }
  if (b.active !== undefined && b.active !== cur.active) {
    stmts.push(
      db.prepare("UPDATE employees SET active = ? WHERE id = ?").bind(b.active ? 1 : 0, id),
      logStmt(
        db,
        user,
        { entity_type: "employee", entity_id: id, action: b.active ? "update" : "deactivate", field: "active", old_value: cur.active, new_value: b.active, summary: `${b.active ? "Reactivated" : "Deactivated"} ${name}` },
        at,
      ),
    );
  }
  if (b.aliases !== undefined) {
    const next = cleanAliases(b.aliases, name);
    const curNorms = new Map(cur.aliases.map((a) => [normalizeName(a), a]));
    const add = next.filter((a) => !curNorms.has(a.norm));
    const remove = [...curNorms].filter(([norm]) => !next.some((a) => a.norm === norm));
    await assertAliasesFree(db, add.map((a) => a.norm), id);
    for (const [norm, alias] of remove) {
      stmts.push(
        logStmt(db, user, { entity_type: "employee_alias", entity_id: { sql: "(SELECT id FROM employee_aliases WHERE alias_norm = ?)", params: [norm] }, action: "delete", old_value: alias, summary: `Removed alias "${alias}" from ${name}` }, at),
        db.prepare("DELETE FROM employee_aliases WHERE alias_norm = ? AND employee_id = ?").bind(norm, id),
      );
    }
    for (const a of add) {
      stmts.push(
        db.prepare("INSERT INTO employee_aliases (employee_id, alias, alias_norm) VALUES (?, ?, ?)").bind(id, a.alias, a.norm),
        logStmt(db, user, { entity_type: "employee_alias", entity_id: { sql: "(SELECT id FROM employee_aliases WHERE alias_norm = ?)", params: [a.norm] }, action: "create", new_value: a.alias, summary: `Added alias "${a.alias}" for ${name}` }, at),
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
  const after = await loadDirectory(db);
  return { employee: after.find((e) => e.id === id) };
}

// ---------- Departments ----------
export async function listDepartments(db: D1Database) {
  const { results } = await db.prepare("SELECT id, name, spiff_type, sort_order FROM departments ORDER BY sort_order, name").all();
  return { departments: results };
}

export async function updateDepartment(env: Env, user: string, id: number, raw: unknown) {
  const b = parseWith(DepartmentUpdateBody, raw);
  const db = env.DB;
  const cur = await db.prepare("SELECT id, name, spiff_type, sort_order FROM departments WHERE id = ?").bind(id).first<{ id: number; name: string; spiff_type: string; sort_order: number }>();
  if (!cur) throw new HttpError(404, "Department not found");
  const at = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const k of ["name", "spiff_type", "sort_order"] as const) {
    const v = b[k];
    if (v === undefined || v === cur[k]) continue;
    stmts.push(
      db.prepare(`UPDATE departments SET ${k} = ? WHERE id = ?`).bind(v, id),
      logStmt(db, user, { entity_type: "department", entity_id: id, action: "update", field: k, old_value: cur[k], new_value: v, summary: `Changed ${k.replace("_", " ")} of ${cur.name} from ${cur[k]} to ${v}` }, at),
    );
  }
  if (stmts.length) {
    try {
      await db.batch(stmts);
    } catch {
      throw new HttpError(409, "That department name is already used.");
    }
  }
  return listDepartments(db);
}

// ---------- Spiff rules ----------
export async function listSpiffRules(db: D1Database) {
  const { results } = await db
    .prepare("SELECT id, spiff_type, solo_amount_cents, shared_amount_cents, effective_from, created_at, created_by FROM spiff_rules ORDER BY spiff_type, effective_from DESC")
    .all();
  const today = todayDenver();
  return { rules: results, current: await ratesOn(db, today), today };
}

export async function createSpiffRule(env: Env, user: string, raw: unknown) {
  const b = parseWith(SpiffRuleCreateBody, raw);
  const db = env.DB;
  const exists = await db.prepare("SELECT id FROM spiff_rules WHERE spiff_type = ? AND effective_from = ?").bind(b.spiff_type, b.effective_from).first();
  if (exists) throw new HttpError(409, `A ${b.spiff_type} rate already starts on ${b.effective_from}. Pick another date.`);
  const at = nowIso();
  await db.batch([
    db
      .prepare("INSERT INTO spiff_rules (spiff_type, solo_amount_cents, shared_amount_cents, effective_from, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(b.spiff_type, b.solo_amount_cents, b.shared_amount_cents, b.effective_from, at, user),
    logStmt(
      db,
      user,
      {
        entity_type: "spiff_rule",
        entity_id: { sql: "(SELECT id FROM spiff_rules WHERE spiff_type = ? AND effective_from = ?)", params: [b.spiff_type, b.effective_from] },
        action: "create",
        new_value: b,
        summary: `New ${b.spiff_type} rate from ${b.effective_from}: ${formatCents(b.solo_amount_cents)} solo / ${formatCents(b.shared_amount_cents)} shared`,
      },
      at,
    ),
  ]);
  return listSpiffRules(db);
}
