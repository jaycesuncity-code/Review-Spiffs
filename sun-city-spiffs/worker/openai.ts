// OpenAI Responses API call with strict Structured Outputs. Server-side only.

export const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "customer_name",
    "star_rating",
    "review_already_answered",
    "job_type_guess",
    "services_text",
    "needs_attention",
    "attention_reason",
    "reply_text",
    "mentions",
  ],
  properties: {
    customer_name: { type: ["string", "null"], description: "Reviewer's name from the top of the paste, or null." },
    star_rating: { type: ["integer", "null"], description: "1-5 only if the paste shows a star rating, else null." },
    review_already_answered: { type: "boolean", description: "True if the paste includes a response from the owner." },
    job_type_guess: { type: "string", enum: ["install", "service", "unknown"] },
    services_text: { type: ["string", "null"], description: "Services listed in the paste, e.g. 'Toilet repair'." },
    needs_attention: { type: "boolean" },
    attention_reason: { type: ["string", "null"] },
    reply_text: { type: "string", description: "The public company reply, plain text." },
    mentions: {
      type: "array",
      description: "Every employee named in the review. At most 12.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["mention_text", "candidate_employee_ids", "match_status"],
        properties: {
          mention_text: { type: "string", description: "The name exactly as written in the review." },
          candidate_employee_ids: { type: "array", items: { type: "integer" }, description: "Directory ids, most likely first." },
          match_status: { type: "string", enum: ["matched", "ambiguous", "not_found"] },
        },
      },
    },
  },
} as const;

/** A lighter structured output for reply-only regeneration. */
export const REWRITE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply_text"],
  properties: {
    reply_text: { type: "string", description: "The revised public company reply, plain text." },
  },
} as const;

export interface OpenAiUsage {
  input_tokens: number;
  output_tokens: number;
}

export type OpenAiResult =
  | { ok: true; text: string; usage: OpenAiUsage }
  | { ok: false; retryable: boolean; error: string; usage: OpenAiUsage };

export interface OpenAiCall {
  apiKey: string;
  model: string;
  reasoningEffort: string; // "" = do not send
  system: string;
  user: string;
  responseSchema?: typeof RESPONSE_SCHEMA | typeof REWRITE_RESPONSE_SCHEMA;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const ZERO: OpenAiUsage = { input_tokens: 0, output_tokens: 0 };

/** Reasoning effort only applies to reasoning model families (gpt-5*, o-series). */
export function supportsReasoning(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

export async function callOpenAI(c: OpenAiCall): Promise<OpenAiResult> {
  const body: Record<string, unknown> = {
    model: c.model,
    input: [
      { role: "system", content: c.system },
      { role: "user", content: c.user },
    ],
    text: { format: { type: "json_schema", name: c.responseSchema ? "review_rewrite" : "review_analysis", strict: true, schema: c.responseSchema ?? RESPONSE_SCHEMA } },
    max_output_tokens: 6000,
    store: false,
  };
  if (c.reasoningEffort && supportsReasoning(c.model)) body.reasoning = { effort: c.reasoningEffort };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.timeoutMs ?? 45_000);
  let res: Response;
  try {
    res = await (c.fetchFn ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, retryable: true, error: aborted ? "OpenAI timed out after 45 seconds" : "Network error reaching OpenAI", usage: ZERO };
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    clearTimeout(timer);
    return { ok: false, retryable: res.status >= 500, error: `OpenAI returned HTTP ${res.status} with an unreadable body`, usage: ZERO };
  }
  clearTimeout(timer);

  const usage: OpenAiUsage = {
    input_tokens: Number(data?.usage?.input_tokens ?? 0),
    output_tokens: Number(data?.usage?.output_tokens ?? 0),
  };

  if (!res.ok) {
    const msg = typeof data?.error?.message === "string" ? data.error.message : `HTTP ${res.status}`;
    return { ok: false, retryable: res.status >= 500, error: `OpenAI error: ${msg}`, usage };
  }

  if (data?.status === "incomplete") {
    return { ok: false, retryable: true, error: `OpenAI response incomplete (${data?.incomplete_details?.reason ?? "unknown"})`, usage };
  }

  for (const item of data?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part?.type === "refusal") return { ok: false, retryable: false, error: "The model declined to answer this review.", usage };
      if (part?.type === "output_text" && typeof part.text === "string") return { ok: true, text: part.text, usage };
    }
  }
  return { ok: false, retryable: true, error: "OpenAI response had no output text", usage };
}
