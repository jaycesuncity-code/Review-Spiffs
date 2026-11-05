import { currentMonthDenver, isValidMonth } from "../../shared/dates";
import { CalcBody, CreateReviewBody, UpdateReviewBody, type CalcResult, type Review, type ReviewMention } from "../../shared/schemas";
import { formatCents, wordCount } from "../../shared/text";
import { cleanReviewPaste } from "../cleaner";
import { bool, logStmt, nowIso, placeholders, reviewHash } from "../db";
import { findDuplicates } from "../duplicates";
import type { Env } from "../env";
import { HttpError, parseWith } from "../http";
import { calculateSpiffs } from "../spiffs";

interface ReviewRow {
  id: number;
  customer_name: string;
  posted_date: string;
  review_raw: string;
  review_text: string;
  word_count: number;
  reply_ai_text: string | null;
  reply_final_text: string;
  star_rating: number | null;
  job_type_guess: "install" | "service" | "unknown";
  services_text: string | null;
  needs_attention: number;
  attention_reason: string | null;
  already_answered: number;
  request_id: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  total_cents: number;
}

const REVIEW_SELECT = `SELECT r.*, (SELECT COALESCE(SUM(m.amount_cents), 0) FROM review_mentions m WHERE m.review_id = r.id) AS total_cents FROM reviews r`;

function toReview(r: ReviewRow, mentions: ReviewMention[]): Review {
  return {
    id: r.id,
    customer_name: r.customer_name,
    posted_date: r.posted_date,
    review_raw: r.review_raw,
    review_text: r.review_text,
    word_count: r.word_count,
    reply_ai_text: r.reply_ai_text,
    reply_final_text: r.reply_final_text,
    star_rating: r.star_rating,
    job_type_guess: r.job_type_guess,
    services_text: r.services_text,
    needs_attention: bool(r.needs_attention),
    attention_reason: r.attention_reason,
    already_answered: bool(r.already_answered),
    request_id: r.request_id,
    created_at: r.created_at,
    created_by: r.created_by,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
    total_cents: r.total_cents,
    mentions,
  };
}

const MENTION_COLS =
  "id, review_id, employee_id, employee_name_snapshot, department_name_snapshot, spiff_type_snapshot, mention_text, amount_cents, rule_note";

export async function loadReview(db: D1Database, id: number): Promise<Review | null> {
  const [r, m] = await db.batch([
    db.prepare(`${REVIEW_SELECT} WHERE r.id = ?`).bind(id),
    db.prepare(`SELECT ${MENTION_COLS} FROM review_mentions WHERE review_id = ? ORDER BY id`).bind(id),
  ]);
  const row = r.results[0] as ReviewRow | undefined;
  return row ? toReview(row, m.results as ReviewMention[]) : null;
}

// ---------- Month list ----------
export async function listMonths(db: D1Database): Promise<{ months: string[]; current: string }> {
  const { results } = await db
    .prepare("SELECT DISTINCT substr(posted_date, 1, 7) AS month FROM reviews ORDER BY month DESC")
    .all<{ month: string }>();
  const current = currentMonthDenver();
  const months = new Set(results.map((r) => r.month));
  months.add(current);
  return { months: [...months].sort().reverse(), current };
}

