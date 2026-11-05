import { describe, expect, it } from "vitest";
import { handleRewrite } from "../worker/rewrite";
import { envWith, freshDb } from "./d1-shim";

const RID = (n: number) => "1000000" + n + "-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = (n: number, instructions = "Make it less generic.") => ({
  request_id: RID(n),
  review_raw: "Rose\n\nOscar and Tagon were great at explaining the repair.",
  posted_date: "2026-11-05",
  current_reply: "Thanks Rose! Oscar and Tagon will love to hear this.",
  instructions,
});
const response = (value: unknown) =>
  new Response(JSON.stringify({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
    usage: { input_tokens: 40, output_tokens: 20 },
  }), { status: 200 });

function script(...values: unknown[]) {
  const requests: any[] = [];
  const fn = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return response(values[Math.min(requests.length - 1, values.length - 1)]);
  }) as unknown as typeof fetch;
  return { fn, requests };
}

describe("POST /api/rewrite", () => {
  it("returns only a new reply; includes existing reply and optional instructions", async () => {
    const db = freshDb();
    const s = script({ reply_text: "Rose, thank you for recognizing Oscar and Tagon!" });
    const result = await handleRewrite(envWith(db), "a@example.com", input(1), { fetchFn: s.fn });
    expect(result.reply_text).toContain("Rose");
    expect(s.requests).toHaveLength(1);
    const call = s.requests[0];
    expect(call.text.format.schema.required).toEqual(["reply_text"]);
    expect(call.text.format.name).toBe("review_rewrite");
    expect(call.store).toBe(false);
    expect(call.input[1].content).toContain("Make it less generic");
    expect(call.input[1].content).toContain("Thanks Rose! Oscar and Tagon");
    expect(call.input[1].content).not.toContain("employee_directory");
    const row = await db.prepare("SELECT status, attempt_count FROM ai_requests WHERE request_id = ?").bind(RID(1)).first<any>();
    expect(row).toEqual({ status: "succeeded", attempt_count: 1 });
  });

  it("returns cached result without a second OpenAI request", async () => {
    const db = freshDb();
    const s = script({ reply_text: "Thanks, Rose. We're glad Oscar and Tagon helped." });
    const first = await handleRewrite(envWith(db), "a@example.com", input(2), { fetchFn: s.fn });
    const second = await handleRewrite(envWith(db), "a@example.com", input(2), { fetchFn: s.fn });
    expect(second).toEqual(first);
    expect(s.requests).toHaveLength(1);
  });

  it("allows empty one-time instructions for a fresh variation", async () => {
    const s = script({ reply_text: "Rose, it's wonderful to hear about your experience!" });
    await handleRewrite(envWith(freshDb()), "a@example.com", input(3, ""), { fetchFn: s.fn });
    expect(JSON.parse(s.requests[0].input[1].content).additional_instructions).toBe("");
  });

  it("rejects invalid output after at most two attempts", async () => {
    const db = freshDb();
    const s = script({ reply_text: "" }, { reply_text: "" });
    await expect(handleRewrite(envWith(db), "a@example.com", input(4), { fetchFn: s.fn })).rejects.toMatchObject({ status: 502 });
    expect(s.requests).toHaveLength(2);
    const row = await db.prepare("SELECT status, attempt_count FROM ai_requests WHERE request_id = ?").bind(RID(4)).first<any>();
    expect(row).toEqual({ status: "failed", attempt_count: 2 });
  });

  it("shares the analyze rate limit and cannot replay another person's request", async () => {
    const db = freshDb();
    await db.prepare("UPDATE settings SET value = '1' WHERE key = 'analyze_rate_limit_per_hour'").run();
    const s = script({ reply_text: "Thanks, Rose!" });
    await handleRewrite(envWith(db), "a@example.com", input(5), { fetchFn: s.fn });
    await expect(handleRewrite(envWith(db), "a@example.com", input(6), { fetchFn: s.fn })).rejects.toMatchObject({ status: 429 });
    await expect(handleRewrite(envWith(db), "b@example.com", input(5), { fetchFn: s.fn })).rejects.toMatchObject({ status: 409 });
    expect(s.requests).toHaveLength(1);
  });

  it("blocks concurrent repeats and accepts only valid one-time instructions", async () => {
    const db = freshDb();
    await db.prepare("INSERT INTO ai_requests (request_id, created_at, claimed_at, created_by, status) VALUES (?, ?, ?, ?, 'pending')")
      .bind(RID(7), new Date().toISOString(), new Date().toISOString(), "a@example.com").run();
    const s = script({ reply_text: "Thanks, Rose!" });
    await expect(handleRewrite(envWith(db), "a@example.com", input(7), { fetchFn: s.fn })).rejects.toMatchObject({ status: 409 });
    await expect(handleRewrite(envWith(db), "a@example.com", { ...input(8), instructions: "x".repeat(2001) }, { fetchFn: s.fn })).rejects.toMatchObject({ status: 400 });
    expect(s.requests).toHaveLength(0);
  });
});
