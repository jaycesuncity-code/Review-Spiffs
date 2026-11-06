import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  formatGeneratedAt,
  lastDayOfMonth,
  parsePeriodParams,
  periodError,
  periodRangeShort,
  periodSlug,
  periodTitle,
  type ExportPeriod,
} from "../shared/period";
import { buildReportModel, ReconcileError, type ReportData } from "../shared/report";
import { buildReportPdf, type PdfFonts } from "../src/export/pdf";
import { createReview, exportCsv, reportData } from "../worker/routes/reviews";
import { updateEmployee } from "../worker/routes/directory";
import { cleanFullName, resolveFullName } from "../worker/identity";
import { envWith, empId, freshDb } from "./d1-shim";

let seq = 0;
const rid = () => `${String(++seq).padStart(8, "0")}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
const review = (customer_name: string, posted_date: string, mentions: number[], star_rating: number | null = 5) => ({
  request_id: rid(),
  customer_name,
  posted_date,
  review_raw: `raw ${seq}`,
  review_text: `Great job ${seq} ${customer_name}`,
  reply_ai_text: null,
  reply_final_text: "Thank you!",
  star_rating,
  job_type_guess: "service" as const,
  services_text: null,
  needs_attention: false,
  attention_reason: null,
  already_answered: false,
  mentions: mentions.map((employee_id) => ({ employee_id, mention_text: null })),
  acknowledge_duplicates: true,
});

const month = (m: string): ExportPeriod => ({ kind: "month", month: m });
const range = (start: string, end: string): ExportPeriod => ({ kind: "range", start, end });
const csvText = async (r: Response) => ({ text: await r.text(), name: r.headers.get("content-disposition") });

const fonts: PdfFonts = {
  regular: readFileSync(join(import.meta.dirname, "../src/export/fonts/Figtree-Regular.ttf")),
  semibold: readFileSync(join(import.meta.dirname, "../src/export/fonts/Figtree-SemiBold.ttf")),
  bold: readFileSync(join(import.meta.dirname, "../src/export/fonts/Figtree-Bold.ttf")),
};

/** Set PDF_OUT=<dir> to keep the generated sample PDFs for visual print QA. */
function keep(name: string, bytes: Uint8Array) {
  const dir = process.env.PDF_OUT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
}

describe("reporting periods", () => {
  it("month bounds are inclusive and leap-year aware", () => {
    expect(lastDayOfMonth("2026-10")).toBe("2026-10-31");
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29");
    expect(lastDayOfMonth("2026-02")).toBe("2026-02-28");
  });

  it("titles read naturally without time-zone drift", () => {
    expect(periodTitle({ start: "2026-10-01", end: "2026-10-31" })).toBe("October 2026");
    expect(periodTitle({ start: "2026-10-15", end: "2026-11-05" })).toBe("October 15 – November 5, 2026");
    expect(periodTitle({ start: "2026-12-15", end: "2027-01-05" })).toBe("December 15, 2026 – January 5, 2027");
    expect(periodTitle({ start: "2026-10-03", end: "2026-10-17" })).toBe("October 3–17, 2026");
    expect(periodTitle({ start: "2026-10-01", end: "2026-10-01" })).toBe("October 1, 2026");
    expect(periodRangeShort({ start: "2026-10-01", end: "2026-10-31" })).toBe("Oct 1 – Oct 31, 2026");
  });

  it("filename slugs", () => {
    expect(periodSlug(month("2026-10"))).toBe("2026-10");
    expect(periodSlug(range("2026-10-15", "2026-11-05"))).toBe("2026-10-15_to_2026-11-05");
  });

  it("validates without swapping or normalizing", () => {
    expect(periodError("2026-11-05", "2026-10-15")).toMatch(/before/);
    expect(periodError("2026-02-30", "2026-03-01")).toMatch(/start date/);
    expect(periodError("2026-10-01", "")).toMatch(/both/);
    expect(periodError("2026-10-05", "2026-10-05")).toBeNull();
  });

  it("query params: exactly one form, rejected when ambiguous or incomplete", () => {
    const p = (q: string) => parsePeriodParams(new URLSearchParams(q));
    expect(p("month=2026-10")).toEqual({ ok: true, period: month("2026-10") });
    expect(p("start=2026-10-15&end=2026-11-05")).toEqual({ ok: true, period: range("2026-10-15", "2026-11-05") });
    for (const bad of ["", "month=2026-13", "month=2026-10&start=2026-10-01&end=2026-10-02", "start=2026-10-01", "end=2026-10-01", "start=2026-10-09&end=2026-10-01", "start=2026-02-31&end=2026-03-01", "month=2026-10&month=2026-11", "start=2026-10-01&start=2026-10-02&end=2026-10-03"]) {
      expect(p(bad).ok, bad).toBe(false);
    }
  });

  it("generation time is shown in America/Denver", () => {
    expect(formatGeneratedAt(new Date("2026-11-06T21:15:00Z"))).toBe("November 6, 2026 at 2:15 PM MST");
    expect(formatGeneratedAt(new Date("2026-07-01T05:30:00Z"))).toBe("June 30, 2026 at 11:30 PM MDT");
  });
});

describe("report data and CSV exports (D1)", () => {
  it("spec example: 2 reviews, one naming 3 people and one naming nobody → 2 and 3", async () => {
    const db = freshDb();
    const env = envWith(db);
    const ids = [await empId(db, "Aaron Ordaz"), await empId(db, "Mario Castro"), await empId(db, "Jason Olguin")];
    await createReview(env, "a@x.com", review("Pat Three", "2026-10-04", ids));
    await createReview(env, "a@x.com", review("Nobody Named", "2026-10-09", [], null));
    const model = buildReportModel(await reportData(db, month("2026-10")));
    expect(model.reviewCount).toBe(2);
    expect(model.mentionCount).toBe(3);
    const three = model.reviews.find((r) => r.customer_name === "Pat Three")!;
    expect(three.mentions.map((m) => [m.employee_name_snapshot, m.amount_cents])).toEqual([
      ["Aaron Ordaz", 1500],
      ["Mario Castro", 1500],
      ["Jason Olguin", 0],
    ]);
    expect(three.total_cents).toBe(3000);
    const none = model.reviews.find((r) => r.customer_name === "Nobody Named")!;
    expect(none.mentions).toEqual([]);
    expect(none.total_cents).toBe(0);
    expect(none.star_rating).toBeNull();
    expect(model.totalCents).toBe(3000);
    // Recognition-only $0 employee is still listed.
    expect(model.employees.find((e) => e.name === "Jason Olguin")).toMatchObject({ mentions: 1, total_cents: 0 });
    expect(model.departments.find((d) => d.name === "Managers")).toMatchObject({ mentions: 1, total_cents: 0 });
  });

  it("custom ranges are inclusive on both ends and can cross months and years", async () => {
    const db = freshDb();
    const env = envWith(db);
    const a = await empId(db, "Aaron Ordaz");
    for (const d of ["2026-12-14", "2026-12-15", "2026-12-31", "2027-01-01", "2027-01-05", "2027-01-06"]) await createReview(env, "a@x.com", review(`C ${d}`, d, [a]));
    const data = await reportData(db, range("2026-12-15", "2027-01-05"));
    expect(data.reviews.map((r) => r.posted_date)).toEqual(["2026-12-15", "2026-12-31", "2027-01-01", "2027-01-05"]);
    const list = await csvText(await exportCsv(db, range("2026-12-15", "2027-01-05"), "mentions"));
    expect(list.text.trim().split("\r\n").slice(1).map((l) => l.split(",")[0])).toEqual(["2026-12-15", "2026-12-31", "2027-01-01", "2027-01-05"]);
    expect(list.name).toBe('attachment; filename="spiff-mentions-2026-12-15_to_2027-01-05.csv"');
    const totals = await csvText(await exportCsv(db, range("2026-12-15", "2027-01-05"), "totals"));
    expect(totals.text).toBe("employee,department,mentions,total\r\nAaron Ordaz,Plumbing Service,4,120.00\r\n");
  });

  it("CSV shapes are unchanged: headers, one row per mention, one row per employee, injection-safe", async () => {
    const db = freshDb();
    const env = envWith(db);
    const ids = [await empId(db, "Aaron Ordaz"), await empId(db, "Mario Castro")];
    await createReview(env, "a@x.com", review("=HYPERLINK(\"x\")", "2026-10-02", ids));
    await createReview(env, "a@x.com", review("Smith, Jo", "2026-10-03", [ids[0]]));
    await createReview(env, "a@x.com", review("No One", "2026-10-04", []));
    const list = await csvText(await exportCsv(db, month("2026-10"), "mentions"));
    expect(list.name).toBe('attachment; filename="spiff-mentions-2026-10.csv"');
    expect(list.text).toBe(
      [
        "posted_date,customer,employee,department,type,amount",
        `2026-10-02,"'=HYPERLINK(""x"")",Aaron Ordaz,Plumbing Service,service,15.00`,
        `2026-10-02,"'=HYPERLINK(""x"")",Mario Castro,Plumbing Service,service,15.00`,
        `2026-10-03,"Smith, Jo",Aaron Ordaz,Plumbing Service,service,30.00`,
        "",
      ].join("\r\n"),
    );
    const totals = await csvText(await exportCsv(db, month("2026-10"), "totals"));
    expect(totals.name).toBe('attachment; filename="spiff-totals-2026-10.csv"');
    expect(totals.text).toBe("employee,department,mentions,total\r\nAaron Ordaz,Plumbing Service,2,45.00\r\nMario Castro,Plumbing Service,1,15.00\r\n");
    // A month and the identical explicit range give the same rows.
    const same = await csvText(await exportCsv(db, range("2026-10-01", "2026-10-31"), "mentions"));
    expect(same.text).toBe(list.text);
  });

  it("an empty period gives header-only CSVs and a zero report", async () => {
    const db = freshDb();
    expect((await csvText(await exportCsv(db, month("2031-01"), "mentions"))).text).toBe("posted_date,customer,employee,department,type,amount\r\n");
    expect((await csvText(await exportCsv(db, range("2031-01-01", "2031-03-01"), "totals"))).text).toBe("employee,department,mentions,total\r\n");
    const model = buildReportModel(await reportData(db, month("2031-01")));
    expect([model.reviewCount, model.mentionCount, model.totalCents, model.employees.length, model.departments.length]).toEqual([0, 0, 0, 0, 0]);
  });

  it("employee summary uses current names/departments; department subtotals use saved snapshots", async () => {
    const db = freshDb();
    const env = envWith(db);
    const aaron = await empId(db, "Aaron Ordaz");
    await createReview(env, "a@x.com", review("Before Move", "2026-10-02", [aaron]));
    // Aaron moves to HVAC Service (department 3) after the review was saved.
    const emp = await db.prepare("SELECT * FROM employees WHERE id = ?").bind(aaron).first<Record<string, unknown>>();
    await updateEmployee(env, "a@x.com", aaron, { full_name: emp!.full_name, department_id: 3, active: true, aliases: [] });
    const model = buildReportModel(await reportData(db, month("2026-10")));
    expect(model.employees[0]).toMatchObject({ name: "Aaron Ordaz", department: "HVAC Service", total_cents: 3000 });
    expect(model.departments).toEqual([{ name: "Plumbing Service", mentions: 1, total_cents: 3000 }]);
    expect(model.reviews[0].mentions[0].department_name_snapshot).toBe("Plumbing Service");
  });

  it("refuses to build a report whose parts don't reconcile", () => {
    const base: ReportData = {
      start: "2026-10-01",
      end: "2026-10-31",
      reviews: [{ id: 1, posted_date: "2026-10-02", customer_name: "A", star_rating: 5, mentions: [{ id: 1, employee_id: 1, employee_name_snapshot: "E", department_name_snapshot: "D", amount_cents: 3000 }] }],
      per_employee: [{ employee_id: 1, name: "E", department: "D", mentions: 1, total_cents: 3000 }],
      summary: { count: 1, mentions: 1, total_cents: 3000 },
    };
    expect(() => buildReportModel(base)).not.toThrow();
    expect(() => buildReportModel({ ...base, summary: { ...base.summary, total_cents: 2999 } })).toThrow(ReconcileError);
    expect(() => buildReportModel({ ...base, per_employee: [{ ...base.per_employee[0], mentions: 2 }] })).toThrow(ReconcileError);
    expect(() => buildReportModel({ ...base, reviews: [{ ...base.reviews[0], posted_date: "2026-11-01" }] })).toThrow(ReconcileError);
  });
});

describe("Prepared by: verified full name", () => {
  const userA = { email: "jayce@suncity.example", token: "token-a" };
  const userB = { email: "maria@suncity.example", token: "token-b" };
  const identityServer = (people: Record<string, { email: string; name?: string }>) =>
    (async (_url: string, init: RequestInit) => {
      const cookie = new Headers(init.headers).get("cookie") ?? "";
      const token = cookie.replace("CF_Authorization=", "");
      const p = people[token];
      return p ? new Response(JSON.stringify(p), { status: 200 }) : new Response("no", { status: 401 });
    }) as unknown as typeof fetch;
  const env = (extra: Record<string, string> = {}) => ({ ...envWith(freshDb()), ENVIRONMENT: "production", CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com", ...extra });

  it("two different signed-in people get their own names from the identity provider", async () => {
    const f = identityServer({ "token-a": { email: "Jayce@suncity.example", name: "Jayce Rivera" }, "token-b": { email: "maria@suncity.example", name: "Maria  Lopez" } });
    expect(await resolveFullName(env(), userA, f)).toBe("Jayce Rivera");
    expect(await resolveFullName(env(), userB, f)).toBe("Maria Lopez");
  });

  it("never takes a name that belongs to a different email", async () => {
    const f = identityServer({ "token-z": { email: "someone@else.example", name: "Someone Else" } });
    expect(await resolveFullName(env(), { email: "z@suncity.example", token: "token-z" }, f)).toBeNull();
  });

  it("never guesses from the email address", async () => {
    const f = identityServer({ "token-a": { email: "jayce@suncity.example" } });
    expect(await resolveFullName(env(), { ...userA, token: "token-a2" }, f)).toBeNull();
    expect(cleanFullName("jayce@suncity.example")).toBeNull();
    expect(cleanFullName("   ")).toBeNull();
  });

  it("the admin mapping (Worker secret) is keyed by the verified email only", async () => {
    const f = identityServer({});
    const e = env({ PREPARED_BY_NAMES: JSON.stringify({ "MARIA@suncity.example": "Maria Lopez" }) });
    expect(await resolveFullName(e, { ...userB, token: "t1" }, f)).toBe("Maria Lopez");
    expect(await resolveFullName(e, { ...userA, token: "t2" }, f)).toBeNull();
    expect(await resolveFullName(env({ PREPARED_BY_NAMES: "not json" }), { ...userB, token: "t3" }, f)).toBeNull();
  });

  it("dev name is only used for the local dev bypass", async () => {
    const f = identityServer({});
    expect(await resolveFullName(env({ ENVIRONMENT: "dev", DEV_USER_NAME: "Dev Tester" }), { email: "dev@x.com", token: null }, f)).toBe("Dev Tester");
    expect(await resolveFullName(env({ DEV_USER_NAME: "Dev Tester" }), { email: "dev@x.com", token: null }, f)).toBeNull();
    expect(await resolveFullName(env({ ENVIRONMENT: "dev", DEV_USER_NAME: "Dev Tester" }), { email: "dev@x.com", token: "real" }, f)).toBeNull();
  });

  it("/api/me ignores any name the caller tries to supply", async () => {
    const worker = (await import("../worker/index")).default;
    const e = { ...envWith(freshDb()), ENVIRONMENT: "dev", DEV_USER_EMAIL: "dev@x.com", DEV_USER_NAME: "Dev Tester" };
    const res = await worker.fetch(new Request("http://localhost/api/me?full_name=Mallory&prepared_by=Mallory", { headers: { "x-full-name": "Mallory" } }), e as never);
    expect(await res.json()).toMatchObject({ email: "dev@x.com", full_name: "Dev Tester" });
  });

  it("export endpoints reject bad periods with 400", async () => {
    const worker = (await import("../worker/index")).default;
    const e = { ...envWith(freshDb()), ENVIRONMENT: "dev", DEV_USER_EMAIL: "dev@x.com" };
    for (const q of ["kind=totals", "month=2026-10&start=2026-10-01&end=2026-10-31", "start=2026-10-31&end=2026-10-01", "start=2026-10-01"]) {
      expect((await worker.fetch(new Request(`http://localhost/api/export?${q}`), e as never)).status, q).toBe(400);
      expect((await worker.fetch(new Request(`http://localhost/api/report?${q}`), e as never)).status, q).toBe(400);
    }
    const ok = await worker.fetch(new Request("http://localhost/api/export?month=2026-10&kind=totals"), e as never);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });
});

