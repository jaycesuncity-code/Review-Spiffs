import type { DuplicateMatch } from "../shared/schemas";
import { placeholders, reviewHash } from "./db";

export interface DupInput {
  reviewText: string;
  customerName: string;
  employeeIds: number[];
  postedDate: string;
  excludeId?: number;
}

/**
 * Strong: another saved review has the same review_text hash.
 * Possible: same customer name (case-insensitive, trimmed) AND a shared employee AND posted within 45 days.
 */
export async function findDuplicates(db: D1Database, p: DupInput): Promise<DuplicateMatch[]> {
  const exclude = p.excludeId ?? 0;
  const found = new Map<number, DuplicateMatch["kind"]>();

  const hash = await reviewHash(p.reviewText);
  if (hash) {
    const { results } = await db.prepare("SELECT id FROM reviews WHERE review_hash = ? AND id != ? LIMIT 5").bind(hash, exclude).all<{ id: number }>();
    for (const r of results) found.set(r.id, "strong");
  }

  const name = p.customerName.trim();
  const ids = [...new Set(p.employeeIds)];
  if (name && ids.length) {
    const { results } = await db
      .prepare(
        `SELECT r.id FROM reviews r
         WHERE lower(trim(r.customer_name)) = lower(?) AND r.id != ?
           AND r.posted_date BETWEEN date(?, '-45 days') AND date(?, '+45 days')
           AND EXISTS (SELECT 1 FROM review_mentions m WHERE m.review_id = r.id AND m.employee_id IN (${placeholders(ids.length)}))
         LIMIT 5`,
      )
      .bind(name, exclude, p.postedDate, p.postedDate, ...ids)
      .all<{ id: number }>();
    for (const r of results) if (!found.has(r.id)) found.set(r.id, "possible");
  }

  if (found.size === 0) return [];
  const all = [...found.keys()];
  const [reviews, mentions] = await db.batch([
    db.prepare(`SELECT id, posted_date, customer_name FROM reviews WHERE id IN (${placeholders(all.length)})`).bind(...all),
    db
      .prepare(`SELECT review_id, employee_name_snapshot FROM review_mentions WHERE review_id IN (${placeholders(all.length)}) ORDER BY id`)
      .bind(...all),
  ]);
  const names = new Map<number, string[]>();
  for (const m of mentions.results as { review_id: number; employee_name_snapshot: string }[]) {
    names.set(m.review_id, [...(names.get(m.review_id) ?? []), m.employee_name_snapshot]);
  }
  return (reviews.results as { id: number; posted_date: string; customer_name: string }[])
    .map((r) => ({
      kind: found.get(r.id)!,
      review_id: r.id,
      posted_date: r.posted_date,
      customer_name: r.customer_name,
      employees: names.get(r.id) ?? [],
    }))
    .sort((a, b) => (a.kind === b.kind ? b.posted_date.localeCompare(a.posted_date) : a.kind === "strong" ? -1 : 1));
}
