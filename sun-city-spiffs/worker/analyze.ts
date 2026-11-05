// POST /api/analyze — idempotent, rate-limited, one retry max.
import { AiOutputSchema, AnalyzeBody, type AnalyzeResult } from "../shared/schemas";
import { pickBucket, wordCount } from "../shared/text";
import { cleanReviewPaste } from "./cleaner";
import { getSettings, nowIso, reviewHash } from "./db";
import { loadDirectory } from "./directory";
import type { Env } from "./env";
import { HttpError, parseWith } from "./http";
import { reconcileMentions } from "./matching";
import { callOpenAI, type OpenAiUsage } from "./openai";
import { buildUserMessage, FIXED_CONTRACT, pickExamples, type ExampleRow } from "./prompt";

export interface AnalyzeDeps {
  fetchFn?: typeof fetch;
  now?: () => Date;
  random?: () => number;
}

const IN_PROGRESS_MS = 90_000;

interface AiRequestRow {
  request_id: string;
  created_by: string;
  status: "pending" | "succeeded" | "failed";
  claimed_at: string;
  response_json: string | null;
}

/** Normalizes model text and enforces the reply rules. Returns an error string when invalid. */
function sanitizeReply(text: string): { text: string; error: string | null } {
  const cleaned = text
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return { text: cleaned, error: "Reply was empty" };
  if (cleaned.length > 1500) return { text: cleaned, error: "Reply was too long" };
  return { text: cleaned, error: null };
}

