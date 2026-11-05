import { DEFAULT_SETTINGS, SETTING_KEYS } from "../shared/defaults";
import { SettingsSchema, type Settings } from "../shared/schemas";

export const nowIso = () => new Date().toISOString();

export type EntityType =
  | "review"
  | "review_mention"
  | "employee"
  | "employee_alias"
  | "department"
  | "spiff_rule"
  | "setting"
  | "reply_example";
export type LogAction = "create" | "update" | "delete" | "deactivate";

/** Either a literal id, or a SQL subquery that resolves the id inside the same batch. */
export type EntityRef = string | number | null | { sql: string; params: unknown[] };

export interface LogEntry {
  entity_type: EntityType;
  entity_id: EntityRef;
  action: LogAction;
  field?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  summary: string;
}

function asText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Builds a change_log INSERT for use inside the same db.batch() as the write it describes. */
export function logStmt(db: D1Database, user: string, e: LogEntry, at = nowIso()): D1PreparedStatement {
  const ref = e.entity_id;
  const idSql = ref !== null && typeof ref === "object" ? `CAST(${ref.sql} AS TEXT)` : "?";
  const idParams = ref !== null && typeof ref === "object" ? ref.params : [ref === null ? null : String(ref)];
  return db
    .prepare(
      `INSERT INTO change_log (at, user_email, entity_type, entity_id, action, field, old_value, new_value, summary)
       VALUES (?, ?, ?, ${idSql}, ?, ?, ?, ?, ?)`,
    )
    .bind(at, user, e.entity_type, ...idParams, e.action, e.field ?? null, asText(e.old_value), asText(e.new_value), e.summary);
}

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of results) {
    if (!(SETTING_KEYS as string[]).includes(row.key)) continue;
    try {
      const parsed = JSON.parse(row.value);
      const shape = SettingsSchema.shape[row.key as keyof Settings];
      const r = shape.safeParse(parsed);
      if (r.success) out[row.key] = r.data;
    } catch {
      /* keep default */
    }
  }
  return out as Settings;
}

/** `?, ?, ?` for an IN (...) list. */
export const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export const bool = (v: number | boolean | null | undefined) => v === 1 || v === true;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash used for the "same review text" duplicate check. Case- and whitespace-insensitive. */
export async function reviewHash(reviewText: string): Promise<string | null> {
  const norm = reviewText.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm.length < 10) return null;
  return sha256Hex(norm);
}
