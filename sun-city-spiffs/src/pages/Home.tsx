import { useEffect, useMemo, useRef, useState } from "react";
import { countByDepartment, departmentBars, type EmployeeTotal } from "../../shared/dashboard";
import { currentMonthDenver, isValidMonth, monthLabel, shiftMonth } from "../../shared/dates";
import type { Review } from "../../shared/schemas";
import { formatCents } from "../../shared/text";
import { api } from "../api";
import { DepartmentGallery, Leaderboard, ReviewLog, TotalCallout } from "../components/dashboard";
import { Banner, Button, Card, Modal, Spinner } from "../components/ui";
import { useDirectory } from "../directory";
import { cx } from "../lib";
import { useRouter } from "../router";

interface MonthData {
  month: string;
  reviews: Review[];
  summary: {
    count: number;
    total_cents: number;
    per_employee: EmployeeTotal[];
  };
}

// Keep one-time confirmation markers out of the URL after their display ends.
function clearTransientParam(name: "saved" | "highlight", expected: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(name) !== expected) return;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function Home() {
  const { query, navigate } = useRouter();
  const qMonth = query.get("month");
  const month = qMonth && isValidMonth(qMonth) ? qMonth : currentMonthDenver();
  const highlight = Number(query.get("highlight") ?? 0);
  const justSaved = query.get("saved") === "1";

  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [monthMenu, setMonthMenu] = useState(false);
  const [showTotals, setShowTotals] = useState(false);
  const [showSaved, setShowSaved] = useState(justSaved);
  const [activeHighlight, setActiveHighlight] = useState(highlight);
  const hlRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancel = false;
    setData(null);
    setError(null);
    api<MonthData>(`/api/reviews?month=${month}`)
      .then((r) => !cancel && setData(r))
      .catch((e) => !cancel && setError(e.message));
    return () => {
      cancel = true;
    };
  }, [month]);

  useEffect(() => {
    api<{ months: string[] }>("/api/months")
      .then((r) => setMonths(r.months))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setShowSaved(justSaved);
    if (!justSaved) return;
    const timer = window.setTimeout(() => {
      setShowSaved(false);
      clearTransientParam("saved", "1");
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  useEffect(() => {
    setActiveHighlight(highlight);
    // Wait for the log to load so the new row actually gets one second of highlighting.
    if (!data || !highlight) return;
    const timer = window.setTimeout(() => {
      setActiveHighlight(0);
      clearTransientParam("highlight", String(highlight));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [data, highlight]);

  useEffect(() => {
    if (data && activeHighlight) hlRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [data, activeHighlight]);

  const go = (m: string) => navigate(`/?month=${m}`);

  const { departments } = useDirectory();
  const deptCounts = useMemo(
    () => countByDepartment(data?.reviews ?? [], [...departments].sort((a, b) => a.sort_order - b.sort_order).map((d) => d.name)),
    [data, departments],
  );
  // Display only: departments with no reviews this month are hidden from the gallery (they stay in the directory and everywhere else).
  const bars = useMemo(() => departmentBars(deptCounts), [deptCounts]);
  const multiDept = !!data && deptCounts.reduce((a, b) => a + b.count, 0) > data.summary.count;

  return (
    <div className="pb-28 lg:pb-8">
      {/* Month switcher */}
      <div className="mb-5 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:gap-2">
          <Button aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))} className="size-11 shrink-0 px-0 text-base sm:text-[1.35rem]">
            ‹
          </Button>
          <button type="button" className="min-h-11 shrink-0 whitespace-nowrap rounded-xl px-2 text-center text-2xl font-extrabold tracking-tight hover:bg-white sm:text-[2.025rem]" onClick={() => setMonthMenu(true)}>
            {monthLabel(month)} <span className="align-middle text-base text-brand sm:text-[1.35rem]">▾</span>
          </button>
          <Button aria-label="Next month" onClick={() => go(shiftMonth(month, 1))} className="size-11 shrink-0 px-0 text-base sm:text-[1.35rem]">
            ›
          </Button>
        </div>
        <div className="flex w-full justify-end gap-2 sm:w-auto">
          <a
            href="https://www.google.com/maps/place/Sun+City+Plumbing+%26+Heating/@32.3105669,-106.8284786,1765m/data=!3m1!1e3!4m8!3m7!1s0x86de3df06f46ce5d:0xf29bb058af60f430!8m2!3d32.3105669!4d-106.8259037!9m1!1b1!16s%2Fg%2F1tdmw1mv?entry=ttu&g_ep=EgoyMDI2MTEwMy4wIKXMDSoASAFQAw%3D%3D"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-13 items-center justify-center whitespace-nowrap rounded-xl bg-white px-4 text-[1.35rem] font-semibold text-stone-800 shadow-sm ring-1 ring-stone-300/80 transition hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Link to Google
          </a>
          <div className="hidden lg:block">
            <Button variant="primary" size="lg" className="text-[1.51875rem]" onClick={() => navigate("/new")}>
              + Add Review
            </Button>
          </div>
        </div>
      </div>

      {showSaved && (
        <div className="mb-4">
          <Banner tone="ok">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Saved to records.</span>
              <Button size="sm" variant="primary" className="text-[1.18125rem]" onClick={() => navigate("/new")}>
                Add another
              </Button>
            </div>
          </Banner>
        </div>
      )}

      {error && <Banner tone="error">{error}</Banner>}
      {!data && !error && (
        <div className="flex justify-center py-16 text-stone-400">
          <Spinner className="size-8" />
        </div>
      )}

      {data && (
        <div className="space-y-5">
          <div className={cx("grid gap-3", bars.length > 0 && "lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]")}>
            <TotalCallout
              count={data.summary.count}
              periodLabel={month === currentMonthDenver() ? "This Month" : monthLabel(month)}
              spiffText={`${formatCents(data.summary.total_cents)} in spiffs`}
            />
            <DepartmentGallery bars={bars} />
          </div>
          {multiDept && <p className="-mt-2 px-1 text-sm text-stone-500">A review that names people from more than one department counts in each, so the department numbers can add up to more than the total.</p>}

          <Leaderboard people={data.summary.per_employee} monthTitle={monthLabel(month)} />

          <ReviewLog reviews={data.reviews} monthTitle={monthLabel(month)} highlight={activeHighlight} hlRef={hlRef} onOpen={(id) => navigate(`/entry/${id}`)} />

          {/* Spiff dollars live here, out of the way: payouts per person and the CSV exports. */}
          <Card>
            <button type="button" className="flex min-h-11 w-full items-center justify-between text-left text-[1.35rem] font-semibold" onClick={() => setShowTotals((s) => !s)} aria-expanded={showTotals}>
              <span>
                Spiff payouts <span className="font-normal text-stone-500">· {formatCents(data.summary.total_cents)}</span>
              </span>
              <span className="text-stone-400">{showTotals ? "▴" : "▾"}</span>
            </button>
            {showTotals && (
              <div className="mt-2 border-t border-stone-100 pt-2">
                {data.summary.per_employee.length > 0 ? (
                  <ul className="divide-y divide-stone-100">
                    {data.summary.per_employee.map((p) => (
                      <li key={p.employee_id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="text-xs text-stone-500">
                            {p.department} · {p.mentions} review{p.mentions === 1 ? "" : "s"}
                          </p>
                        </div>
                        <p className="font-semibold tabular-nums">{formatCents(p.total_cents)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-sm text-stone-500">No spiffs this month.</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <a className="inline-flex min-h-11 items-center rounded-xl bg-white px-3 text-[1.18125rem] font-medium ring-1 ring-stone-300 hover:bg-stone-50" href={`/api/export?month=${month}&kind=mentions`} download>
                    Export CSV
                  </a>
                  <a className="inline-flex min-h-11 items-center rounded-xl bg-white px-3 text-[1.18125rem] font-medium ring-1 ring-stone-300 hover:bg-stone-50" href={`/api/export?month=${month}&kind=totals`} download>
                    Totals CSV
                  </a>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Phone: big sticky Add New */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-3 pt-3 backdrop-blur lg:hidden">
        <Button variant="primary" size="xl" className="w-full text-[1.6875rem]" onClick={() => navigate("/new")}>
          + Add Review
        </Button>
      </div>

      <Modal open={monthMenu} onClose={() => setMonthMenu(false)} title="Choose a month">
        <ul className="space-y-1">
          {months.map((m) => (
            <li key={m}>
              <button
                type="button"
                className={cx("min-h-12 w-full rounded-xl px-3 text-left text-[1.51875rem] hover:bg-stone-100", m === month && "bg-brand-light font-semibold text-brand")}
                onClick={() => {
                  setMonthMenu(false);
                  go(m);
                }}
              >
                {monthLabel(m)}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