export async function listReviews(db: D1Database, month: string) {
  if (!isValidMonth(month)) throw new HttpError(400, "month must be YYYY-MM");
  const like = `${month}-%`;
  const [reviews, mentions, perEmployee] = await db.batch([
    db.prepare(`${REVIEW_SELECT} WHERE r.posted_date LIKE ? ORDER BY r.posted_date DESC, r.id DESC`).bind(like),
    db
      .prepare(
        `SELECT ${MENTION_COLS} FROM review_mentions WHERE review_id IN (SELECT id FROM reviews WHERE posted_date LIKE ?) ORDER BY id`,
      )
      .bind(like),
    db
      .prepare(
        `SELECT m.employee_id, e.full_name AS name, d.name AS department, COUNT(*) AS mentions, SUM(m.amount_cents) AS total_cents
         FROM review_mentions m
         JOIN reviews r ON r.id = m.review_id
         JOIN employees e ON e.id = m.employee_id
         JOIN departments d ON d.id = e.department_id
         WHERE r.posted_date LIKE ?
         GROUP BY m.employee_id
         ORDER BY total_cents DESC, e.full_name COLLATE NOCASE`,
      )
      .bind(like),
  ]);
  const byReview = new Map<number, ReviewMention[]>();
  for (const m of mentions.results as (ReviewMention & { review_id: number })[]) {
    byReview.set(m.review_id, [...(byReview.get(m.review_id) ?? []), m]);
  }
  const list = (reviews.results as ReviewRow[]).map((r) => {
    const full = toReview(r, byReview.get(r.id) ?? []);
    // Cards don't need the long text fields.
    return { ...full, review_raw: "", review_text: full.review_text.slice(0, 280), reply_ai_text: null, reply_final_text: "" };
  });
  const totals = await db
    .prepare(
      `SELECT COUNT(DISTINCT r.id) AS count, COALESCE(SUM(m.amount_cents), 0) AS total_cents
       FROM reviews r LEFT JOIN review_mentions m ON m.review_id = r.id WHERE r.posted_date LIKE ?`,
    )
    .bind(like)
    .first<{ count: number; total_cents: number }>();
  return {
    month,
    reviews: list,
    summary: {
      count: totals?.count ?? 0,
      total_cents: totals?.total_cents ?? 0,
      per_employee: perEmployee.results as { employee_id: number; name: string; department: string; mentions: number; total_cents: number }[],
    },
  };
}

// ---------- Calc preview ----------
export async function calcPreview(env: Env, raw: unknown): Promise<CalcResult> {
  const b = parseWith(CalcBody, raw);
  const spiffs = await calculateSpiffs(env.DB, b.posted_date, b.employee_ids);
  const text = b.review_text?.trim() || (b.review_raw ? cleanReviewPaste(b.review_raw).text : "");
  const duplicates = await findDuplicates(env.DB, {
    reviewText: text,
    customerName: b.customer_name ?? "",
    employeeIds: b.employee_ids,
    postedDate: b.posted_date,
    excludeId: b.exclude_review_id,
  });
  return { ...spiffs, duplicates };
}

async function assertActive(db: D1Database, ids: number[]) {
  if (!ids.length) return;
  const { results } = await db
    .prepare(`SELECT full_name FROM employees WHERE active = 0 AND id IN (${placeholders(ids.length)})`)
    .bind(...ids)
    .all<{ full_name: string }>();
  if (results.length) throw new HttpError(400, `${results.map((r) => r.full_name).join(", ")} is deactivated. Reactivate in Settings or pick someone else.`);
}

const reviewRef = (requestId: string) => ({ sql: "(SELECT id FROM reviews WHERE request_id = ?)", params: [requestId] });

