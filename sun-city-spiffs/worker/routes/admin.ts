import { isValidDate } from "../../shared/dates";
import { SETTING_KEYS } from "../../shared/defaults";
import { ExampleBody, SettingsPatch } from "../../shared/schemas";
import { wordCount } from "../../shared/text";
import { getSettings, logStmt, nowIso } from "../db";
import type { Env } from "../env";
import { HttpError, parseWith } from "../http";

// ---------- Settings ----------
export async function putSettings(env: Env, user: string, raw: unknown) {
  const patch = parseWith(SettingsPatch, raw);
  const db = env.DB;
  const cur = await getSettings(db);
  const at = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const key of SETTING_KEYS) {
    const v = patch[key];
    if (v === undefined) continue;
    const oldJson = JSON.stringify(cur[key]);
    const newJson = JSON.stringify(v);
    if (oldJson === newJson) continue;
    stmts.push(
      db
        .prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
        .bind(key, newJson, at, user),
      logStmt(db, user, { entity_type: "setting", entity_id: key, action: "update", field: key, old_value: oldJson, new_value: newJson, summary: `Changed setting ${key.replace(/_/g, " ")}` }, at),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return { settings: await getSettings(db) };
}

// ---------- Reply examples ----------
interface ExampleRow {
  id: number;
  customer_name: string | null;
  review_text: string;
  reply_text: string;
  word_count: number;
  active: number;
  created_at: string;
}

export async function listExamples(db: D1Database) {
  const { results } = await db.prepare("SELECT * FROM reply_examples ORDER BY active DESC, id DESC").all<ExampleRow>();
  return { examples: results.map((e) => ({ ...e, active: e.active === 1 })) };
}

export async function createExample(env: Env, user: string, raw: unknown) {
  const b = parseWith(ExampleBody, raw);
  const db = env.DB;
  const at = nowIso();
  await db.batch([
    db
      .prepare("INSERT INTO reply_examples (customer_name, review_text, reply_text, word_count, active, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(b.customer_name, b.review_text, b.reply_text, wordCount(b.review_text), b.active ? 1 : 0, at),
    // last_insert_rowid() is the example just inserted (same connection, same batch).
    logStmt(db, user, { entity_type: "reply_example", entity_id: { sql: "last_insert_rowid()", params: [] }, action: "create", new_value: b, summary: `Added reply example${b.customer_name ? ` (${b.customer_name})` : ""}` }, at),
  ]);
  return listExamples(db);
}

export async function updateExample(env: Env, user: string, id: number, raw: unknown) {
  const b = parseWith(ExampleBody, raw);
  const db = env.DB;
  const cur = await db.prepare("SELECT * FROM reply_examples WHERE id = ?").bind(id).first<ExampleRow>();
  if (!cur) throw new HttpError(404, "Example not found");
  const at = nowIso();
  const next = { customer_name: b.customer_name, review_text: b.review_text, reply_text: b.reply_text, active: b.active ? 1 : 0 };
  const stmts: D1PreparedStatement[] = [];
  for (const k of Object.keys(next) as (keyof typeof next)[]) {
    if (next[k] === cur[k]) continue;
    stmts.push(
      logStmt(
        db,
        user,
        {
          entity_type: "reply_example",
          entity_id: id,
          action: k === "active" && next.active === 0 ? "deactivate" : "update",
          field: k,
          old_value: cur[k],
          new_value: next[k],
          summary: k === "active" ? `${next.active ? "Activated" : "Deactivated"} reply example #${id}` : `Edited ${k.replace(/_/g, " ")} of reply example #${id}`,
        },
        at,
      ),
    );
  }
  if (stmts.length) {
    stmts.unshift(
      db
        .prepare("UPDATE reply_examples SET customer_name = ?, review_text = ?, reply_text = ?, word_count = ?, active = ? WHERE id = ?")
        .bind(next.customer_name, next.review_text, next.reply_text, wordCount(next.review_text), next.active, id),
    );
    await db.batch(stmts);
  }
  return listExamples(db);
}

export async function deleteExample(env: Env, user: string, id: number) {
  const db = env.DB;
  const cur = await db.prepare("SELECT * FROM reply_examples WHERE id = ?").bind(id).first<ExampleRow>();
  if (!cur) throw new HttpError(404, "Example not found");
  await db.batch([
    logStmt(db, user, { entity_type: "reply_example", entity_id: id, action: "delete", old_value: cur, summary: `Deleted reply example #${id}${cur.customer_name ? ` (${cur.customer_name})` : ""}` }),
    db.prepare("DELETE FROM reply_examples WHERE id = ?").bind(id),
  ]);
  return listExamples(db);
}

// ---------- Change log (read-only) ----------
const ENTITY_TYPES = new Set(["review", "review_mention", "employee", "employee_alias", "department", "spiff_rule", "setting", "reply_example"]);

export async function listChangeLog(db: D1Database, url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = 50;
  const where: string[] = [];
  const params: unknown[] = [];
  const user = url.searchParams.get("user");
  const type = url.searchParams.get("entity_type");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (user) {
    where.push("user_email = ?");
    params.push(user);
  }
  if (type) {
    if (!ENTITY_TYPES.has(type)) throw new HttpError(400, "Unknown entity type");
    where.push("entity_type = ?");
    params.push(type);
  }
  // Dates are interpreted in UTC day boundaries; good enough for an audit filter.
  if (from) {
    if (!isValidDate(from)) throw new HttpError(400, "from must be YYYY-MM-DD");
    where.push("at >= ?");
    params.push(`${from}T00:00:00.000Z`);
  }
  if (to) {
    if (!isValidDate(to)) throw new HttpError(400, "to must be YYYY-MM-DD");
    where.push("at <= ?");
    params.push(`${to}T23:59:59.999Z`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, count, users] = await db.batch([
    db.prepare(`SELECT * FROM change_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...params, pageSize, (page - 1) * pageSize),
    db.prepare(`SELECT COUNT(*) AS n FROM change_log ${w}`).bind(...params),
    db.prepare("SELECT DISTINCT user_email FROM change_log ORDER BY user_email"),
  ]);
  return {
    entries: rows.results,
    total: (count.results[0] as { n: number }).n,
    page,
    page_size: pageSize,
    users: (users.results as { user_email: string }[]).map((u) => u.user_email),
  };
}
