// Minimal D1Database stand-in on node:sqlite, so tests run the real migrations and SQL.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Param = string | number | bigint | null | Uint8Array;
const norm = (p: unknown): Param => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : (p as Param));

class FakeStmt {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly params: Param[] = [],
  ) {}
  bind(...p: unknown[]) {
    return new FakeStmt(this.db, this.sql, p.map(norm));
  }
  private returnsRows() {
    return /^\s*(select|with|pragma)\b/i.test(this.sql) || /\breturning\b/i.test(this.sql);
  }
  async first<T>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async all<T>() {
    return this.exec<T>();
  }
  async run() {
    return this.exec();
  }
  exec<T>() {
    const st = this.db.prepare(this.sql);
    if (this.returnsRows()) {
      const rows = st.all(...this.params).map((r) => ({ ...(r as object) })) as T[];
      return { results: rows, success: true, meta: { changes: 0, last_row_id: 0 } };
    }
    const r = st.run(...this.params);
    return { results: [] as T[], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export class FakeD1 {
  readonly sqlite: DatabaseSync;
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON;");
  }
  prepare(sql: string) {
    return new FakeStmt(this.sqlite, sql);
  }
  async batch(stmts: FakeStmt[]) {
    this.sqlite.exec("BEGIN");
    try {
      const out = stmts.map((s) => s.exec());
      this.sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql: string) {
    this.sqlite.exec(sql);
  }
}

export function freshDb(): D1Database {
  const db = new FakeD1();
  const dir = join(import.meta.dirname, "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.sqlite.exec(readFileSync(join(dir, f), "utf8"));
  }
  return db as unknown as D1Database;
}

export function envWith(db: D1Database, extra: Record<string, string> = {}) {
  return { DB: db, ASSETS: {} as Fetcher, ENVIRONMENT: "test", OPENAI_API_KEY: "sk-test", ...extra };
}

export async function empId(db: D1Database, fullName: string): Promise<number> {
  const r = await db.prepare("SELECT id FROM employees WHERE full_name = ?").bind(fullName).first<{ id: number }>();
  if (!r) throw new Error(`no employee ${fullName}`);
  return r.id;
}
