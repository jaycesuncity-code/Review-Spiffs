import { useEffect, useRef, useState } from "react";
import { currentMonthDenver, formatDate, isValidMonth, monthLabel, shiftMonth } from "../../shared/dates";
import type { Review } from "../../shared/schemas";
import { formatCents } from "../../shared/text";
import { api } from "../api";
import { EmployeeChip } from "../components/EmployeePicker";
import { Banner, Button, Card, EmptyState, Modal, Spinner } from "../components/ui";
import { cx } from "../lib";
import { useRouter } from "../router";

interface MonthData {
  month: string;
  reviews: Review[];
  summary: {
    count: number;
    total_cents: number;
    per_employee: { employee_id: number; name: string; department: string; mentions: number; total_cents: number }[];
  };
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
    if (data && highlight) hlRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [data, highlight]);

  const go = (m: string) => navigate(`/?month=${m}`);

  return (
    <div className="pb-28 lg:pb-8">
      {/* Month switcher */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))} className="w-12">
          ‹
        </Button>
        <button type="button" className="min-h-11 flex-1 rounded-xl px-3 text-center text-xl font-bold hover:bg-white" onClick={() => setMonthMenu(true)}>
          {monthLabel(month)} <span className="text-base text-stone-400">▾</span>
        </button>
        <Button aria-label="Next month" onClick={() => go(shiftMonth(month, 1))} className="w-12">
          ›
        </Button>
        <div className="hidden lg:block">
          <Button variant="primary" size="lg" onClick={() => navigate("/new")}>
            + Add New
          </Button>
        </div>
      </div>

      {justSaved && (
        <div className="mb-4">
          <Banner tone="ok">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">Saved to records.</span>
              <Button size="sm" variant="primary" onClick={() => navigate("/new")}>
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
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-stone-500">{data.summary.count} entr{data.summary.count === 1 ? "y" : "ies"}</p>
                <p className="text-3xl font-bold tabular-nums text-brand">{formatCents(data.summary.total_cents)}</p>
                <p className="text-xs text-stone-500">spiffs for {monthLabel(month)} (by posted date)</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a className="inline-flex min-h-11 items-center rounded-xl bg-white px-3 text-sm font-medium ring-1 ring-stone-300 hover:bg-stone-50" href={`/api/export?month=${month}&kind=mentions`} download>
                  Export CSV
                </a>
                <a className="inline-flex min-h-11 items-center rounded-xl bg-white px-3 text-sm font-medium ring-1 ring-stone-300 hover:bg-stone-50" href={`/api/export?month=${month}&kind=totals`} download>
                  Totals CSV
                </a>
              </div>
            </div>
            {data.summary.per_employee.length > 0 && (
              <div className="mt-3 border-t border-stone-100 pt-2">
                <button type="button" className="flex min-h-11 w-full items-center justify-between text-left font-medium" onClick={() => setShowTotals((s) => !s)} aria-expanded={showTotals}>
                  Per-employee totals ({data.summary.per_employee.length})<span className="text-stone-400">{showTotals ? "▴" : "▾"}</span>
                </button>
                {showTotals && (
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
                )}
              </div>
            )}
          </Card>

          {data.reviews.length === 0 ? (
            <EmptyState title="No entries yet">
              Tap <strong>Add New</strong> to paste a review.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {data.reviews.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    ref={r.id === highlight ? hlRef : undefined}
                    onClick={() => navigate(`/entry/${r.id}`)}
                    className={cx(
                      "w-full rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-stone-200 transition hover:ring-brand/40",
                      r.id === highlight && "flash ring-2 ring-gold",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold">{r.customer_name}</p>
                        <p className="text-sm text-stone-500">
                          {formatDate(r.posted_date)}
                          {r.star_rating ? <span className="ml-2 text-gold">{"★".repeat(r.star_rating)}</span> : null}
                          {r.needs_attention && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs font-semibold text-red-800">Attention</span>}
                        </p>
                      </div>
                      <p className="text-xl font-bold tabular-nums">{formatCents(r.total_cents)}</p>
                    </div>
                    {r.mentions.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {r.mentions.map((m) => (
                          <EmployeeChip key={m.id} name={m.employee_name_snapshot} department={m.department_name_snapshot} amount={formatCents(m.amount_cents)} />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-stone-500">No employees mentioned</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Phone: big sticky Add New */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-3 pt-3 backdrop-blur lg:hidden">
        <Button variant="primary" size="xl" className="w-full" onClick={() => navigate("/new")}>
          + Add New
        </Button>
      </div>

      <Modal open={monthMenu} onClose={() => setMonthMenu(false)} title="Choose a month">
        <ul className="space-y-1">
          {months.map((m) => (
            <li key={m}>
              <button
                type="button"
                className={cx("min-h-12 w-full rounded-xl px-3 text-left text-lg hover:bg-stone-100", m === month && "bg-brand-light font-semibold text-brand")}
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
