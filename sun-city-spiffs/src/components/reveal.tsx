import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib";

/**
 * Presentation-only "typing" reveal for a freshly generated review.
 *
 * One requestAnimationFrame loop writes characters straight into DOM nodes, so React
 * does not re-render every frame; React state only changes at the few stage boundaries.
 * The typing phase has a fixed time budget: characters-per-frame comes from the total
 * character count, so a long reply and a short one finish at the same moment.
 */

export type RevealStage = "off" | "typing" | "chips" | "count" | "done";

export interface RevealField {
  key: string;
  /** Text to type. Omit for a field that fades in when its turn comes (e.g. selects). */
  text?: string;
}

/** Typing budget for all text fields together. */
const TYPE_MS = 650;
/** Short fields get at least this many "virtual" characters so they're visible for a few frames. */
const MIN_FIELD_WEIGHT = 28;
/** Stagger between employee chips, and the cap on how many get their own step. */
const CHIP_STEP_MS = 70;
const CHIP_STEPS_MAX = 4;
const CHIP_TAIL_MS = 140;
/** Spiff total count-up. */
export const COUNT_MS = 300;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Slot {
  text?: HTMLElement | null;
  caret?: HTMLElement | null;
  fade?: HTMLElement | null;
  scroll?: HTMLElement | null;
}

export interface Reveal {
  stage: RevealStage;
  /** True from the first typed frame until the final state is shown. */
  active: boolean;
  /** True when this editor was opened with a reveal (it is never replayed). */
  used: boolean;
  /** Last scroll position of the reply box, so the real textarea can take over without a jump. */
  replyScrollTop: () => number;
  textRef: (key: string) => (el: HTMLElement | null) => void;
  caretRef: (key: string) => (el: HTMLElement | null) => void;
  fadeRef: (key: string) => (el: HTMLElement | null) => void;
  scrollRef: (key: string) => (el: HTMLElement | null) => void;
  skip: () => void;
}

export function useReveal(enabled: boolean, fields: RevealField[], chipCount: number, onDone?: () => void): Reveal {
  // Captured once: the reveal only ever plays for the draft the editor opened with.
  const [used] = useState(enabled);
  const [stage, setStage] = useState<RevealStage>(enabled ? "typing" : "off");
  const fieldsRef = useRef(fields);
  const chipsRef = useRef(chipCount);
  const slots = useRef(new Map<string, Slot>());
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const lastScroll = useRef(0);
  const raf = useRef(0);

  const slot = (key: string) => {
    let s = slots.current.get(key);
    if (!s) slots.current.set(key, (s = {}));
    return s;
  };
  const refFor = (kind: keyof Slot) => (key: string) => (el: HTMLElement | null) => {
    slot(key)[kind] = el;
  };

  const finish = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setStage((s) => (s === "off" || s === "done" ? s : "done"));
  }, []);

  // Report completion once, after the final state has rendered.
  useEffect(() => {
    if (stage === "done" && used) onDoneRef.current?.();
  }, [stage, used]);

  useLayoutEffect(() => {
    if (!used) return;
    const fs = fieldsRef.current;
    const weights = fs.map((f) => Math.max(f.text?.length ?? 0, MIN_FIELD_WEIGHT));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const chipSteps = Math.min(Math.max(chipsRef.current - 1, 0), CHIP_STEPS_MAX);
    const chipsEnd = TYPE_MS + (chipsRef.current ? chipSteps * CHIP_STEP_MS + CHIP_TAIL_MS : 0);
    const countEnd = chipsEnd + COUNT_MS + 20;
    const shown = new Map<string, number>();
    let stageNow: RevealStage = "typing";
    let start = 0;

    const paint = (budget: number) => {
      // budget = how many weighted characters have been "typed" so far.
      let acc = 0;
      fs.forEach((f, i) => {
        const s = slots.current.get(f.key);
        const w = weights[i];
        const local = Math.min(Math.max(budget - acc, 0), w);
        const isActive = budget >= acc && budget < acc + w;
        acc += w;
        if (!s) return;
        if (f.text !== undefined && s.text) {
          const n = Math.round((local / w) * f.text.length);
          if (shown.get(f.key) !== n) {
            shown.set(f.key, n);
            s.text.textContent = f.text.slice(0, n);
            if (s.scroll && isActive) {
              s.scroll.scrollTop = s.scroll.scrollHeight;
              lastScroll.current = s.scroll.scrollTop;
            }
          }
        }
        if (s.caret) s.caret.style.opacity = isActive && f.text !== undefined ? "1" : "0";
        if (s.fade && local > 0) s.fade.style.opacity = "1";
      });
    };

    const tick = (now: number) => {
      if (!start) start = now;
      const t = now - start;
      paint(Math.min(t / TYPE_MS, 1) * total + (t >= TYPE_MS ? 1 : 0));
      const next: RevealStage = t < TYPE_MS ? "typing" : t < chipsEnd ? "chips" : t < countEnd ? "count" : "done";
      if (next !== stageNow) {
        stageNow = next;
        setStage(next);
      }
      if (next !== "done") raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [used]);

  // Skip: any tap/click or Escape during the reveal jumps straight to the final state.
  const active = stage !== "off" && stage !== "done";
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    addEventListener("pointerdown", finish, true);
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("pointerdown", finish, true);
      removeEventListener("keydown", onKey, true);
    };
  }, [active, finish]);

  return {
    stage,
    active,
    used,
    replyScrollTop: () => lastScroll.current,
    textRef: refFor("text"),
    caretRef: refFor("caret"),
    fadeRef: refFor("fade"),
    scrollRef: refFor("scroll"),
    skip: finish,
  };
}

