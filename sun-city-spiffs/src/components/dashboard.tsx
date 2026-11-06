import { useMemo, useState, type ReactNode, type Ref } from "react";
import { donutSlices, rankByReviews, departmentsOfReview, type DepartmentBar, type EmployeeTotal } from "../../shared/dashboard";
import { formatDate } from "../../shared/dates";
import type { Review } from "../../shared/schemas";
import { cx, deptAccent, deptClasses } from "../lib";
import { DepartmentIcon } from "./DepartmentIcons";
import { Button, EmptyState, Modal } from "./ui";

// ---------- Icons (inline so there is nothing extra to load) ----------
const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function ReviewBubbleIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} strokeWidth={1.6} className={className}>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20.5l1.5-4.9A8.5 8.5 0 1 1 21 11.5z" />
      <path d="m12 7.6 1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.7 1.4.6-3-2.2-2.1 3-.4z" fill="currentColor" strokeWidth={1} />
    </svg>
  );
}

function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .55-.47.98-.97 1.2C7.85 18.75 7 20.24 7 22M14 14.7V17c0 .55.47.98.97 1.2C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

/** A department pill using the company department colors. */
export function DeptChip({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] leading-5 font-bold whitespace-nowrap ring-1", deptClasses(name), className)}>
      <DepartmentIcon department={name} className="size-3.5 shrink-0" />
      {name}
    </span>
  );
}

// ---------- Card with the maroon header bar ----------
export function DashCard({ title, icon, right, children, className }: { title: ReactNode; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-stone-900/5", className)}>
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-gradient-to-r from-brand to-brand-dark px-4 py-2 text-white sm:px-5">
        <h2 className="flex items-center gap-2.5 text-[1.6875rem] font-extrabold tracking-tight">
          {icon}
          <span>{title}</span>
        </h2>
        {right && <div className="text-sm font-medium text-white/90">{right}</div>}
      </header>
      {children}
    </section>
  );
}

