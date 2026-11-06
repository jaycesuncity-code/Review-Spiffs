import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDate, isValidDate } from "../../shared/dates";
import { firstName, nameTokens, normalizeName } from "../../shared/names";
import type { AnalyzeResult, CalcResult, DuplicateMatch, EmployeeLite, Review, RewriteResult } from "../../shared/schemas";
import { formatCents, wordCount } from "../../shared/text";
import { api, ApiError, rewriteWithRetry } from "../api";
import { useDirectory } from "../directory";
import { cx, uuid } from "../lib";
import { Link } from "../router";
import { EmployeeChip, EmployeePicker } from "./EmployeePicker";
import { Bar, Caret, CountUp, Typed, useReveal, type RevealField } from "./reveal";
import { Banner, Button, Card, Confirm, CopyButton, inputCls, Modal, Spinner, useToast } from "./ui";

type JobType = "install" | "service" | "unknown";

export interface MentionRow {
  key: string;
  mention_text: string | null;
  status: "matched" | "ambiguous" | "not_found" | "manual";
  candidates: EmployeeLite[];
  selected: number | null;
  note: string | null;
}

export interface Draft {
  customer_name: string;
  posted_date: string;
  review_raw: string;
  review_text: string;
  reply_ai_text: string | null;
  reply_final_text: string;
  star_rating: number | null;
  job_type_guess: JobType;
  services_text: string | null;
  needs_attention: boolean;
  attention_reason: string | null;
  already_answered: boolean;
  mentions: MentionRow[];
  length_target: string | null;
  cleaner_confident: boolean;
}

export function draftFromAnalysis(r: AnalyzeResult, reviewRaw: string, postedDate: string): Draft {
  return {
    customer_name: r.customer_name ?? "",
    posted_date: postedDate,
    review_raw: reviewRaw,
    review_text: r.review_text,
    reply_ai_text: r.reply_text,
    reply_final_text: r.reply_text,
    star_rating: r.star_rating,
    job_type_guess: r.job_type_guess,
    services_text: r.services_text,
    needs_attention: r.needs_attention,
    attention_reason: r.attention_reason,
    already_answered: r.review_already_answered,
    length_target: r.length_target,
    cleaner_confident: r.cleaner_confident,
    mentions: r.mentions.map((m) => ({
      key: uuid(),
      mention_text: m.mention_text,
      status: m.match_status,
      candidates: m.candidates,
      selected: m.match_status === "matched" ? m.candidates[0]?.id ?? null : null,
      note: m.note,
    })),
  };
}

export function blankDraft(reviewRaw: string, reviewText: string, postedDate: string): Draft {
  return {
    customer_name: "",
    posted_date: postedDate,
    review_raw: reviewRaw,
    review_text: reviewText,
    reply_ai_text: null,
    reply_final_text: "",
    star_rating: null,
    job_type_guess: "unknown",
    services_text: null,
    needs_attention: false,
    attention_reason: null,
    already_answered: /response from the owner/i.test(reviewRaw),
    mentions: [],
    length_target: null,
    cleaner_confident: true,
  };
}

export function draftFromReview(r: Review): Draft {
  return {
    customer_name: r.customer_name,
    posted_date: r.posted_date,
    review_raw: r.review_raw,
    review_text: r.review_text,
    reply_ai_text: r.reply_ai_text,
    reply_final_text: r.reply_final_text,
    star_rating: r.star_rating,
    job_type_guess: r.job_type_guess,
    services_text: r.services_text,
    needs_attention: r.needs_attention,
    attention_reason: r.attention_reason,
    already_answered: r.already_answered,
    length_target: null,
    cleaner_confident: true,
    mentions: r.mentions.map((m) => ({
      key: uuid(),
      mention_text: m.mention_text,
      status: "manual",
      candidates: [],
      selected: m.employee_id,
      note: null,
    })),
  };
}

