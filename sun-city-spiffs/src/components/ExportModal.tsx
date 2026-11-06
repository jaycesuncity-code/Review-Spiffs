import { useMemo, useState, type ReactNode } from "react";
import { monthLabel } from "../../shared/dates";
import { monthPeriod, periodError, periodTitle, toPeriod, type ExportPeriod } from "../../shared/period";
import { downloadCsv, downloadPdf, type CsvKind } from "../export/download";
import { cx } from "../lib";
import { Banner, Button, inputCls, Modal, Spinner, useToast } from "./ui";

type Busy = null | "pdf" | CsvKind;

/** Miniature portrait report page: white paper, maroon title band, three figures and a faint grid. */
function PdfArt() {
  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28" aria-hidden>
      <rect x="27" y="10" width="70" height="98" rx="3" fill="#1c1917" opacity="0.08" transform="translate(2 3)" />
      <rect x="27" y="10" width="70" height="98" rx="3" fill="#fff" stroke="#d6d3d1" />
      <rect x="27" y="10" width="70" height="15" rx="3" fill="#9a0d28" />
      <rect x="27" y="20" width="70" height="5" fill="#9a0d28" />
      <rect x="27" y="25" width="70" height="1.4" fill="#c9a84c" />
      <rect x="33" y="14.5" width="26" height="2.6" rx="1.3" fill="#fff" opacity="0.95" />
      <rect x="33" y="19" width="16" height="1.8" rx="0.9" fill="#fff" opacity="0.6" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={33 + i * 20} y="31" width="18" height="12" rx="1.5" fill="#faf8f7" stroke="#e7e5e4" strokeWidth="0.6" />
          <rect x={33 + i * 20} y="31" width="1.3" height="12" fill="#9a0d28" />
          <rect x={36.5 + i * 20} y="34" width="9" height="1.4" rx="0.7" fill="#a8a29e" />
          <rect x={36.5 + i * 20} y="37.5" width="11" height="3" rx="1" fill={i === 2 ? "#9a0d28" : "#44403c"} />
        </g>
      ))}
      <rect x="33" y="49" width="58" height="4.5" fill="#9a0d28" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <g key={i}>
          {i % 2 === 1 && <rect x="33" y={53.5 + i * 5.5} width="58" height="5.5" fill="#f5f5f4" />}
          <rect x="35" y={55.6 + i * 5.5} width={14 + ((i * 7) % 10)} height="1.3" rx="0.65" fill="#78716c" />
          <rect x="62" y={55.6 + i * 5.5} width="10" height="1.3" rx="0.65" fill="#a8a29e" />
          <rect x="81" y={55.6 + i * 5.5} width="8" height="1.3" rx="0.65" fill="#44403c" />
        </g>
      ))}
      <line x1="33" y1="97.5" x2="91" y2="97.5" stroke="#9a0d28" strokeWidth="0.7" />
      <line x1="33" y1="102" x2="91" y2="102" stroke="#e7e5e4" strokeWidth="0.5" />
      <rect x="33" y="103.6" width="20" height="1.2" rx="0.6" fill="#a8a29e" />
      <rect x="81" y="103.6" width="10" height="1.2" rx="0.6" fill="#a8a29e" />
    </svg>
  );
}