/**
 * Text that types in during a reveal and is plain text otherwise. The full text is laid
 * out invisibly underneath so the box already has its final height: nothing moves while typing.
 */
export function Typed({ rv, k, text }: { rv: Reveal; k: string; text: string }) {
  if (!rv.active) return <>{text}</>;
  return (
    <span className="relative block" aria-hidden>
      <span className="invisible">{text || " "}</span>
      <span className="absolute inset-0">
        <span ref={rv.textRef(k)} />
        <Caret ref={rv.caretRef(k)} />
      </span>
    </span>
  );
}

export function Caret({ ref, blink, className }: { ref?: (el: HTMLElement | null) => void; blink?: boolean; className?: string }) {
  return <span ref={ref} aria-hidden className={cx("reveal-caret", blink && "reveal-caret-blink", className)} style={blink ? undefined : { opacity: 0 }} />;
}

/** Counts up from 0 to `value` once, the first time `run` is true and a value is known. */
export function CountUp({ value, run, format }: { value: number | null; run: boolean; format: (n: number) => string }) {
  const el = useRef<HTMLSpanElement>(null);
  const played = useRef(false);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    if (!run || played.current || value === null || !el.current) return;
    played.current = true;
    if (value === 0) return;
    setCounting(true);
    let start = 0;
    let id = 0;
    let finished = false;
    const step = (now: number) => {
      if (!start) start = now;
      const p = Math.min((now - start) / COUNT_MS, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      if (el.current) el.current.textContent = format(Math.round(value * eased));
      if (p < 1) id = requestAnimationFrame(step);
      else {
        finished = true;
        setCounting(false);
      }
    };
    id = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(id);
      // Interrupted before any frame ran (StrictMode remount): allow one more try. Skipped mid-way: show the final value.
      if (!finished && !start) played.current = false;
      setCounting(false);
    };
  }, [run, value, format]);

  // While counting, the rAF loop owns the text; otherwise React renders the real value.
  return <span ref={el}>{counting ? format(0) : value === null ? format(0) : format(value)}</span>;
}

/** A gray placeholder bar with the maroon-tinted shimmer. */
export function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skel-bar block rounded-md", className)} />;
}

/** Fades content in on mount (used for the reduced-motion path). */
export function FadeIn({ children }: { children: ReactNode }) {
  return <div className="reveal-fade">{children}</div>;
}