// ---------- Big total + department progress gallery ----------
export function TotalCallout({ count, periodLabel, spiffText }: { count: number; periodLabel: string; spiffText: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white shadow-card ring-1 ring-black/5 sm:gap-5 sm:px-6">
      <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/12 ring-1 ring-white/20 sm:size-16">
        <ReviewBubbleIcon className="size-9 text-white sm:size-10" />
      </span>
      <div className="min-w-0">
        <p className="text-[1.51875rem] leading-tight font-bold">Total Reviews</p>
        <p className="text-6xl leading-none font-extrabold tracking-tight tabular-nums" aria-label={`${count} total reviews`}>
          {count}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="rounded-full bg-white/15 px-3 py-0.5 text-sm font-semibold">{periodLabel}</span>
          <span className="text-xs font-medium text-white/70">{spiffText}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * One progress card per department that has reviews this month (the caller passes `departmentBars`,
 * which already drops zero-review departments and sorts busiest first). Bars are relative to the busiest
 * department, not to a goal. A lone card on the last row stretches across so the grid never has a hole.
 */
export function DepartmentGallery({ bars }: { bars: DepartmentBar[] }) {
  if (bars.length === 0) return null;
  const max = bars[0].count;
  return (
    <ul aria-label="Review counts by department" className="grid auto-rows-fr gap-3 sm:grid-cols-2 sm:[&>:last-child:nth-child(odd)]:col-span-2">
      {bars.map((d) => {
        const accent = deptAccent(d.name);
        return (
          <li key={d.name} className="flex items-center gap-3.5 rounded-2xl bg-white p-4 shadow-card ring-1 ring-stone-900/5">
            <span className={cx("grid size-11 shrink-0 place-items-center rounded-xl", accent.tile)}>
              <DepartmentIcon department={d.name} className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 pt-0.5 text-[1.35rem] leading-tight font-bold text-stone-800">{d.name}</p>
                <p className="text-3xl leading-none font-extrabold tabular-nums text-stone-900">{d.count}</p>
              </div>
              <div
                role="progressbar"
                aria-label={`${d.name}: ${d.count} review${d.count === 1 ? "" : "s"}`}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={d.count}
                className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-stone-200/80"
              >
                {/* minWidth keeps a department with a very low count visible as a small rounded pill. */}
                <div className={cx("h-full rounded-full", accent.bar)} style={{ width: `${d.pct}%`, minWidth: "0.625rem" }} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Leaderboard + donut, one connected card ----------
const SLICE_COLORS = ["#9a0d28", "#d4a82f", "#2b6cb0", "#2f855a", "#e0702a"];
const REST_COLOR = "#a8a29e";
const sliceColor = (i: number) => SLICE_COLORS[i] ?? REST_COLOR;
const RANK_CLS = ["bg-gold text-stone-900 ring-gold/40", "bg-stone-300 text-stone-800 ring-stone-400/40", "bg-amber-600 text-white ring-amber-700/30", "bg-stone-200 text-stone-700 ring-stone-300/60", "bg-stone-200 text-stone-700 ring-stone-300/60"];

function Dot({ color }: { color: string }) {
  return <span className="inline-block size-3.5 shrink-0 rounded-full ring-2 ring-white" style={{ background: color }} aria-hidden />;
}

function Donut({ slices, total }: { slices: ReturnType<typeof donutSlices>["slices"]; total: number }) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const gap = slices.length > 1 ? 0.8 : 0;
  let offset = 0;
  return (
    <svg viewBox="0 0 120 120" className="size-44 shrink-0 -rotate-90 sm:size-52" role="img" aria-label="Donut chart of the top five employees' share of this month's review mentions, plus everyone else">
      <circle cx="60" cy="60" r={R} fill="none" stroke="#f5f5f4" strokeWidth="22" />
      {slices.map((s, i) => {
        const len = (s.value / total) * C;
        const dash = Math.max(len - gap, 0.01);
        const el = (
          <circle key={s.label} cx="60" cy="60" r={R} fill="none" stroke={s.rest ? REST_COLOR : sliceColor(i)} strokeWidth="22" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offset}>
            <title>{`${s.label}: ${s.value} (${s.pct}%)`}</title>
          </circle>
        );
        offset += len;
        return el;
      })}
      {/* Counter-rotate so the centre text reads upright. */}
      <g transform="rotate(90 60 60)" textAnchor="middle">
        <text x="60" y="62" fontSize="22" fontWeight="800" fill="#1c1917">
          {total}
        </text>
        <text x="60" y="75" fontSize="9" fontWeight="600" fill="#57534e">
          mentions
        </text>
      </g>
    </svg>
  );
}

export function Leaderboard({ people, monthTitle }: { people: EmployeeTotal[]; monthTitle: string }) {
  const [open, setOpen] = useState(false);
  const ranked = useMemo(() => rankByReviews(people).filter((p) => p.mentions > 0), [people]);
  const { slices, total } = useMemo(() => donutSlices(people, 5), [people]);
  const top = ranked.slice(0, 5);
  const rest = slices.find((s) => s.rest);
  const othersCount = ranked.length - top.length;
  const pctOf = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

  return (
    <DashCard title="Top 5 Earners" icon={<TrophyIcon className="size-6" />} right="By review quantity">
      {top.length === 0 ? (
        <p className="px-4 py-10 text-center text-stone-500">No employees named yet this month.</p>
      ) : (
        <div className="flex flex-col items-center gap-5 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
          <ol className="w-full min-w-0 flex-1 space-y-1">
            {top.map((p, i) => (
              <li key={p.employee_id} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 even:bg-stone-50">
                <span className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ring-1", RANK_CLS[i])}>{i + 1}</span>
                <Dot color={sliceColor(i)} />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-1 lg:flex-row lg:items-center lg:gap-3">
                  <span className="block text-base leading-tight font-bold break-words text-stone-900 lg:w-48 lg:shrink-0 lg:truncate">{p.name}</span>
                  <DeptChip name={p.department} />
                </span>
                <span className="w-12 text-right text-sm font-semibold text-stone-500 tabular-nums">{pctOf(p.mentions)}%</span>
                <span className="w-9 text-right text-3xl leading-none font-extrabold tabular-nums">{p.mentions}</span>
              </li>
            ))}
            {rest && (
              <li className="flex items-center gap-3 rounded-xl px-2.5 py-2.5">
                <span className="size-8 shrink-0" aria-hidden />
                <Dot color={REST_COLOR} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold text-stone-700">Everyone else</span>
                  <span className="text-sm text-stone-500">
                    {othersCount} other employee{othersCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="w-12 text-right text-sm font-semibold text-stone-500 tabular-nums">{rest.pct}%</span>
                <span className="w-9 text-right text-3xl leading-none font-extrabold text-stone-700 tabular-nums">{rest.value}</span>
              </li>
            )}
          </ol>
          <div className="flex shrink-0 items-center justify-center sm:self-stretch sm:border-l sm:border-stone-200 sm:pl-6">
            <Donut slices={slices} total={total} />
          </div>
        </div>
      )}
      {ranked.length > 0 && (
        <div className="flex justify-end border-t border-stone-100 px-4 py-3 sm:px-5">
          <Button size="sm" variant="primary" className="text-[1.18125rem]" onClick={() => setOpen(true)}>
            See all ({ranked.length}) <span aria-hidden>→</span>
          </Button>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={`All employees – ${monthTitle}`} wide>
        <p className="mb-2 text-sm text-stone-500">
          {ranked.length} employee{ranked.length === 1 ? "" : "s"} named in {total} mention{total === 1 ? "" : "s"}, ranked by number of reviews.
        </p>
        <ol>
          {ranked.map((p, i) => (
            <li key={p.employee_id} className="flex items-center gap-3 rounded-lg px-2 py-2 even:bg-stone-50">
              <span className="w-6 shrink-0 text-right text-sm text-stone-500 tabular-nums">{i + 1}</span>
              <Dot color={i < 5 ? sliceColor(i) : REST_COLOR} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.name}</span>
                <DeptChip name={p.department} className="mt-0.5" />
              </span>
              <span className="w-12 text-right text-xs text-stone-500 tabular-nums">{pctOf(p.mentions)}%</span>
              <span className="w-8 text-right text-xl font-bold tabular-nums">{p.mentions}</span>
            </li>
          ))}
        </ol>
      </Modal>
    </DashCard>
  );
}

// ---------- Review log ----------
const shortDate = (d: string) => formatDate(d).replace(/,\s*\d{4}$/, ""); // "Oct 1"

const COLS = "grid-cols-[4.25rem_minmax(0,1fr)_auto] sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1.3fr)_13rem]";

export function ReviewLog({ reviews, monthTitle, highlight, hlRef, onOpen }: { reviews: Review[]; monthTitle: string; highlight: number; hlRef: Ref<HTMLButtonElement>; onOpen: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = reviews
      .map((r) => ({ r, depts: departmentsOfReview(r.mentions), people: r.mentions.map((m) => m.employee_name_snapshot).join(", ") }))
      .filter(({ r, depts, people }) => !needle || [r.customer_name, people, ...depts].join(" ").toLowerCase().includes(needle));
    const dir = newestFirst ? -1 : 1;
    return list.sort((a, b) => dir * (a.r.posted_date.localeCompare(b.r.posted_date) || a.r.id - b.r.id));
  }, [reviews, q, newestFirst]);

  return (
    <DashCard
      icon={<ListIcon className="size-6" />}
      title={
        <>
          Review Log <span className="font-medium text-white/85">– {monthTitle}</span>
        </>
      }
      right={
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search reviews…"
          aria-label="Search reviews"
          autoComplete="off"
          className="min-h-11 w-full rounded-full border-0 bg-white px-4 py-1.5 text-base text-stone-900 shadow-inner placeholder:text-stone-500 focus:ring-2 focus:ring-gold focus:outline-none sm:w-72"
        />
      }
    >
      {reviews.length === 0 ? (
        <div className="p-3">
          <EmptyState title="No entries yet">
            Tap <strong>Add Review</strong> to paste a review.
          </EmptyState>
        </div>
      ) : (
        <div className="p-2.5 sm:p-3">
          <div className={cx("grid items-center gap-x-2 rounded-xl bg-stone-800 px-3 py-1.5 text-[1.18125rem] font-bold text-white", COLS)}>
            <button type="button" className="flex min-h-9 items-center gap-1 text-left" onClick={() => setNewestFirst((v) => !v)} aria-label={`Date, sorted ${newestFirst ? "newest" : "oldest"} first. Tap to reverse.`}>
              Date <span aria-hidden>{newestFirst ? "▾" : "▴"}</span>
            </button>
            <span>Customer</span>
            <span className="hidden sm:block">Employee(s)</span>
            <span className="text-right">Department</span>
          </div>
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-stone-500">No reviews match “{q}”.</p>
          ) : (
            <ul>
              {rows.map(({ r, depts, people }) => (
                <li key={r.id} className="rounded-xl even:bg-stone-50">
                  <button
                    type="button"
                    ref={r.id === highlight ? hlRef : undefined}
                    onClick={() => onOpen(r.id)}
                    className={cx("grid min-h-14 w-full items-center gap-x-2 rounded-xl px-3 py-2 text-left hover:bg-brand-light/70", COLS, r.id === highlight && "flash ring-2 ring-gold")}
                  >
                    <span className="text-sm font-medium text-stone-600">
                      <span className="sm:hidden">{shortDate(r.posted_date)}</span>
                      <span className="hidden sm:inline">{formatDate(r.posted_date)}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold text-stone-900 break-words sm:truncate">
                        {r.customer_name}
                        {r.needs_attention && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs font-semibold text-red-800">Attention</span>}
                      </span>
                      <span className="block text-sm text-stone-500 sm:hidden">{people || "No employees named"}</span>
                    </span>
                    <span className="hidden min-w-0 justify-self-start text-left text-sm font-medium text-stone-700 sm:block">{people || <span className="text-stone-400">No employees named</span>}</span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {depts.length === 0 ? <span className="text-xs text-stone-400">—</span> : depts.map((d) => <DeptChip key={d} name={d} className="max-sm:[&>svg]:hidden" />)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </DashCard>
  );
}