/** A card showing one value with Edit and Copy controls. */
function FieldCard({ label, value, display, copy, children, editing, setEditing }: { label: string; value: string; display?: ReactNode; copy?: boolean; children: ReactNode; editing: boolean; setEditing: (b: boolean) => void }) {
  return (
    <Card
      title={label}
      actions={
        <>
          {copy !== false && <CopyButton text={value} />}
          <Button size="sm" variant={editing ? "primary" : "secondary"} onClick={() => setEditing(!editing)}>
            {editing ? "Done" : "Edit"}
          </Button>
        </>
      }
    >
      {editing ? children : <div className="min-h-6 break-words whitespace-pre-wrap text-stone-900">{display ?? (value || <span className="text-stone-400">(empty)</span>)}</div>}
    </Card>
  );
}

interface Props {
  mode: "new" | "edit";
  initial: Draft;
  saveKey?: string; // request_id used for idempotent create
  reviewId?: number;
  expectedUpdatedAt?: string;
  onDraftChange?: (d: Draft) => void;
  onSaved: (review: Review) => void;
  onDeleted?: () => void;
  /** Play the typing reveal (fresh Generate only). Presentation only: the data is already complete. */
  reveal?: boolean;
  onRevealDone?: () => void;
}

/** The order fields fill in during the reveal: top to bottom as laid out on a phone. */
function revealFields(d: Draft): RevealField[] {
  const f: RevealField[] = [
    { key: "reply", text: d.reply_final_text },
    { key: "customer", text: d.customer_name },
    { key: "date", text: dateDisplay(d.posted_date) },
    { key: "rating" },
    { key: "review", text: d.review_text },
  ];
  if (d.services_text !== null) f.push({ key: "services", text: d.services_text });
  return f;
}

const dateDisplay = (date: string) => (isValidDate(date) ? formatDate(date) : date || "(not set)");