describe("PDF report", () => {
  const meta = { preparedBy: "Jayce Rivera", generatedAt: "November 6, 2026 at 2:15 PM MST" };

  async function realisticMonth(db: D1Database, m: string, n: number) {
    const env = envWith(db);
    const { results } = await db.prepare("SELECT id FROM employees WHERE active = 1 ORDER BY id").all<{ id: number }>();
    const ids = results.map((r) => r.id);
    const customers = ["Maria Gonzalez", "Robert Chen", "Linda Martínez-Okafor", "James O'Brien", "Patricia Nguyen", "Michael Johnson", "Barbara Wilson-Kensington III", "D. R.", "Élodie Fournier", "Christopher Abernathy-Montgomery"];
    for (let i = 0; i < n; i++) {
      const k = i % 7 === 3 ? 0 : 1 + ((i * 5) % 4);
      const people = Array.from({ length: k }, (_, j) => ids[(i * 7 + j * 11) % ids.length]);
      const day = String(1 + ((i * 3) % 28)).padStart(2, "0");
      await createReview(env, "a@x.com", review(customers[i % customers.length], `${m}-${day}`, [...new Set(people)], i % 9 === 4 ? null : 5 - (i % 3 === 2 ? 1 : 0)));
    }
  }

  it("is US Letter portrait, multi-page for a big range, with consistent numbers", async () => {
    const db = freshDb();
    await realisticMonth(db, "2026-10", 120);
    const model = buildReportModel(await reportData(db, month("2026-10")));
    const bytes = await buildReportPdf(model, meta, fonts);
    keep("large-month.pdf", bytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    for (const p of pdf.getPages()) expect(p.getSize()).toEqual({ width: 612, height: 792 });
    expect(pdf.getAuthor()).toBe("Jayce Rivera");
    expect(model.employees.reduce((s, e) => s + e.mentions, 0)).toBe(model.mentionCount);
  });

  it("builds a valid one-page PDF for an empty period", async () => {
    const model = buildReportModel(await reportData(freshDb(), range("2031-01-01", "2031-01-31")));
    const bytes = await buildReportPdf(model, meta, fonts);
    keep("empty.pdf", bytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("small month and a custom cross-month range", async () => {
    const db = freshDb();
    const env = envWith(db);
    const ids = [await empId(db, "Aaron Ordaz"), await empId(db, "Mario Castro"), await empId(db, "Jason Olguin")];
    await createReview(env, "a@x.com", review("Pat Three", "2026-10-04", ids));
    await createReview(env, "a@x.com", review("Nobody Named", "2026-10-09", [], null));
    await createReview(env, "a@x.com", review("Kim Solo", "2026-11-02", [ids[1]], 4));
    keep("small-month.pdf", await buildReportPdf(buildReportModel(await reportData(db, month("2026-10"))), meta, fonts));
    keep("custom-range.pdf", await buildReportPdf(buildReportModel(await reportData(db, range("2026-10-03", "2026-11-05"))), { ...meta, preparedBy: "Maria Lopez" }, fonts));
  });

  it("never clips: a review with more mentions than fit on a page is split into labeled parts", async () => {
    const mentions = Array.from({ length: 140 }, (_, i) => ({
      id: i + 1,
      employee_id: i + 1,
      employee_name_snapshot: i === 0 ? "Bartholomew Maximiliano Fitzgerald-Montgomery de la Cruz" : `Employee ${i + 1}`,
      department_name_snapshot: i % 2 ? "HVAC New Construction" : "Plumbing Service",
      amount_cents: i % 5 === 0 ? 0 : 1500,
    }));
    const total = mentions.reduce((s, m) => s + m.amount_cents, 0);
    const data: ReportData = {
      start: "2026-10-01",
      end: "2026-10-31",
      reviews: [
        { id: 1, posted_date: "2026-10-05", customer_name: "A Very Long Customer Name That Needs Wrapping 😀 Ωμέγα", star_rating: null, mentions },
        { id: 2, posted_date: "2026-10-06", customer_name: "Zero Mentions", star_rating: 3, mentions: [] },
      ],
      per_employee: mentions.map((m) => ({ employee_id: m.employee_id, name: m.employee_name_snapshot, department: m.department_name_snapshot, mentions: 1, total_cents: m.amount_cents })),
      summary: { count: 2, mentions: mentions.length, total_cents: total },
    };
    const bytes = await buildReportPdf(buildReportModel(data), meta, fonts);
    keep("stress.pdf", bytes);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(4);
  });

  it("requires a Prepared by name", async () => {
    const model = buildReportModel(await reportData(freshDb(), month("2031-01")));
    await expect(buildReportPdf(model, { ...meta, preparedBy: " " }, fonts)).rejects.toThrow(/full name/);
  });
});