/** A plain spreadsheet grid. */
function GridArt() {
  const cols = [22, 40, 58, 76];
  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28" aria-hidden>
      <rect x="14" y="24" width="92" height="74" rx="3" fill="#1c1917" opacity="0.08" transform="translate(2 3)" />
      <rect x="14" y="24" width="92" height="74" rx="3" fill="#fff" stroke="#d6d3d1" />
      <path d="M14 27a3 3 0 0 1 3-3h86a3 3 0 0 1 3 3v8H14z" fill="#e7e5e4" />
      <rect x="14" y="24" width="8" height="74" fill="#f5f5f4" />
      {cols.map((x) => (
        <line key={x} x1={x} y1="24" x2={x} y2="98" stroke="#d6d3d1" strokeWidth="0.8" />
      ))}
      {[35, 45, 55, 65, 75, 85].map((y) => (
        <line key={y} x1="14" y1={y} x2="106" y2={y} stroke="#d6d3d1" strokeWidth="0.8" />
      ))}
      {[0, 1, 2, 3].map((c) => (
        <rect key={c} x={cols[c] + 4} y="28.6" width="10" height="2.4" rx="1.2" fill="#57534e" />
      ))}
      {[0, 1, 2, 3, 4, 5].map((r) =>
        [0, 1, 2, 3].map((c) => <rect key={`${r}-${c}`} x={cols[c] + 4} y={39 + r * 10} width={c === 3 ? 8 : 6 + ((r + c * 3) % 7)} height="2" rx="1" fill={c === 3 ? "#44403c" : "#a8a29e"} />),
      )}
      <rect x="27" y="45" width="18" height="10" fill="none" stroke="#9a0d28" strokeWidth="1.4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-12" aria-hidden>
      <rect x="6" y="6" width="36" height="36" rx="6" fill="#fbecef" />
      {[15, 22, 29, 36].map((y) => (
        <g key={y}>
          <circle cx="14" cy={y - 1} r="1.6" fill="#9a0d28" />
          <rect x="19" y={y - 2.2} width="18" height="2.4" rx="1.2" fill="#6f0a1f" opacity="0.75" />
        </g>
      ))}
    </svg>
  );
}

function TotalsIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-12" aria-hidden>
      <rect x="6" y="6" width="36" height="36" rx="6" fill="#fbecef" />
      <path d="M16 14h16M16 14l8 10-8 10h16" fill="none" stroke="#9a0d28" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Choice({ onClick, disabled, busy, children, className }: { onClick: () => void; disabled?: boolean; busy?: boolean; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={cx(
        "relative flex w-full flex-col items-center rounded-2xl bg-white px-4 py-5 text-center shadow-card ring-1 ring-stone-200 transition",
        "hover:-translate-y-0.5 hover:ring-2 hover:ring-brand focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold",
        "disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:ring-1 disabled:hover:ring-stone-200",
        className,
      )}
    >
      {children}
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/85 text-brand">
          <Spinner className="size-8" />
        </span>
      )}
    </button>
  );
}