export function ReviewEditor({ mode, initial, saveKey, reviewId, expectedUpdatedAt, onDraftChange, onSaved, onDeleted, reveal, onRevealDone }: Props) {
  const { employees, byId } = useDirectory();
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial);
  const [editing, setEditing] = useState<Record<string, boolean>>(mode === "new" && !initial.customer_name ? { customer: true } : {});
  const [calc, setCalc] = useState<CalcResult | null>(null);
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ rowKey: string | null; query: string } | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenModal, setRegenModal] = useState(false);
  const [regenInstructions, setRegenInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [dupModal, setDupModal] = useState<DuplicateMatch[] | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const rv = useReveal(!!reveal, revealFields(initial), initial.mentions.length, onRevealDone);
  const replyTa = useRef<HTMLTextAreaElement>(null);
  // Screen readers get the finished draft once, not every typed character.
  const [announce] = useState(() => `Draft ready${initial.customer_name ? ` for ${initial.customer_name}` : ""}. Reply: ${initial.reply_final_text}`);

  // Hand the reply box over from the typing overlay to the real textarea without a jump, then settle at the top.
  useLayoutEffect(() => {
    const ta = replyTa.current;
    if (!rv.used || rv.stage !== "done" || !ta) return;
    ta.scrollTop = rv.replyScrollTop();
    if (!ta.scrollTop) return;
    const t = setTimeout(() => ta.scrollTo({ top: 0, behavior: "smooth" }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rv.stage]);

  const update = (patch: Partial<Draft>) =>
    setD((cur) => {
      const next = { ...cur, ...patch };
      onDraftChange?.(next);
      return next;
    });
  const setEdit = (k: string) => (b: boolean) => setEditing((e) => ({ ...e, [k]: b }));
  const setRow = (key: string, patch: Partial<MentionRow>) => update({ mentions: d.mentions.map((m) => (m.key === key ? { ...m, ...patch } : m)) });

  const selectedIds = d.mentions.map((m) => m.selected).filter((x): x is number => x !== null);
  const idsKey = selectedIds.join(",");

  // Live spiff preview + duplicate check from the same server function used at save time.
  useEffect(() => {
    if (!isValidDate(d.posted_date)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setCalcBusy(true);
      try {
        const r = await api<CalcResult>("/api/calc", {
          method: "POST",
          body: {
            posted_date: d.posted_date,
            employee_ids: selectedIds,
            review_text: d.review_text,
            customer_name: d.customer_name,
            ...(reviewId ? { exclude_review_id: reviewId } : {}),
          },
        });
        if (!cancelled) {
          setCalc(r);
          setCalcError(null);
        }
      } catch (e) {
        if (!cancelled) setCalcError(e instanceof Error ? e.message : "Could not calculate");
      } finally {
        if (!cancelled) setCalcBusy(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.posted_date, idsKey, d.customer_name, d.review_text, reviewId]);

  // ---------- Warnings ----------
  const confirmed = selectedIds.map((id) => byId(id)).filter(Boolean) as EmployeeLite[];
  const nameWarnings = useMemo(() => {
    const out: string[] = [];
    const reply = new Set(nameTokens(d.reply_final_text));
    if (!reply.size) return out;
    const confirmedFirst = new Set(confirmed.map((e) => normalizeName(firstName(e.full_name))));
    const customerFirst = normalizeName(firstName(d.customer_name));
    const flagged = new Set<string>();
    for (const e of employees) {
      if (!e.active) continue;
      const f = normalizeName(firstName(e.full_name));
      if (f.length < 3 || flagged.has(f) || confirmedFirst.has(f) || f === customerFirst) continue;
      if (reply.has(f)) {
        flagged.add(f);
        out.push(`The reply names “${firstName(e.full_name)}”, but no ${firstName(e.full_name)} is in the confirmed employee list.`);
      }
    }
    for (const row of d.mentions) {
      if (row.selected === null || !row.mention_text) continue;
      const e = byId(row.selected);
      if (!e) continue;
      const f = normalizeName(firstName(e.full_name));
      const written = nameTokens(row.mention_text);
      if (!reply.has(f) && !(written.length && written.every((t) => reply.has(t)))) {
        out.push(`The review names ${firstName(e.full_name)}, but the reply doesn’t mention them.`);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.reply_final_text, d.customer_name, idsKey, employees]);

  const jobWarning = useMemo(() => {
    if (d.job_type_guess === "unknown") return null;
    const counted = confirmed.filter((e) => e.spiff_type !== "none");
    if (!counted.length || counted.some((e) => e.spiff_type === d.job_type_guess)) return null;
    return `The AI guessed ${d.job_type_guess} work, but every mentioned employee is in a ${d.job_type_guess === "install" ? "service" : "install"} department. Double-check the people (this never blocks saving).`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.job_type_guess, idsKey, employees]);

  const unresolved = d.mentions.filter((m) => m.selected === null);
  const blockers: string[] = [];
  if (!d.reply_final_text.trim()) blockers.push("Add a company reply.");
  if (!d.customer_name.trim()) blockers.push("Enter the customer name.");
  if (!isValidDate(d.posted_date)) blockers.push("Pick a valid posted date.");
  for (const m of unresolved) blockers.push(`Choose who “${m.mention_text ?? "?"}” is, or tap Ignore.`);

  // ---------- Actions ----------
  const openRewrite = () => {
    setRegenInstructions("");
    setRegenModal(true);
  };

  const regenerate = async () => {
    if (regenBusy) return;
    const raw = d.review_raw.trim() || d.review_text.trim();
    if (!raw) return toast("There is no review text to generate from.", "error");
    setRegenBusy(true);
    try {
      const r = await rewriteWithRetry<RewriteResult>({
        request_id: uuid(),
        review_raw: raw,
        posted_date: isValidDate(d.posted_date) ? d.posted_date : new Date().toISOString().slice(0, 10),
        current_reply: d.reply_final_text,
        instructions: regenInstructions,
      });
      update({ reply_final_text: r.reply_text, reply_ai_text: r.reply_text, length_target: r.length_target });
      setRegenModal(false);
      setRegenInstructions("");
      toast("New reply generated");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not regenerate", "error");
    } finally {
      setRegenBusy(false);
    }
  };

  const save = async (ack = false) => {
    if (savingRef.current || blockers.length) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const payload = {
      customer_name: d.customer_name.trim(),
      posted_date: d.posted_date,
      review_raw: d.review_raw,
      review_text: d.review_text,
      reply_ai_text: d.reply_ai_text,
      reply_final_text: d.reply_final_text.trim(),
      star_rating: d.star_rating,
      job_type_guess: d.job_type_guess,
      services_text: d.services_text,
      needs_attention: d.needs_attention,
      attention_reason: d.attention_reason,
      already_answered: d.already_answered,
      mentions: d.mentions.filter((m) => m.selected !== null).map((m) => ({ employee_id: m.selected!, mention_text: m.mention_text })),
      acknowledge_duplicates: ack,
    };
    try {
      const r =
        mode === "new"
          ? await api<{ review: Review }>("/api/reviews", { method: "POST", body: { request_id: saveKey, ...payload } })
          : await api<{ review: Review }>(`/api/reviews/${reviewId}`, { method: "PUT", body: { expected_updated_at: expectedUpdatedAt, ...payload } });
      setDupModal(null);
      onSaved(r.review);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.code === "duplicate") setDupModal(e.data.duplicates as DuplicateMatch[]);
      else if (e instanceof ApiError && e.status === 409 && e.data.code === "stale") setStale(e.message);
      else setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api(`/api/reviews/${reviewId}`, { method: "DELETE" });
      toast("Entry deleted");
      onDeleted?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Delete failed", "error");
      setDeleting(false);
    }
  };

  const pick = (emp: EmployeeLite) => {
    if (!picker) return;
    if (picker.rowKey) setRow(picker.rowKey, { selected: emp.id });
    else update({ mentions: [...d.mentions, { key: uuid(), mention_text: null, status: "manual", candidates: [], selected: emp.id, note: null }] });
    setPicker(null);
  };

  const replyWords = wordCount(d.reply_final_text);
  const lineFor = (id: number) => calc?.lines.find((l) => l.employee_id === id);

  // ---------- Render ----------
  const replyCard = (
    <Card
      className="order-1"
      title="Company reply"
      actions={
        <Button size="sm" onClick={openRewrite} disabled={regenBusy}>
          {regenBusy ? <Spinner /> : "↻"} Regenerate
        </Button>
      }
    >
      {rv.active ? (
        // An empty twin of the textarea below holds the exact box; the text is typed over it, then the real textarea takes over.
        <ReplyBox scrollRef={rv.scrollRef("reply")}>
          <span ref={rv.textRef("reply")} />
          <Caret ref={rv.caretRef("reply")} />
        </ReplyBox>
      ) : (
        <textarea
          ref={replyTa}
          className={cx(inputCls, "min-h-44 leading-relaxed")}
          value={d.reply_final_text}
          onChange={(e) => update({ reply_final_text: e.target.value })}
          placeholder="Type or generate the public reply…"
          aria-label="Company reply"
        />
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-500">
          {replyWords} words{d.length_target ? ` · target: ${d.length_target}` : ""}
        </p>
        <CopyButton text={d.reply_final_text} label="Copy reply" size="lg" variant="primary" className="w-full sm:w-auto" />
      </div>
      {nameWarnings.length > 0 && (
        <div className={cx("mt-3 space-y-1", rv.active ? "reveal-hold" : rv.used && "reveal-show")}>
          {nameWarnings.map((w) => (
            <Banner key={w} tone="warn">
              {w}
            </Banner>
          ))}
        </div>
      )}
    </Card>
  );

  const reviewCard = (
    <FieldCard label="Review text" value={d.review_text} display={rv.active ? <Typed rv={rv} k="review" text={d.review_text} /> : undefined} copy editing={!!editing.review} setEditing={setEdit("review")}>
      <textarea className={cx(inputCls, "min-h-40")} value={d.review_text} onChange={(e) => update({ review_text: e.target.value })} />
    </FieldCard>
  );

  return (
    <div className="pb-48" inert={rv.active} aria-busy={rv.active || undefined}>
      <p className="sr-only" role="status">
        {rv.used && rv.stage === "done" ? announce : ""}
      </p>
      <div className={cx("flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start", rv.active && "reveal-pulse")}>
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          {replyCard}
          <div className="order-9">{reviewCard}</div>
          {d.services_text !== null && (
            <div className="order-9">
              <FieldCard label="Services" value={d.services_text ?? ""} display={rv.active ? <Typed rv={rv} k="services" text={d.services_text ?? ""} /> : undefined} editing={!!editing.services} setEditing={setEdit("services")}>
                <input className={inputCls} value={d.services_text ?? ""} onChange={(e) => update({ services_text: e.target.value })} />
              </FieldCard>
            </div>
          )}
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <div className="order-2">
            <FieldCard label="Customer name" value={d.customer_name} display={rv.active ? <Typed rv={rv} k="customer" text={d.customer_name} /> : undefined} editing={!!editing.customer} setEditing={setEdit("customer")}>
              <input className={inputCls} value={d.customer_name} onChange={(e) => update({ customer_name: e.target.value })} autoComplete="off" placeholder="Customer name" />
            </FieldCard>
          </div>

          <div className="order-3">
            <FieldCard label="Posted date" value={d.posted_date} display={<Typed rv={rv} k="date" text={dateDisplay(d.posted_date)} />} editing={!!editing.date} setEditing={setEdit("date")}>
              <input type="date" className={inputCls} value={d.posted_date} onChange={(e) => update({ posted_date: e.target.value })} />
            </FieldCard>
          </div>

          <Card className="order-4" title="Rating & job type">
            <div ref={rv.fadeRef("rating")} className={cx("grid grid-cols-2 gap-3", rv.used && "reveal-show")} style={rv.active ? { opacity: 0 } : undefined}>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-stone-700">Stars</span>
                <select className={inputCls} value={d.star_rating ?? ""} onChange={(e) => update({ star_rating: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Unknown</option>
                  {[5, 4, 3, 2, 1].map((s) => (
                    <option key={s} value={s}>
                      {"★".repeat(s)} ({s})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-stone-700">Job type guess</span>
                <select className={inputCls} value={d.job_type_guess} onChange={(e) => update({ job_type_guess: e.target.value as JobType })}>
                  <option value="unknown">Unknown</option>
                  <option value="service">Service</option>
                  <option value="install">Install</option>
                </select>
              </label>
            </div>
            {jobWarning && (
              <div className="mt-3">
                <Banner tone="warn">{jobWarning}</Banner>
              </div>
            )}
          </Card>

          <Card
            className="order-5"
            title="Employees mentioned"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setPicker({ rowKey: null, query: "" })}>
                + Add another employee
              </Button>
            }
          >
            {d.mentions.length === 0 && <p className="text-stone-600">No employees mentioned, no spiff. You can still save.</p>}
            <ul className="space-y-3">
              {d.mentions.map((m, i) => {
                const sel = m.selected !== null ? byId(m.selected) ?? m.candidates.find((c) => c.id === m.selected) : undefined;
                const takenElsewhere = (id: number) => d.mentions.some((o) => o.key !== m.key && o.selected === id);
                return (
                  <li
                    key={m.key}
                    className={cx("rounded-xl p-3 ring-1", m.selected === null ? "bg-amber-50 ring-amber-300" : "bg-stone-50 ring-stone-200", rv.active && (rv.stage === "typing" ? "opacity-0" : "reveal-pop"))}
                    style={rv.active && rv.stage !== "typing" ? { animationDelay: `${Math.min(i, 4) * 70}ms` } : undefined}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-stone-600">
                        {m.mention_text ? (
                          <>
                            Review says <span className="font-semibold text-stone-900">“{m.mention_text}”</span>
                          </>
                        ) : (
                          "Added manually"
                        )}
                      </p>
                      <Button size="sm" variant="ghost" onClick={() => update({ mentions: d.mentions.filter((x) => x.key !== m.key) })}>
                        {m.mention_text ? "Ignore, not an employee" : "Remove"}
                      </Button>
                    </div>
                    {sel ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <EmployeeChip
                          name={sel.full_name}
                          department={sel.department_name}
                          amount={lineFor(sel.id) ? formatCents(lineFor(sel.id)!.amount_cents) : undefined}
                          selected
                          onClick={() => (m.candidates.length > 1 ? setRow(m.key, { selected: null }) : setPicker({ rowKey: m.key, query: m.mention_text ?? "" }))}
                        />
                        <span className="text-sm text-stone-500">Tap to change</span>
                      </div>
                    ) : m.candidates.length > 0 ? (
                      <>
                        <p className="mb-2 text-sm font-medium text-amber-900">{m.note ?? "Which one did they mean?"}</p>
                        <div className="flex flex-wrap gap-2">
                          {m.candidates.map((c) => (
                            <EmployeeChip key={c.id} name={c.full_name} department={c.department_name} onClick={() => setRow(m.key, { selected: c.id })} disabled={takenElsewhere(c.id)} />
                          ))}
                          <Button size="sm" onClick={() => setPicker({ rowKey: m.key, query: "" })}>
                            None of these
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-amber-900">Not found in the directory.</p>
                        <Button size="sm" variant="primary" onClick={() => setPicker({ rowKey: m.key, query: "" })}>
                          Search or add employee
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="order-6" title="Spiff preview" actions={calcBusy && !rv.active ? <Spinner className="text-stone-400" /> : null}>
            <div className={cx(rv.active && (rv.stage === "typing" || rv.stage === "chips") ? "reveal-hold" : rv.used && "reveal-show")}>
            {calcError && <Banner tone="error">{calcError}</Banner>}
            {!calc || calc.lines.length === 0 ? (
              <p className="text-stone-600">{selectedIds.length ? "Calculating…" : "No employees selected. Total $0.00."}</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {calc.lines.map((l) => (
                  <li key={l.employee_id} className="flex items-start justify-between gap-3 py-2">
                    <div>
                      <p className="font-bold">{l.employee_name}</p>
                      <p className="text-sm text-stone-500">{l.rule_note}</p>
                    </div>
                    <p className="font-semibold tabular-nums">{formatCents(l.amount_cents)}</p>
                  </li>
                ))}
              </ul>
            )}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-stone-200 pt-2 text-lg font-bold">
              <span>Review total</span>
              <span className="text-brand tabular-nums">
                <CountUp value={calc ? calc.total_cents : null} run={rv.stage === "count"} format={formatCents} />
              </span>
            </div>
          </Card>

          {(calc?.duplicates.length || d.already_answered || d.needs_attention || !d.cleaner_confident) && (
            <Card className={cx("order-7", rv.active ? "reveal-hold" : rv.used && "reveal-show")} title="Warnings">
              <div className="space-y-2">
                {calc?.duplicates.map((dup) => (
                  <Banner key={dup.review_id} tone={dup.kind === "strong" ? "error" : "warn"}>
                    <strong>{dup.kind === "strong" ? "Same review text already saved: " : "Possible duplicate: "}</strong>
                    <Link to={`/entry/${dup.review_id}`} className="underline">
                      {dup.customer_name}, {formatDate(dup.posted_date)}
                    </Link>
                    {dup.employees.length ? ` (${dup.employees.join(", ")})` : ""}
                  </Banner>
                ))}
                {d.already_answered && <Banner tone="warn">This review may already have an owner response.</Banner>}
                {d.needs_attention && (
                  <Banner tone="error">
                    <strong>Needs a closer look:</strong> {d.attention_reason ?? "Negative, unusual or sensitive review."}
                  </Banner>
                )}
                {!d.cleaner_confident && <Banner tone="info">Couldn’t separate the review from Google’s page text. Check the review text below.</Banner>}
              </div>
            </Card>
          )}
        </div>
      </div>

      {mode === "edit" && (
        <div className="mt-6 flex justify-center">
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete entry
          </Button>
        </div>
      )}

      {/* Sticky action bar */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-3 pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto max-w-6xl">
          {saveError && (
            <div className="mb-2">
              <Banner tone="error">{saveError}</Banner>
            </div>
          )}
          {blockers.length > 0 && (
            <ul className={cx("mb-2 space-y-0.5 text-sm text-amber-900", rv.active ? "reveal-hold" : rv.used && "reveal-show")}>
              {blockers.slice(0, 3).map((b) => (
                <li key={b}>• {b}</li>
              ))}
              {blockers.length > 3 && <li>• …and {blockers.length - 3} more</li>}
            </ul>
          )}
          <Button variant="primary" size="xl" className="w-full" disabled={blockers.length > 0 || saving || rv.active} onClick={() => save(false)}>
            {saving && <Spinner />}
            {mode === "new" ? "Add all to records" : "Save changes"}
            {calc && !saving ? <span className="font-semibold opacity-80">· {formatCents(calc.total_cents)}</span> : null}
          </Button>
        </div>
      </div>

      <EmployeePicker
        open={!!picker}
        title={picker?.rowKey ? "Who did they mean?" : "Add another employee"}
        initialQuery={picker?.query}
        excludeIds={selectedIds}
        onClose={() => setPicker(null)}
        onPick={pick}
      />

      <Modal
        open={regenModal}
        onClose={() => { if (!regenBusy) setRegenModal(false); }}
        title="Refine company reply"
        footer={
          <>
            <Button onClick={() => setRegenModal(false)} disabled={regenBusy}>Cancel</Button>
            <Button variant="primary" onClick={regenerate} disabled={regenBusy}>
              {regenBusy && <Spinner />} Generate new reply
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm font-medium text-stone-700">Current reply (for reference)</p>
            <div className="max-h-48 min-h-20 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-800">
              {d.reply_final_text || "(No reply yet)"}
            </div>
          </div>
          <div>
            <label htmlFor="regen-instructions" className="mb-1 block text-sm font-medium text-stone-700">
              Additional instructions (optional)
            </label>
            <textarea
              id="regen-instructions"
              className={cx(inputCls, "min-h-32 leading-relaxed")}
              value={regenInstructions}
              onChange={(e) => setRegenInstructions(e.target.value)}
              maxLength={2000}
              disabled={regenBusy}
              placeholder="E.g. Make it more personal, cut the generic opening, and keep the employee names."
            />
            <p className="mt-1 text-xs text-stone-500">Leave blank for a fresh alternative. Your saved instructions remain unchanged.</p>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!dupModal}
        onClose={() => setDupModal(null)}
        title="This might be a duplicate"
        footer={
          <>
            <Button onClick={() => setDupModal(null)}>Go back</Button>
            <Button variant="primary" onClick={() => save(true)} disabled={saving}>
              {saving && <Spinner />} Save anyway
            </Button>
          </>
        }
      >
        <ul className="space-y-2">
          {dupModal?.map((dup) => (
            <li key={dup.review_id}>
              <Banner tone={dup.kind === "strong" ? "error" : "warn"}>
                <strong>{dup.kind === "strong" ? "Same review text: " : "Same customer + employee within 45 days: "}</strong>
                {dup.customer_name}, {formatDate(dup.posted_date)}
                {dup.employees.length ? ` (${dup.employees.join(", ")})` : ""}{" "}
                <Link to={`/entry/${dup.review_id}`} className="underline">
                  Open
                </Link>
              </Banner>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal open={!!stale} onClose={() => setStale(null)} title="Someone else changed this entry" footer={<Button variant="primary" onClick={() => location.reload()}>Reload</Button>}>
        <p>{stale}</p>
      </Modal>

      <Confirm
        open={confirmDelete}
        title="Delete this entry?"
        message="This removes the review and its spiffs from the records. The change log keeps a full copy."
        confirmLabel="Delete entry"
        danger
        busy={deleting}
        onConfirm={doDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/** The reply textarea's exact box (same element, empty and read-only) with content laid over its text area. */
function ReplyBox({ children, scrollRef }: { children: ReactNode; scrollRef?: (el: HTMLElement | null) => void }) {
  return (
    <div className="relative" aria-hidden>
      <textarea className={cx(inputCls, "min-h-44 leading-relaxed")} value="" readOnly tabIndex={-1} />
      <div ref={scrollRef} className="absolute inset-x-0 top-0 h-44 overflow-hidden border border-transparent px-3.5 py-2.5 text-base leading-relaxed break-words whitespace-pre-wrap text-stone-900">
        {children}
      </div>
    </div>
  );
}

// ---------- Loading skeleton ----------
// Mirrors the ReviewEditor layout above (same cards, order classes and box sizes) so nothing jumps
// when the editor takes over. Intro phases are pure CSS: silhouettes → card chrome → labels (~0.9s).

function SkelCard({ title, actions, className, children }: { title: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cx("relative", className)}>
      <div className="skel-silhouette absolute inset-0 rounded-2xl" aria-hidden />
      <div className="skel-chrome relative">
        <Card title={<span className="skel-label">{title}</span>} actions={actions ? <span className="skel-label flex flex-wrap items-center gap-2">{actions}</span> : undefined}>
          {children}
        </Card>
      </div>
    </div>
  );
}

const SkelLabel = ({ children }: { children: ReactNode }) => <span className="skel-label mb-1 block text-sm font-semibold text-stone-700">{children}</span>;

export function ReviewEditorSkeleton() {
  return (
    <div className="pb-48" inert aria-busy="true">
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <SkelCard
            className="order-1"
            title="Company reply"
            actions={
              <Button size="sm" tabIndex={-1}>
                ↻ Regenerate
              </Button>
            }
          >
            {/* Reserved at the textarea's exact height; the caret says "writing", not "stuck". */}
            <ReplyBox>
              <Caret blink />
            </ReplyBox>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex h-5 items-center">
                <Bar className="h-3.5 w-28" />
              </span>
              <Button size="lg" variant="primary" className="skel-label w-full sm:w-auto" tabIndex={-1}>
                Copy reply
              </Button>
            </div>
          </SkelCard>
          <div className="order-9">
            <SkelCard
              title="Review text"
              actions={
                <>
                  <Button size="sm" tabIndex={-1}>Copy</Button>
                  <Button size="sm" tabIndex={-1}>Edit</Button>
                </>
              }
            >
              <div className="space-y-2.5 py-0.5">
                <Bar className="h-4 w-full" />
                <Bar className="h-4 w-11/12" />
                <Bar className="h-4 w-full" />
                <Bar className="h-4 w-2/3" />
              </div>
            </SkelCard>
          </div>
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-4">
          {(
            [
              ["order-2", "Customer name", "w-40"],
              ["order-3", "Posted date", "w-32"],
            ] as const
          ).map(([order, title, w]) => (
            <div key={title} className={order}>
              <SkelCard
                title={title}
                actions={
                  <>
                    <Button size="sm" tabIndex={-1}>Copy</Button>
                    <Button size="sm" tabIndex={-1}>Edit</Button>
                  </>
                }
              >
                <div className="flex min-h-6 items-center">
                  <Bar className={cx("h-4", w)} />
                </div>
              </SkelCard>
            </div>
          ))}

          <SkelCard className="order-4" title="Rating & job type">
            <div className="grid grid-cols-2 gap-3">
              {["Stars", "Job type guess"].map((l) => (
                <div key={l}>
                  <SkelLabel>{l}</SkelLabel>
                  {/* An empty select keeps the real control's height on every browser. */}
                  <select className={cx(inputCls, "skel-label")} tabIndex={-1} aria-hidden defaultValue="">
                    <option value="" />
                  </select>
                </div>
              ))}
            </div>
          </SkelCard>

          <SkelCard
            className="order-5"
            title="Employees mentioned"
            actions={
              <Button size="sm" variant="ghost" tabIndex={-1}>
                + Add another employee
              </Button>
            }
          >
            <div className="rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
              <div className="mb-2 flex min-h-11 items-center">
                <Bar className="h-3.5 w-44" />
              </div>
              <Bar className="h-11 w-56 rounded-xl" />
            </div>
          </SkelCard>

          <SkelCard className="order-6" title="Spiff preview">
            <div className="py-1">
              <Bar className="h-4 w-48" />
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-stone-200 pt-2 text-lg font-bold">
              <span className="skel-label">Review total</span>
              <Bar className="h-5 w-16" />
            </div>
          </SkelCard>
        </div>
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-3 pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto max-w-6xl">
          <Button variant="primary" size="xl" className="w-full" disabled>
            Add all to records
          </Button>
        </div>
      </div>
    </div>
  );
}
