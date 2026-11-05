// zod schemas for every API request/response body. Shared by the Worker and the UI.
import { z } from "zod";
import { isValidDate } from "./dates";

export const SpiffType = z.enum(["install", "service", "none"]);
export type SpiffType = z.infer<typeof SpiffType>;
export const RuleType = z.enum(["install", "service"]);
export const JobType = z.enum(["install", "service", "unknown"]);
export const MatchStatus = z.enum(["matched", "ambiguous", "not_found"]);

export const DateStr = z.string().refine(isValidDate, "Must be a valid YYYY-MM-DD date");
export const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a UUID");
const Id = z.number().int().positive();
const NullableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((s) => (s === null || s.trim() === "" ? null : s.trim()));

// ---------- Settings ----------
export const LengthBucketSchema = z.object({
  max_words: z.number().int().positive().nullable(),
  label: z.string().trim().min(1).max(200),
});

export const LengthBucketsSchema = z
  .array(LengthBucketSchema)
  .min(1)
  .max(10)
  .refine((b) => b[b.length - 1].max_words === null, "The last bucket must have no maximum (over N words)")
  .refine(
    (b) => b.slice(0, -1).every((x, i, arr) => x.max_words !== null && (i === 0 || x.max_words > (arr[i - 1].max_words ?? 0))),
    "Bucket maximums must increase and only the last may be open-ended",
  );

export const ReasoningEffort = z.enum(["", "none", "minimal", "low", "medium", "high"]);