// ---------- Create ----------
export async function createReview(env: Env, user: string, raw: unknown) {
  const b = parseWith(CreateReviewBody, raw);
  const db = env.DB;

  const already = await db.prepare("SELECT id FROM reviews WHERE request_id = ?").bind(b.request_id).first<{ id: number }>();
  if (already) return { review: await loadReview(db, already.id), already_saved: true };

  const ids = b.mentions.map((m) => m.employee_id);
  await assertActive(db, ids);
  const reviewText = b.review_text.trim() || cleanReviewPaste(b.review_raw).text;
  const calc = await calculateSpiffs(db, b.posted_date, ids); // never trust client amounts

  if (!b.acknowledge_duplicates) {
    const dups = await findDuplicates(db, { reviewText, customerName: b.customer_name, employeeIds: ids, postedDate: b.posted_date });
    if (dups.length) throw new HttpError(409, "This may be a duplicate of a saved entry.", { code: "duplicate", duplicates: dups });
  }

  const at = nowIso();
  const hash = await reviewHash(reviewText);
  const mentionText = new Map(b.mentions.map((m) => [m.employee_id, m.mention_text]));
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO reviews (customer_name, posted_date, review_raw, review_text, review_hash, word_count, reply_ai_text, reply_final_text,
           star_rating, job_type_guess, services_text, needs_attention, attention_reason, already_answered, request_id,
           created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        b.customer_name,
        b.posted_date,
        b.review_raw,
        reviewText,
        hash,
        wordCount(reviewText),
        b.reply_ai_text,
        b.reply_final_text,
        b.star_rating,
        b.job_type_guess,
        b.services_text,
        b.needs_attention ? 1 : 0,
        b.attention_reason,
        b.already_answered ? 1 : 0,
        b.request_id,
        at,
        user,
        at,
        user,
      ),
    logStmt(
      db,
      user,
      {
        entity_type: "review",
        entity_id: reviewRef(b.request_id),
        action: "create",
        new_value: { customer_name: b.customer_name, posted_date: b.posted_date, employees: calc.lines.map((l) => l.employee_name), total_cents: calc.total_cents },
        summary: `Added review from ${b.customer_name} (${b.posted_date}): ${calc.lines.length} employee(s), ${formatCents(calc.total_cents)}`,
      },
      at,
    ),
  ];
  for (const l of calc.lines) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO review_mentions (review_id, employee_id, employee_name_snapshot, department_name_snapshot, spiff_type_snapshot, mention_text, amount_cents, rule_note)
           VALUES ((SELECT id FROM reviews WHERE request_id = ?), ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(b.request_id, l.employee_id, l.employee_name, l.department_name, l.spiff_type, mentionText.get(l.employee_id) ?? null, l.amount_cents, l.rule_note),
      logStmt(
        db,
        user,
        {
          entity_type: "review_mention",
          entity_id: {
            sql: "(SELECT id FROM review_mentions WHERE review_id = (SELECT id FROM reviews WHERE request_id = ?) AND employee_id = ?)",
            params: [b.request_id, l.employee_id],
          },
          action: "create",
          new_value: { employee: l.employee_name, amount_cents: l.amount_cents, rule_note: l.rule_note },
          summary: `${l.employee_name} credited on review from ${b.customer_name}: ${formatCents(l.amount_cents)} (${l.rule_note})`,
        },
        at,
      ),
    );
  }

  try {
    await db.batch(stmts);
  } catch (err) {
    // A double-tap that raced past the check above hits the UNIQUE(request_id) constraint: return the one saved row.
    const again = await db.prepare("SELECT id FROM reviews WHERE request_id = ?").bind(b.request_id).first<{ id: number }>();
    if (again) return { review: await loadReview(db, again.id), already_saved: true };
    throw err;
  }
  const saved = await db.prepare("SELECT id FROM reviews WHERE request_id = ?").bind(b.request_id).first<{ id: number }>();
  return { review: await loadReview(db, saved!.id), already_saved: false };
}

// ---------- Update ----------
type FieldKey =
  | "customer_name"
  | "posted_date"
  | "review_raw"
  | "review_text"
  | "reply_ai_text"
  | "reply_final_text"
  | "star_rating"
  | "job_type_guess"
  | "services_text"
  | "needs_attention"
  | "attention_reason"
  | "already_answered";

const FIELD_LABEL: Record<FieldKey, string> = {
  customer_name: "customer name",
  posted_date: "posted date",
  review_raw: "pasted review",
  review_text: "review text",
  reply_ai_text: "AI reply",
  reply_final_text: "reply",
  star_rating: "star rating",
  job_type_guess: "job type guess",
  services_text: "services",
  needs_attention: "needs attention",
  attention_reason: "attention reason",
  already_answered: "already answered",
};
const LONG_FIELDS = new Set<FieldKey>(["review_raw", "review_text", "reply_ai_text", "reply_final_text", "attention_reason"]);

