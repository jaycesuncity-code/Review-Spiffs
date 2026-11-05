import { describe, expect, it } from "vitest";
import { computeSpiffs, calculateSpiffs, type CalcEmployee, type RateRow } from "../worker/spiffs";
import { createReview, updateReview, loadReview, listReviews } from "../worker/routes/reviews";
import { createSpiffRule, updateDepartment } from "../worker/routes/directory";
import { freshDb, envWith, empId } from "./d1-shim";

const rates: { install: RateRow; service: RateRow } = {
  install: { spiff_type: "install", solo_amount_cents: 3000, shared_amount_cents: 3000, effective_from: "2020-01-01" },
  service: { spiff_type: "service", solo_amount_cents: 3000, shared_amount_cents: 1500, effective_from: "2020-01-01" },
};
let n = 0;
const emp = (type: CalcEmployee["spiff_type"], dept: string = type): CalcEmployee => ({ employee_id: ++n, employee_name: `E${n}`, department_name: dept, spiff_type: type });
const amounts = (r: ReturnType<typeof computeSpiffs>) => r.lines.map((l) => l.amount_cents);

describe("computeSpiffs (pure)", () => {
  it("1 service = $30", () => expect(amounts(computeSpiffs([emp("service")], rates))).toEqual([3000]));
  it("2 service = $15 each", () => expect(amounts(computeSpiffs([emp("service"), emp("service")], rates))).toEqual([1500, 1500]));
  it("3 service = $15 each", () => expect(amounts(computeSpiffs([emp("service"), emp("service"), emp("service")], rates))).toEqual([1500, 1500, 1500]));
  it("1 install = $30", () => expect(amounts(computeSpiffs([emp("install")], rates))).toEqual([3000]));
  it("2 install = $30 each", () => expect(amounts(computeSpiffs([emp("install"), emp("install")], rates))).toEqual([3000, 3000]));
  it("1 service + 1 install: service $15, install $30", () => expect(amounts(computeSpiffs([emp("service"), emp("install")], rates))).toEqual([1500, 3000]));
  it("Shop follows install rules", () => expect(amounts(computeSpiffs([emp("install", "Shop"), emp("service")], rates))).toEqual([3000, 1500]));
  it("1 service + 1 manager: service $30, manager $0 and listed", () => {
    const r = computeSpiffs([emp("service"), emp("none", "Managers")], rates);
    expect(amounts(r)).toEqual([3000, 0]);
    expect(r.counted_headcount).toBe(1);
    expect(r.lines[1].rule_note).toMatch(/Recognition only/);
  });
  it("manager only or nobody = $0", () => {
    expect(computeSpiffs([emp("none")], rates).total_cents).toBe(0);
    expect(computeSpiffs([], rates).total_cents).toBe(0);
  });
  it("rule notes explain the math", () => {
    const r = computeSpiffs([emp("service"), emp("service")], rates);
    expect(r.lines[0].rule_note).toBe("Service, 2 counted employees, $15.00 each");
    expect(computeSpiffs([emp("service")], rates).lines[0].rule_note).toBe("Service, 1 counted employee, $30.00");
  });
  it("counts the same person once", () => {
    const e = emp("service");
    expect(amounts(computeSpiffs([e, e], rates))).toEqual([3000]);
  });
});

const baseReview = (request_id: string, mentions: number[], posted_date = "2026-11-03") => ({
  request_id,
  customer_name: "Test Customer " + request_id.slice(0, 4),
  posted_date,
  review_raw: "raw " + request_id,
  review_text: "Great job by the crew, very professional " + request_id,
  reply_ai_text: null,
  reply_final_text: "Thank you!",
  star_rating: 5,
  job_type_guess: "service" as const,
  services_text: null,
  needs_attention: false,
  attention_reason: null,
  already_answered: false,
  mentions: mentions.map((employee_id) => ({ employee_id, mention_text: null })),
  acknowledge_duplicates: true,
});

describe("calculateSpiffs + saved snapshots (D1)", () => {
  it("uses seeded rates and departments", async () => {
    const db = freshDb();
    const r = await calculateSpiffs(db, "2026-11-03", [await empId(db, "Mundo Gonzalez"), await empId(db, "Aaron Ordaz"), await empId(db, "Jason Olguin")]);
    expect(r.lines.map((l) => [l.employee_name, l.amount_cents])).toEqual([
      ["Mundo Gonzalez", 3000],
      ["Aaron Ordaz", 1500],
      ["Jason Olguin", 0],
    ]);
  });

  it("a future-dated rate does not change reviews posted before it; rate/department edits never touch saved rows", async () => {
    const db = freshDb();
    const env = envWith(db);
    const aaron = await empId(db, "Aaron Ordaz");
    const saved = await createReview(env, "a@x.com", baseReview("11111111-1111-4111-8111-111111111111", [aaron], "2026-11-03"));
    expect(saved.review!.total_cents).toBe(3000);
    const other = await createReview(env, "a@x.com", baseReview("22222222-2222-4222-8222-222222222222", [await empId(db, "Mario Castro")], "2026-11-04"));

    await createSpiffRule(env, "a@x.com", { spiff_type: "service", solo_amount_cents: 5000, shared_amount_cents: 2500, effective_from: "2026-12-01" });
    expect((await calculateSpiffs(db, "2026-11-30", [aaron])).total_cents).toBe(3000);
    expect((await calculateSpiffs(db, "2026-12-01", [aaron])).total_cents).toBe(5000);

    // Department switch + rate change: saved review untouched
    await updateDepartment(env, "a@x.com", 5, { spiff_type: "none" });
    const again = await loadReview(db, saved.review!.id);
    expect(again!.total_cents).toBe(3000);
    expect(again!.mentions[0].spiff_type_snapshot).toBe("service");

    // Editing that review's employees recalculates only that review (now Plumbing Service = none)
    const upd = await updateReview(env, "a@x.com", saved.review!.id, {
      ...baseReview("x", [aaron, await empId(db, "Mundo Gonzalez")], "2026-11-03"),
      expected_updated_at: again!.updated_at,
    });
    expect(upd.review!.mentions.map((m) => m.amount_cents)).toEqual([0, 3000]);
    // The other review keeps the amount it was saved with.
    expect((await loadReview(db, other.review!.id))!.total_cents).toBe(3000);
  });

  it("month totals are computed by query", async () => {
    const db = freshDb();
    const env = envWith(db);
    await createReview(env, "a@x.com", baseReview("33333333-3333-4333-8333-333333333333", [await empId(db, "Aaron Ordaz"), await empId(db, "Mario Castro")]));
    await createReview(env, "a@x.com", baseReview("44444444-4444-4444-8444-444444444444", [await empId(db, "Aaron Ordaz")]));
    const m = await listReviews(db, "2026-11");
    expect(m.summary.count).toBe(2);
    expect(m.summary.total_cents).toBe(1500 + 1500 + 3000);
    expect(m.summary.per_employee.find((p) => p.name === "Aaron Ordaz")!.total_cents).toBe(4500);
    const cols = (db as any).sqlite.prepare("PRAGMA table_info(reviews)").all().map((c: any) => c.name);
    expect(cols).not.toContain("total_cents");
  });
});