export const SettingsSchema = z.object({
  reply_instructions: z.string().trim().min(1).max(8000),
  variety_warning: z.string().trim().max(2000),
  model: z.string().trim().min(1).max(100).regex(/^[\w.\-:]+$/, "Letters, numbers, dots, dashes only"),
  reasoning_effort: ReasoningEffort,
  recent_replies_count: z.number().int().min(0).max(10),
  examples_per_call: z.number().int().min(0).max(12),
  length_buckets: LengthBucketsSchema,
  analyze_rate_limit_per_hour: z.number().int().min(1).max(1000),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const SettingsPatch = SettingsSchema.partial();

// ---------- AI ----------
/** Exactly what the model must return (validated after strict structured output). */
export const AiOutputSchema = z.object({
  customer_name: z.string().nullable(),
  star_rating: z.number().int().min(1).max(5).nullable(),
  review_already_answered: z.boolean(),
  job_type_guess: JobType,
  services_text: z.string().nullable(),
  needs_attention: z.boolean(),
  attention_reason: z.string().nullable(),
  reply_text: z.string(),
  mentions: z.array(
    z.object({
      mention_text: z.string(),
      candidate_employee_ids: z.array(z.number().int()),
      match_status: MatchStatus,
    }),
  ),
});
export type AiOutput = z.infer<typeof AiOutputSchema>;

export const AnalyzeBody = z.object({
  request_id: Uuid,
  review_raw: z.string().min(1, "Paste a review first").max(20000),
  posted_date: DateStr,
});

export const EmployeeLite = z.object({
  id: z.number(),
  full_name: z.string(),
  department_id: z.number(),
  department_name: z.string(),
  spiff_type: SpiffType,
  active: z.boolean(),
});
export type EmployeeLite = z.infer<typeof EmployeeLite>;

export const AnalyzedMention = z.object({
  mention_text: z.string(),
  match_status: MatchStatus,
  candidates: z.array(EmployeeLite),
  note: z.string().nullable(),
});
export type AnalyzedMention = z.infer<typeof AnalyzedMention>;

export const AnalyzeResult = z.object({
  request_id: z.string(),
  customer_name: z.string().nullable(),
  star_rating: z.number().nullable(),
  review_already_answered: z.boolean(),
  job_type_guess: JobType,
  services_text: z.string().nullable(),
  needs_attention: z.boolean(),
  attention_reason: z.string().nullable(),
  reply_text: z.string(),
  mentions: z.array(AnalyzedMention),
  review_text: z.string(),
  cleaner_confident: z.boolean(),
  word_count: z.number(),
  length_target: z.string(),
  examples_used: z.number(),
  recent_used: z.number(),
  model: z.string(),
});
export type AnalyzeResult = z.infer<typeof AnalyzeResult>;

// ---------- Spiff calc ----------
export const CalcBody = z.object({
  posted_date: DateStr,
  employee_ids: z.array(Id).max(30),
  review_text: z.string().max(20000).optional(),
  review_raw: z.string().max(20000).optional(),
  customer_name: z.string().max(200).optional(),
  exclude_review_id: Id.optional(),
});

export const SpiffLine = z.object({
  employee_id: z.number(),
  employee_name: z.string(),
  department_name: z.string(),
  spiff_type: SpiffType,
  amount_cents: z.number(),
  rule_note: z.string(),
});
export type SpiffLine = z.infer<typeof SpiffLine>;

export const DuplicateMatch = z.object({
  kind: z.enum(["strong", "possible"]),
  review_id: z.number(),
  posted_date: z.string(),
  customer_name: z.string(),
  employees: z.array(z.string()),
});
export type DuplicateMatch = z.infer<typeof DuplicateMatch>;

export const CalcResult = z.object({
  lines: z.array(SpiffLine),
  total_cents: z.number(),
  counted_headcount: z.number(),
  duplicates: z.array(DuplicateMatch),
});
export type CalcResult = z.infer<typeof CalcResult>;

// ---------- Reviews ----------
export const MentionInput = z.object({
  employee_id: Id,
  mention_text: NullableText(200),
});

const ReviewFields = {
  customer_name: z.string().trim().min(1, "Customer name is required").max(200),
  posted_date: DateStr,
  review_raw: z.string().max(20000),
  review_text: z.string().max(20000),
  reply_ai_text: NullableText(4000),
  reply_final_text: z.string().trim().min(1, "Reply is required").max(3000),
  star_rating: z.number().int().min(1).max(5).nullable(),
  job_type_guess: JobType,
  services_text: NullableText(500),
  needs_attention: z.boolean(),
  attention_reason: NullableText(1000),
  already_answered: z.boolean(),
  mentions: z
    .array(MentionInput)
    .max(30)
    .refine((m) => new Set(m.map((x) => x.employee_id)).size === m.length, "The same employee is listed twice"),
  acknowledge_duplicates: z.boolean().default(false),
};

export const CreateReviewBody = z.object({ request_id: Uuid, ...ReviewFields });
export const UpdateReviewBody = z.object({ expected_updated_at: z.string().min(1), ...ReviewFields });
export type CreateReviewBody = z.input<typeof CreateReviewBody>;

export const ReviewMention = z.object({
  id: z.number(),
  employee_id: z.number(),
  employee_name_snapshot: z.string(),
  department_name_snapshot: z.string(),
  spiff_type_snapshot: SpiffType,
  mention_text: z.string().nullable(),
  amount_cents: z.number(),
  rule_note: z.string(),
});
export type ReviewMention = z.infer<typeof ReviewMention>;

export const Review = z.object({
  id: z.number(),
  customer_name: z.string(),
  posted_date: z.string(),
  review_raw: z.string(),
  review_text: z.string(),
  word_count: z.number(),
  reply_ai_text: z.string().nullable(),
  reply_final_text: z.string(),
  star_rating: z.number().nullable(),
  job_type_guess: JobType,
  services_text: z.string().nullable(),
  needs_attention: z.boolean(),
  attention_reason: z.string().nullable(),
  already_answered: z.boolean(),
  request_id: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string(),
  updated_at: z.string(),
  updated_by: z.string(),
  total_cents: z.number(),
  mentions: z.array(ReviewMention),
});
export type Review = z.infer<typeof Review>;

// ---------- Directory ----------
export const EmployeeCreateBody = z.object({
  full_name: z.string().trim().min(2, "Full name is required").max(100),
  department_id: Id,
  aliases: z.array(z.string().trim().min(2).max(100)).max(20).default([]),
});

export const EmployeeUpdateBody = z.object({
  full_name: z.string().trim().min(2).max(100).optional(),
  department_id: Id.optional(),
  active: z.boolean().optional(),
  aliases: z.array(z.string().trim().min(2).max(100)).max(20).optional(),
});

export const DepartmentUpdateBody = z.object({
  spiff_type: SpiffType.optional(),
  name: z.string().trim().min(2).max(100).optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
});

export const SpiffRuleCreateBody = z.object({
  spiff_type: RuleType,
  solo_amount_cents: z.number().int().min(0).max(1_000_000),
  shared_amount_cents: z.number().int().min(0).max(1_000_000),
  effective_from: DateStr,
});

export const ExampleBody = z.object({
  customer_name: NullableText(200),
  review_text: z.string().trim().min(1).max(10000),
  reply_text: z.string().trim().min(1).max(3000),
  active: z.boolean().default(true),
});