export async function handleAnalyze(env: Env, user: string, rawBody: unknown, deps: AnalyzeDeps = {}): Promise<AnalyzeResult> {
  const body = parseWith(AnalyzeBody, rawBody);
  const now = deps.now ?? (() => new Date());
  const db = env.DB;
  const settings = await getSettings(db);

  // 1. Idempotency: a request_id that already succeeded is answered from storage, never re-sent to OpenAI.
  const existing = await db
    .prepare("SELECT request_id, created_by, status, claimed_at, response_json FROM ai_requests WHERE request_id = ?")
    .bind(body.request_id)
    .first<AiRequestRow>();

  if (existing) {
    if (existing.created_by !== user) throw new HttpError(409, "This request id belongs to someone else. Start a new entry.");
    if (existing.status === "succeeded" && existing.response_json) return JSON.parse(existing.response_json) as AnalyzeResult;
    const age = now().getTime() - Date.parse(existing.claimed_at);
    if (existing.status === "pending" && age < IN_PROGRESS_MS) {
      throw new HttpError(409, "This review is already being processed. Give it a few seconds.", { code: "in_progress" });
    }
  }

  // 2. Rate limit per user (counted from ai_requests).
  const hourAgo = new Date(now().getTime() - 3_600_000).toISOString();
  const used = await db
    .prepare("SELECT COUNT(*) AS n FROM ai_requests WHERE created_by = ? AND created_at >= ? AND request_id != ?")
    .bind(user, hourAgo, body.request_id)
    .first<{ n: number }>();
  if ((used?.n ?? 0) >= settings.analyze_rate_limit_per_hour) {
    throw new HttpError(429, `Limit reached: ${settings.analyze_rate_limit_per_hour} AI requests per hour. Try again later or enter it manually.`);
  }

  // 3. Claim the row as pending (compare-and-set so two concurrent submits can't both call OpenAI).
  const claimedAt = now().toISOString();
  const cleaned = cleanReviewPaste(body.review_raw);
  const hash = await reviewHash(cleaned.text);
  if (existing) {
    const r = await db
      .prepare("UPDATE ai_requests SET status = 'pending', claimed_at = ?, error = NULL WHERE request_id = ? AND status = ? AND claimed_at = ?")
      .bind(claimedAt, body.request_id, existing.status, existing.claimed_at)
      .run();
    if (!r.meta.changes) throw new HttpError(409, "This review is already being processed.", { code: "in_progress" });
  } else {
    const r = await db
      .prepare(
        `INSERT INTO ai_requests (request_id, created_at, claimed_at, created_by, status, attempt_count, model, review_hash)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT(request_id) DO NOTHING`,
      )
      .bind(body.request_id, claimedAt, claimedAt, user, settings.model, hash)
      .run();
    if (!r.meta.changes) throw new HttpError(409, "This review is already being processed.", { code: "in_progress" });
  }

  const fail = async (message: string, attempts: number, usage: OpenAiUsage, status = 502): Promise<never> => {
    await db
      .prepare("UPDATE ai_requests SET status = 'failed', attempt_count = ?, input_tokens = ?, output_tokens = ?, error = ? WHERE request_id = ?")
      .bind(attempts, usage.input_tokens, usage.output_tokens, message.slice(0, 500), body.request_id)
      .run();
    throw new HttpError(status, message, { code: "ai_failed" });
  };

  if (!env.OPENAI_API_KEY) return fail("OPENAI_API_KEY is not set on the Worker. Use Enter manually for now.", 0, { input_tokens: 0, output_tokens: 0 }, 500);

  // 4. Build context.
  const reviewText = cleaned.text;
  const wc = wordCount(reviewText);
  const target = pickBucket(settings.length_buckets, wc);
  const [directory, exRes, recentRes] = await Promise.all([
    loadDirectory(db),
    db.prepare("SELECT id, customer_name, review_text, reply_text, word_count FROM reply_examples WHERE active = 1").all<ExampleRow>(),
    settings.recent_replies_count > 0
      ? db.prepare("SELECT reply_final_text FROM reviews ORDER BY created_at DESC, id DESC LIMIT ?").bind(settings.recent_replies_count).all<{ reply_final_text: string }>()
      : Promise.resolve({ results: [] as { reply_final_text: string }[] }),
  ]);
  const examples = pickExamples(exRes.results, settings.length_buckets, target.index, settings.examples_per_call, deps.random);
  const recent = recentRes.results.map((r) => r.reply_final_text);

  const system = `${settings.reply_instructions}\n\n${FIXED_CONTRACT}`;
  const userMsg = buildUserMessage({
    postedDate: body.posted_date,
    lengthTarget: target.bucket.label,
    wordCount: wc,
    directory,
    examples,
    recentReplies: recent,
    varietyWarning: settings.variety_warning,
    reviewRaw: body.review_raw,
  });

  // 5. Call OpenAI. At most one retry, only for network/5xx/invalid output.
  const usage: OpenAiUsage = { input_tokens: 0, output_tokens: 0 };
  let attempts = 0;
  let lastError = "Unknown error";
  let output: ReturnType<typeof AiOutputSchema.parse> | null = null;
  let reply = "";

  while (attempts < 2) {
    attempts++;
    const r = await callOpenAI({
      apiKey: env.OPENAI_API_KEY,
      model: settings.model,
      reasoningEffort: settings.reasoning_effort,
      system,
      user: userMsg,
      fetchFn: deps.fetchFn,
    });
    usage.input_tokens += r.usage.input_tokens;
    usage.output_tokens += r.usage.output_tokens;
    if (!r.ok) {
      lastError = r.error;
      if (r.retryable) continue;
      break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.text);
    } catch {
      lastError = "Model returned invalid JSON";
      continue;
    }
    const v = AiOutputSchema.safeParse(parsed);
    if (!v.success) {
      lastError = "Model output did not match the schema";
      continue;
    }
    const s = sanitizeReply(v.data.reply_text);
    if (s.error) {
      lastError = s.error;
      continue;
    }
    output = v.data;
    reply = s.text;
    break;
  }

  if (!output) return fail(lastError, attempts, usage);

  // 6. Server-side validation of mentions.
  const mentions = reconcileMentions(output.mentions, directory);
  const trimOrNull = (s: string | null) => (s && s.trim() ? s.trim().slice(0, 500) : null);

  const result: AnalyzeResult = {
    request_id: body.request_id,
    customer_name: trimOrNull(output.customer_name)?.slice(0, 200) ?? null,
    star_rating: output.star_rating,
    review_already_answered: output.review_already_answered || /response from the owner/i.test(body.review_raw),
    job_type_guess: output.job_type_guess,
    services_text: trimOrNull(output.services_text),
    needs_attention: output.needs_attention,
    attention_reason: output.needs_attention ? trimOrNull(output.attention_reason) : null,
    reply_text: reply,
    mentions,
    review_text: reviewText,
    cleaner_confident: cleaned.confident,
    word_count: wc,
    length_target: target.bucket.label,
    examples_used: examples.length,
    recent_used: recent.length,
    model: settings.model,
  };

  await db
    .prepare(
      `UPDATE ai_requests SET status = 'succeeded', attempt_count = ?, model = ?, input_tokens = ?, output_tokens = ?,
       example_ids_used = ?, response_json = ?, error = NULL WHERE request_id = ?`,
    )
    .bind(attempts, settings.model, usage.input_tokens, usage.output_tokens, JSON.stringify(examples.map((e) => e.id)), JSON.stringify(result), body.request_id)
    .run();

  return result;
}