export function ExportModal({ initialMonth, months, onClose }: { initialMonth: string; months: string[]; onClose: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<"format" | "csv">("format");
  const [mode, setMode] = useState<"month" | "custom">("month");
  const [month, setMonth] = useState(initialMonth);
  const [start, setStart] = useState(monthPeriod(initialMonth).start);
  const [end, setEnd] = useState(monthPeriod(initialMonth).end);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ message: string; retry: Exclude<Busy, null> } | null>(null);
  const [done, setDone] = useState<CsvKind[]>([]);

  const monthOptions = useMemo(() => [...new Set([...months, initialMonth])].sort().reverse(), [months, initialMonth]);
  const rangeError = mode === "custom" ? periodError(start, end) : null;
  const period: ExportPeriod | null = mode === "month" ? { kind: "month", month } : rangeError ? null : { kind: "range", start, end };
  const bounds = period ? toPeriod(period) : null;

  const changePeriod = (fn: () => void) => {
    fn();
    setDone([]);
    setError(null);
  };

  /** The period is frozen when the download starts; later changes can't alter that file. */
  async function run(kind: Exclude<Busy, null>) {
    if (!period || busy) return;
    const frozen: ExportPeriod = { ...period };
    setBusy(kind);
    setError(null);
    try {
      if (kind === "pdf") {
        await downloadPdf(frozen);
        toast("PDF downloaded.");
        onClose();
      } else {
        await downloadCsv(frozen, kind);
        setDone((d) => [...new Set([...d, kind])]);
      }
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Something went wrong. Please try again.", retry: kind });
    } finally {
      setBusy(null);
    }
  }

  const periodSummary = (
    <div className="min-w-0">
      <p className="text-xs font-bold tracking-wider text-stone-500 uppercase">Reporting Period</p>
      <p className="text-xl font-extrabold tracking-tight text-stone-900">{bounds ? periodTitle(bounds) : "Choose valid dates"}</p>
      {bounds && (
        <p className="text-sm text-stone-500 tabular-nums">
          {bounds.start} to {bounds.end} <span className="text-stone-400">· both days included</span>
        </p>
      )}
    </div>
  );

  const segBtn = (value: "month" | "custom", label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      disabled={!!busy}
      onClick={() => changePeriod(() => setMode(value))}
      className={cx(
        "min-h-11 flex-1 rounded-lg px-3 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold",
        mode === value ? "bg-white text-brand shadow-sm ring-1 ring-stone-200" : "text-stone-600 hover:text-stone-900",
      )}
    >
      {label}
    </button>
  );

  const errorBanner = error && (
    <div className="mt-3" role="alert">
      <Banner tone="error">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>{error.message}</span>
          <Button size="sm" onClick={() => run(error.retry)} disabled={!period || !!busy}>
            Retry
          </Button>
        </div>
      </Banner>
    </div>
  );

  if (step === "csv") {
    return (
      <Modal
        key="csv"
        open
        wide
        onClose={onClose}
        title="What do you want to export?"
        footer={
          <>
            <Button
              onClick={() => {
                setError(null);
                setStep("format");
              }}
              disabled={!!busy}
            >
              ‹ Back
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        }
      >
        <div className="mb-4 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">{periodSummary}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["mentions", "Export List", "One row per employee mention", <ListIcon key="i" />],
              ["totals", "Export Totals", "One row per employee", <TotalsIcon key="i" />],
            ] as const
          ).map(([kind, title, sub, icon]) => (
            <Choice key={kind} onClick={() => run(kind)} disabled={!period || !!busy} busy={busy === kind}>
              {icon}
              <span className="mt-2 text-xl font-extrabold tracking-tight text-stone-900">{title}</span>
              <span className="mt-0.5 text-sm text-stone-500">{sub}</span>
              <span className={cx("mt-2 text-sm font-semibold", done.includes(kind) ? "text-emerald-700" : "text-transparent")} aria-live="polite">
                {done.includes(kind) ? "Downloaded ✓" : "·"}
              </span>
            </Choice>
          ))}
        </div>
        <p className="mt-3 text-center text-sm text-stone-500">Plain .csv files that open in Excel.</p>
        {errorBanner}
      </Modal>
    );
  }

  return (
    <Modal key="format" open wide onClose={onClose} title="How do you want this Exported?">
      <section className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200" aria-label="Reporting Period">
        {periodSummary}
        <div className="mt-3 flex gap-1 rounded-xl bg-stone-200/70 p-1" role="radiogroup" aria-label="Reporting period type">
          {segBtn("month", "Month")}
          {segBtn("custom", "Custom date range")}
        </div>
        {mode === "month" ? (
          <label className="mt-3 block">
            <span className="sr-only">Month</span>
            <select className={inputCls} value={month} disabled={!!busy} onChange={(e) => changePeriod(() => setMonth(e.target.value))}>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block min-w-0">
              <span className="mb-1 block text-sm font-semibold text-stone-700">Start date</span>
              <input type="date" className={inputCls} value={start} max={end || undefined} disabled={!!busy} onChange={(e) => changePeriod(() => setStart(e.target.value))} aria-invalid={!!rangeError} />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-sm font-semibold text-stone-700">End date</span>
              <input type="date" className={inputCls} value={end} min={start || undefined} disabled={!!busy} onChange={(e) => changePeriod(() => setEnd(e.target.value))} aria-invalid={!!rangeError} />
            </label>
            {rangeError && (
              <p className="col-span-2 text-sm font-semibold text-red-700" role="alert">
                {rangeError}
              </p>
            )}
          </div>
        )}
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Choice onClick={() => run("pdf")} disabled={!period || !!busy} busy={busy === "pdf"}>
          <PdfArt />
          <span className="mt-1 text-xl font-extrabold tracking-tight text-stone-900">All Nice and Pretty</span>
          <span className="mt-0.5 text-sm text-stone-500 italic">A PDF you can print out or save</span>
        </Choice>
        <Choice
          onClick={() => {
            setError(null);
            setStep("csv");
          }}
          disabled={!period || !!busy}
        >
          <GridArt />
          <span className="mt-1 text-xl font-extrabold tracking-tight text-stone-900">Export To Excel</span>
          <span className="mt-0.5 text-sm text-stone-500">Plain CSV files that open in Excel</span>
        </Choice>
      </div>
      {busy === "pdf" && <p className="mt-3 text-center text-sm text-stone-500" aria-live="polite">Building your PDF…</p>}
      {errorBanner}
    </Modal>
  );
}