export async function updateReview(env: Env, user: string, id: number, raw: unknown) {
  const b = parseWith(UpdateReviewBody, raw);
  const db = env.DB;
  const cur = await loadReview(db, id);
  if (!cur) throw new HttpError(404, "Entry not found");
  if (cur.updated_at !== b.expected_updated_at) {
    throw new HttpError(409, `${cur.updated_by} changed this entry since you opened it. Reload to see the latest.`, { code: "stale" });
  }

  const reviewText = b.review_text.trim() || cleanReviewPaste(b.review_raw).text;
  const next: Record<FieldKey, unknown> = {
    customer_name: b.customer_name,
    posted_date: b.posted_date,
    review_raw: b.review_raw,
    review_text: reviewText,
    reply_ai_text: b.reply_ai_text ?? cur.reply_ai_text,
    reply_final_text: b.reply_final_text,
    star_rating: b.star_rating,
    job_type_guess: b.job_type_guess,
    services_text: b.services_text,
    needs_attention: b.needs_attention,
    attention_reason: b.attention_reason,
    already_answered: b.already_answered,
  };
  const changed = (Object.keys(next) as FieldKey[]).filter((k) => next[k] !== (cur as unknown as Record<string, unknown>)[k]);

  const oldIds = cur.mentions.map((m) => m.employee_id);
  const newIds = b.mentions.map((m) => m.employee_id);
  const added = newIds.filter((x) => !oldIds.includes(x));
  const removed = cur.mentions.filter((m) => !newIds.includes(m.employee_id));
  const setChanged = added.length > 0 || removed.length > 0;
  const recalc = setChanged || changed.includes("posted_date");
  const newMentionText = new Map(b.mentions.map((m) => [m.employee_id, m.mention_text]));
  const textChanges = cur.mentions.filter((m) => newIds.includes(m.employee_id) && (newMentionText.get(m.employee_id) ?? null) !== m.mention_text);

  if (!changed.length && !setChanged && !textChanges.length && !recalc) return { review: cur, changed: false };

  await assertActive(db, added);
  const calc = recalc ? await calculateSpiffs(db, b.posted_date, newIds) : null;

  if (!b.acknowledge_duplicates && (setChanged || changed.some((k) => ["customer_name", "posted_date", "review_text"].includes(k)))) {
    const dups = await findDuplicates(db, { reviewText, customerName: b.customer_name, employeeIds: newIds, postedDate: b.posted_date, excludeId: id });
    if (dups.length) throw new HttpError(409, "This may be a duplicate of a saved entry.", { code: "duplicate", duplicates: dups });
  }

  const at = nowIso();
  const label = `review #${id} (${b.customer_name})`;
  const stmts: D1PreparedStatement[] = [];
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const k of changed) {
    const v = next[k];
    cols.push(`${k} = ?`);
    vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
    const oldV = (cur as unknown as Record<string, unknown>)[k];
    stmts.push(
      logStmt(
        db,
        user,
        {
          entity_type: "review",
          entity_id: id,
          action: "update",
          field: k,
          old_value: oldV,
          new_value: v,
          summary: LONG_FIELDS.has(k)
            ? `Edited ${FIELD_LABEL[k]} on ${label}`
            : `Changed ${FIELD_LABEL[k]} on ${label} from "${oldV ?? "(blank)"}" to "${v ?? "(blank)"}"`,
        },
        at,
      ),
    );
  }
  if (changed.includes("review_text")) {
    cols.push("review_hash = ?", "word_count = ?");
    vals.push(await reviewHash(reviewText), wordCount(reviewText));
  }
  cols.push("updated_at = ?", "updated_by = ?");
  vals.push(at, user);
  stmts.unshift(db.prepare(`UPDATE reviews SET ${cols.join(", ")} WHERE id = ?`).bind(...vals, id));

  for (const m of removed) {
    stmts.push(
      db.prepare("DELETE FROM review_mentions WHERE id = ?").bind(m.id),
      logStmt(
        db,
        user,
        { entity_type: "review_mention", entity_id: m.id, action: "delete", old_value: m, summary: `Removed ${m.employee_name_snapshot} from ${label}` },
        at,
      ),
    );
  }
  for (const m of textChanges) {
    const nt = newMentionText.get(m.employee_id) ?? null;
    stmts.push(
      db.prepare("UPDATE review_mentions SET mention_text = ? WHERE id = ?").bind(nt, m.id),
      logStmt(
        db,
        user,
        { entity_type: "review_mention", entity_id: m.id, action: "update", field: "mention_text", old_value: m.mention_text, new_value: nt, summary: `Changed how ${m.employee_name_snapshot} is written on ${label}` },
        at,
      ),
    );
  }
  if (calc) {
    for (const l of calc.lines) {
      const old = cur.mentions.find((m) => m.employee_id === l.employee_id);
      if (!old) {
        stmts.push(
          db
            .prepare(
              `INSERT INTO review_mentions (review_id, employee_id, employee_name_snapshot, department_name_snapshot, spiff_type_snapshot, mention_text, amount_cents, rule_note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(id, l.employee_id, l.employee_name, l.department_name, l.spiff_type, newMentionText.get(l.employee_id) ?? null, l.amount_cents, l.rule_note),
          logStmt(
            db,
            user,
            {
              entity_type: "review_mention",
              entity_id: { sql: "(SELECT id FROM review_mentions WHERE review_id = ? AND employee_id = ?)", params: [id, l.employee_id] },
              action: "create",
              new_value: { employee: l.employee_name, amount_cents: l.amount_cents, rule_note: l.rule_note },
              summary: `Added ${l.employee_name} to ${label}: ${formatCents(l.amount_cents)} (${l.rule_note})`,
            },
            at,
          ),
        );
      } else if (
        old.amount_cents !== l.amount_cents ||
        old.rule_note !== l.rule_note ||
        old.employee_name_snapshot !== l.employee_name ||
        old.department_name_snapshot !== l.department_name ||
        old.spiff_type_snapshot !== l.spiff_type
      ) {
        stmts.push(
          db
            .prepare(
              `UPDATE review_mentions SET amount_cents = ?, rule_note = ?, employee_name_snapshot = ?, department_name_snapshot = ?, spiff_type_snapshot = ? WHERE id = ?`,
            )
            .bind(l.amount_cents, l.rule_note, l.employee_name, l.department_name, l.spiff_type, old.id),
          logStmt(
            db,
            user,
            {
              entity_type: "review_mention",
              entity_id: old.id,
              action: "update",
              field: "amount_cents",
              old_value: old.amount_cents,
              new_value: l.amount_cents,
              summary: `Recalculated ${l.employee_name} on ${label}: ${formatCents(old.amount_cents)} to ${formatCents(l.amount_cents)} (${l.rule_note})`,
            },
            at,
          ),
        );
      }
    }
  }

  await db.batch(stmts);
  return { review: await loadReview(db, id), changed: true };
}

// ---------- Delete ----------
export async function deleteReview(env: Env, user: string, id: number) {
  const db = env.DB;
  const cur = await loadReview(db, id);
  if (!cur) throw new HttpError(404, "Entry not found");
  await db.batch([
    logStmt(db, user, {
      entity_type: "review",
      entity_id: id,
      action: "delete",
      old_value: cur,
      summary: `Deleted review from ${cur.customer_name} (${cur.posted_date}), ${cur.mentions.length} employee(s), ${formatCents(cur.total_cents)}`,
    }),
    db.prepare("DELETE FROM review_mentions WHERE review_id = ?").bind(id),
    db.prepare("DELETE FROM reviews WHERE id = ?").bind(id),
  ]);
  return { ok: true };
}

// ---------- CSV export ----------
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // block spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const dollars = (c: number) => (c / 100).toFixed(2);

export async function exportCsv(db: D1Database, month: string, kind: string): Promise<Response> {
  if (!isValidMonth(month)) throw new HttpError(400, "month must be YYYY-MM");
  const like = `${month}-%`;
  let body: string;
  let name: string;
  if (kind === "totals") {
    const { results } = await db
      .prepare(
        `SELECT e.full_name AS name, d.name AS department, COUNT(*) AS mentions, SUM(m.amount_cents) AS total_cents
         FROM review_mentions m JOIN reviews r ON r.id = m.review_id
         JOIN employees e ON e.id = m.employee_id JOIN departments d ON d.id = e.department_id
         WHERE r.posted_date LIKE ? GROUP BY m.employee_id ORDER BY e.full_name COLLATE NOCASE`,
      )
      .bind(like)
      .all<{ name: string; department: string; mentions: number; total_cents: number }>();
    body = csv([["employee", "department", "mentions", "total"], ...results.map((r) => [r.name, r.department, r.mentions, dollars(r.total_cents)])]);
    name = `spiff-totals-${month}.csv`;
  } else {
    const { results } = await db
      .prepare(
        `SELECT r.posted_date, r.customer_name, m.employee_name_snapshot AS employee, m.department_name_snapshot AS department,
                m.spiff_type_snapshot AS type, m.amount_cents
         FROM review_mentions m JOIN reviews r ON r.id = m.review_id
         WHERE r.posted_date LIKE ? ORDER BY r.posted_date, r.id, m.id`,
      )
      .bind(like)
      .all<{ posted_date: string; customer_name: string; employee: string; department: string; type: string; amount_cents: number }>();
    body = csv([
      ["posted_date", "customer", "employee", "department", "type", "amount"],
      ...results.map((r) => [r.posted_date, r.customer_name, r.employee, r.department, r.type, dollars(r.amount_cents)]),
    ]);
    name = `spiff-mentions-${month}.csv`;
  }
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
