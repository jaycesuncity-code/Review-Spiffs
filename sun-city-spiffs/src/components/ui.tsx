import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { copyText, cx } from "../lib";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "gold";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark active:bg-brand-dark shadow-sm shadow-brand/30 disabled:bg-stone-300 disabled:text-stone-500 disabled:shadow-none",
  gold: "bg-gold text-stone-900 hover:brightness-95 shadow-sm disabled:bg-stone-300 disabled:text-stone-500",
  secondary: "bg-white text-stone-800 shadow-sm ring-1 ring-stone-300/80 hover:bg-stone-50 disabled:text-stone-400 disabled:shadow-none",
  ghost: "bg-transparent text-brand hover:bg-brand-light disabled:text-stone-400",
  danger: "bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:text-stone-400",
};

/** True inside a maroon header bar (Card titles, Modal titles): buttons switch to light-on-dark so they stay visible. */
const OnDark = createContext(false);

const ON_DARK: Partial<Record<Variant, string>> = {
  primary: "bg-white text-brand hover:bg-brand-light active:bg-brand-light shadow-sm disabled:bg-white/20 disabled:text-white/60",
  ghost: "bg-transparent text-white hover:bg-white/15 disabled:text-white/40",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" | "xl" }) {
  const onDark = useContext(OnDark);
  const sizes = {
    sm: "min-h-11 px-3 text-sm",
    md: "min-h-11 px-4 text-base",
    lg: "min-h-13 px-5 text-lg font-semibold",
    xl: "min-h-16 px-6 text-xl font-bold",
  };
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition select-none disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        sizes[size],
        (onDark && ON_DARK[variant]) || VARIANTS[variant],
        className,
      )}
    />
  );
}

/** White card. With a title or actions it gets the same maroon header bar as the dashboard sections. */
export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  const header = !!(title || actions);
  return (
    <section className={cx("overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-stone-900/5", !header && "p-4", className)}>
      {header && (
        <OnDark.Provider value>
          <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-gradient-to-r from-brand to-brand-dark px-4 py-1.5 text-white sm:px-5">
            <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </header>
        </OnDark.Provider>
      )}
      {header ? <div className="p-4 sm:p-5">{children}</div> : children}
    </section>
  );
}

/** Page heading with a short maroon accent bar, used at the top of every page. */
export function PageTitle({ children, sub, right }: { children: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-3xl font-extrabold tracking-tight text-stone-900">{children}</h1>
        {sub && <p className="mt-1 text-sm text-stone-500">{sub}</p>}
        <span className="mt-2 block h-1 w-10 rounded-full bg-brand" aria-hidden />
      </div>
      {right}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-hidden />;
}

export function CopyButton({ text, label = "Copy", size = "sm", variant = "secondary", className }: { text: string; label?: string; size?: "sm" | "md" | "lg"; variant?: Variant; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <Button
      size={size}
      variant={state === "ok" ? "gold" : variant}
      className={className}
      disabled={!text}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "ok" : "fail");
        clearTimeout(t.current);
        t.current = window.setTimeout(() => setState("idle"), 1600);
      }}
      aria-live="polite"
    >
      {state === "ok" ? "Copied ✓" : state === "fail" ? "Copy failed" : label}
    </Button>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cx("flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}
      >
        <OnDark.Provider value>
          <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-brand to-brand-dark px-4 py-2 text-white">
            <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              ✕
            </Button>
          </div>
        </OnDark.Provider>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="pb-safe flex flex-wrap justify-end gap-2 border-t border-stone-200 bg-stone-50 px-4 pt-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, message, confirmLabel, danger, busy, onConfirm, onClose }: { open: boolean; title: string; message: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner />} {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-stone-700">{message}</div>
    </Modal>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const tones = {
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
    error: "bg-red-50 text-red-900 ring-red-200",
    ok: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  };
  return <div className={cx("rounded-xl px-3.5 py-2.5 text-sm ring-1", tones[tone])}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-stone-300 bg-white/60 px-4 py-10 text-center">
      <p className="text-lg font-bold text-stone-700">{title}</p>
      {children && <div className="mt-1 text-stone-500">{children}</div>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-base text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none disabled:bg-stone-100";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-stone-500">{hint}</span>}
    </label>
  );
}

// ---------- Toasts ----------
interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error" | "info";
}
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg",
              t.tone === "error" ? "bg-red-700 text-white" : t.tone === "info" ? "bg-stone-800 text-white" : "bg-emerald-700 text-white",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
