import { useMemo, useState, type ReactNode, type Ref } from "react";
import { donutSlices, groupOfDepartment, rankByReviews, departmentsOfReview, type EmployeeTotal, type GroupKey } from "../../shared/dashboard";
import { formatDate } from "../../shared/dates";
import type { Review } from "../../shared/schemas";
import { cx, deptClasses } from "../lib";
import { Button, EmptyState, Modal } from "./ui";

// ---------- Icons (inline so there is nothing extra to load) ----------
const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function GroupIcon({ group, className }: { group: GroupKey; className?: string }) {
  switch (group) {
    case "plumbing":
      return (
        <svg {...svgProps} className={className}>
          <path d="M12 3s6 6.2 6 10.5A6 6 0 0 1 6 13.5C6 9.2 12 3 12 3z" />
        </svg>
      );
    case "hvac":
      return (
        <svg {...svgProps} className={className}>
          <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
        </svg>
      );
    case "install":
      return (
        <svg {...svgProps} className={className}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    default:
      return (
        <svg {...svgProps} fill="currentColor" strokeWidth={0} className={className}>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      );
  }
}

function ReviewBubbleIcon({ className }: { className?: string }) {
  return (
    <svg {...svgProps} strokeWidth={1.6} className={className}>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20.5l1.5-4.9A8.5 8.5 0 1 1 21 11.5z" />
      <path d="m12 7.6 1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.7 1.4.6-3-2.2-2.1 3-.4z" fill="currentColor" strokeWidth={1} />
    </svg>
  );
}

const GROUP_ICON_COLOR: Record<GroupKey, string> = {
  plumbing: "text-sky-700",
  hvac: "text-red-700",
  install: "text-stone-600",
  other: "text-stone-500",
};

/** A department pill using the company department colors. */
export function DeptChip({ name, className }: { name: string; className?: string }) {
  return <span className={cx("inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1", deptClasses(name), className)}>{name}</span>;
}

// ---------- Card with the maroon header bar ----------
export function DashCard({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200", className)}>
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-gradient-to-r from-brand to-brand-dark px-4 py-2 text-white">
        <h2 className="text-lg font-bold">{title}</h2>
        {right && <div className="text-sm text-white/85">{right}</div>}
      </header>
      {children}
    </section>
  );
}

// ---------- Big total + department tiles ----------
export function TotalCallout({ count, periodLabel, spiffText }: { count: number; periodLabel: string; spiffText: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white shadow-sm">
      <ReviewBubbleIcon className="size-16 shrink-0 text-white/90" />
      <div className="min-w-0">
        <p className="text-base font-semibold">Total Reviews</p>
        <p className="text-6xl leading-none font-bold tabular-nums" aria-label={`${count} total reviews`}>
          {count}
        </p>
        <p className="mt-1 text-sm text-white/80">{periodLabel}</p>
        <p className="mt-2 text-xs text-white/65">{spiffText}</p>
      </div>
    </div>
  );
}

export function DepartmentTiles({ items }: { items: { name: string; count: number }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:gap-3">
      {items.map((d) => {
        const g = groupOfDepartment(d.name);
        return (
          <div key={d.name} className={cx("flex flex-col items-center justify-center rounded-2xl bg-white px-2 py-3 text-center shadow-sm ring-1 ring-stone-200", d.count === 0 && "opacity-60")}>
            <GroupIcon group={g} className={cx("size-6", GROUP_ICON_COLOR[g])} />
            <p className="mt-1 text-xs leading-tight font-semibold text-stone-700 sm:text-sm">{d.name}</p>
            <p className="text-3xl font-bold tabular-nums sm:text-4xl">{d.count}</p>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Leaderboard + donut, one connected card ----------
const SLICE_COLORS = ["#6b1a2c", "#c9a84c", "#2b6cb0", "#2f855a", "#dd6b20"];
const REST_COLOR = "#a8a29e";
const sliceColor = (i: number) => SLICE_COLORS[i] ?? REST_COLOR;
const RANK_CLS = ["bg-gold text-stone-900", "bg-stone-300 text-stone-800", "bg-amber-600 text-white", "bg-stone-200 text-stone-700", "bg-stone-200 text-stone-700"];

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
        <text x="60" y="62" fontSize="20" fontWeight="700" fill="#1c1917">
          {total}
        </text>
        <text x="60" y="75" fontSize="8" fill="#78716c">
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
    <DashCard title="Top 5 Earners" right="By review quantity">
      {top.length === 0 ? (
        <p className="px-4 py-10 text-center text-stone-500">No employees named yet this month.</p>
      ) : (
        <div className="flex flex-col items-center gap-4 p-4 sm:flex-row sm:items-center sm:gap-6">
          <ol className="w-full min-w-0 flex-1 space-y-1">
            {top.map((p, i) => (
              <li key={p.employee_id} className="flex items-center gap-3 rounded-lg px-2 py-2 even:bg-stone-50">
                <span className={cx("inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold", RANK_CLS[i])}>{i + 1}</span>
                <Dot color={sliceColor(i)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <DeptChip name={p.department} className="mt-0.5" />
                </span>
                <span className="w-10 text-right text-xs text-stone-500 tabular-nums">{pctOf(p.mentions)}%</span>
                <span className="w-8 text-right text-2xl font-bold tabular-nums">{p.mentions}</span>
              </li>
            ))}
            {rest && (
              <li className="flex items-center gap-3 rounded-lg px-2 py-2">
                <span className="size-7 shrink-0" aria-hidden />
                <Dot color={REST_COLOR} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-stone-700">Everyone else</span>
                  <span className="text-xs text-stone-500">
                    {othersCount} other employee{othersCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="w-10 text-right text-xs text-stone-500 tabular-nums">{rest.pct}%</span>
                <span className="w-8 text-right text-2xl font-bold text-stone-700 tabular-nums">{rest.value}</span>
              </li>
            )}
          </ol>
          <Donut slices={slices} total={total} />
        </div>
      )}
      {ranked.length > 0 && (
        <div className="flex justify-end border-t border-stone-100 px-4 py-2">
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
            See all ({ranked.length})
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
      title={
        <>
          Review Log <span className="font-normal text-white/80">– {monthTitle}</span>
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
          className="min-h-10 w-full rounded-full border-0 bg-white px-4 py-1.5 text-base text-stone-900 placeholder:text-stone-400 focus:ring-2 focus:ring-gold focus:outline-none sm:w-64"
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
        <div className="p-2">
          <div className={cx("grid items-center gap-x-2 rounded-lg bg-stone-700 px-3 py-1.5 text-sm font-semibold text-white", COLS)}>
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
                <li key={r.id} className="even:bg-stone-50">
                  <button
                    type="button"
                    ref={r.id === highlight ? hlRef : undefined}
                    onClick={() => onOpen(r.id)}
                    className={cx("grid min-h-14 w-full items-center gap-x-2 rounded-lg px-3 py-2 text-left hover:bg-brand-light/60", COLS, r.id === highlight && "flash ring-2 ring-gold")}
                  >
                    <span className="text-sm text-stone-600">
                      <span className="sm:hidden">{shortDate(r.posted_date)}</span>
                      <span className="hidden sm:inline">{formatDate(r.posted_date)}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold break-words sm:truncate">
                        {r.customer_name}
                        {r.needs_attention && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs font-semibold text-red-800">Attention</span>}
                      </span>
                      <span className="block text-xs text-stone-500 sm:hidden">{people || "No employees named"}</span>
                    </span>
                    <span className="hidden min-w-0 justify-self-start text-left text-sm text-stone-700 sm:block">{people || <span className="text-stone-400">No employees named</span>}</span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {depts.length === 0 ? <span className="text-xs text-stone-400">—</span> : depts.map((d) => <DeptChip key={d} name={d} />)}
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
