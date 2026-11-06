import { useEffect, useRef, useState } from "react";
import { cleanReviewPaste } from "../../shared/cleaner";
import { todayDenver, isValidDate } from "../../shared/dates";
import type { AnalyzeResult, Review } from "../../shared/schemas";
import { analyzeWithRetry, ApiError } from "../api";
import { prefersReducedMotion } from "../components/reveal";
import { blankDraft, draftFromAnalysis, ReviewEditor, ReviewEditorSkeleton, type Draft } from "../components/ReviewEditor";
import { Banner, Button, Card, inputCls, PageTitle, useToast } from "../components/ui";
import { cx, uuid } from "../lib";
import { useRouter } from "../router";

const STORE = "review-spiffs:draft";
/** Skeleton intro (silhouettes → chrome → labels). Must match the CSS phase timings in index.css. */
const INTRO_MS = 900;
/** Give up waiting on the AI after this long (the server already retries OpenAI and polls in-progress requests). */
const GENERATE_TIMEOUT_MS = 105_000;

/** The response screen while the AI request is in flight, or after it failed. */
type Gen = { phase: "loading" } | { phase: "error"; message: string };

interface Stored {
  saveKey: string;
  draft: Draft;
}

function loadStored(): Stored | null {
  try {
    const s = sessionStorage.getItem(STORE);
    return s ? (JSON.parse(s) as Stored) : null;
  } catch {
    return null;
  }
}

export function AddNew() {
  const { navigate } = useRouter();
  const toast = useToast();
  const [raw, setRaw] = useState("");
  const [posted, setPosted] = useState(todayDenver());
  const [stored, setStored] = useState<Stored | null>(() => loadStored());
  const [gen, setGen] = useState<Gen | null>(null);
  // A result that arrived before the intro finished waits here, so the typing never starts mid-intro.
  const [buffered, setBuffered] = useState<Stored | null>(null);
  const [introDone, setIntroDone] = useState(false);
  // Only a fresh Generate animates; a restored or re-rendered draft never replays it.
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [fadeIn, setFadeIn] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!stored) taRef.current?.focus();
  }, [stored]);

  // Leaving the page mid-load (back button, nav link) aborts the request.
  useEffect(
    () => () => {
      const c = inflight.current;
      inflight.current = null;
      c?.abort();
    },
    [],
  );

  const begin = (s: Stored, scroll = true) => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(s));
    } catch {
      /* private mode */
    }
    setStored(s);
    if (scroll) window.scrollTo(0, 0);
  };

  const generate = () => {
    if (inflight.current) return; // one request per click, never duplicated
    const c = new AbortController();
    inflight.current = c;
    const requestId = uuid(); // reused for automatic retries of THIS submission only
    const reviewRaw = raw;
    const postedDate = posted;
    // Show the response screen right away; the request runs independently of it.
    setGen({ phase: "loading" });
    setBuffered(null);
    setIntroDone(prefersReducedMotion());
    window.scrollTo(0, 0);
    const timer = setTimeout(() => c.abort(new ApiError(0, "The AI is taking too long to answer. Try again in a moment.")), GENERATE_TIMEOUT_MS);
    analyzeWithRetry<AnalyzeResult>({ request_id: requestId, review_raw: reviewRaw, posted_date: postedDate }, c.signal)
      .then((r) => {
        if (inflight.current === c) setBuffered({ saveKey: requestId, draft: draftFromAnalysis(r, reviewRaw, postedDate) });
      })
      .catch((e) => {
        if (inflight.current === c) setGen({ phase: "error", message: e instanceof Error ? e.message : "Something went wrong" });
      })
      .finally(() => {
        clearTimeout(timer);
        if (inflight.current === c) inflight.current = null;
      });
  };

  const cancel = () => {
    const c = inflight.current;
    inflight.current = null;
    c?.abort();
    setGen(null);
    setBuffered(null);
  };

  // Intro timer: independent of the API.
  useEffect(() => {
    if (gen?.phase !== "loading" || introDone) return;
    const t = setTimeout(() => setIntroDone(true), INTRO_MS);
    return () => clearTimeout(t);
  }, [gen, introDone]);

  // Result + finished intro → hand over to the editor, which plays the typing reveal.
  useEffect(() => {
    if (gen?.phase !== "loading" || !buffered || !introDone) return;
    const reduced = prefersReducedMotion();
    setGen(null);
    setBuffered(null);
    setFadeIn(reduced);
    setRevealKey(reduced ? null : buffered.saveKey);
    begin(buffered, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen, buffered, introDone]);

  const manual = () => {
    // Keep the pasted text so nothing is lost; the reply is typed by hand.
    const cleaned = cleanReviewPaste(raw);
    const draft = blankDraft(raw, cleaned.text, isValidDate(posted) ? posted : todayDenver());
    draft.cleaner_confident = cleaned.confident || !raw.trim();
    // The reviewer's name is normally the first line of a Google paste.
    const first = raw.trim().split("\n")[0]?.trim() ?? "";
    if (cleaned.text !== raw.trim() && first && first.length <= 60) draft.customer_name = first;
    setGen(null);
    begin({ saveKey: uuid(), draft });
  };

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setRaw(t);
      else toast("Clipboard is empty", "info");
    } catch {
      toast("Clipboard access was blocked. Long-press the box and choose Paste.", "info");
      taRef.current?.focus();
    }
  };

  const startOver = () => {
    sessionStorage.removeItem(STORE);
    setStored(null);
    setRevealKey(null);
    setFadeIn(false);
    setRaw("");
    setPosted(todayDenver());
  };

  if (gen) {
    return (
      <div>
        <PageTitle
          right={
            <Button size="sm" variant="ghost" onClick={cancel} className="text-brand">
              {gen.phase === "loading" ? "Cancel" : "Back"}
            </Button>
          }
        >
          Review the entry
        </PageTitle>
        {gen.phase === "loading" ? (
          <>
            <p className="sr-only" role="status">
              Drafting the reply…
            </p>
            <ReviewEditorSkeleton />
          </>
        ) : (
          <div className="reveal-fade mx-auto max-w-2xl pb-16">
            <Card title="Couldn’t draft the reply">
              <div className="space-y-4" role="alert">
                <Banner tone="error">
                  <p className="font-medium">{gen.message}</p>
                </Banner>
                <div>
                  <p className="mb-1 text-sm font-semibold text-stone-700">Your pasted review is safe</p>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm break-words whitespace-pre-wrap text-stone-700">{raw}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="lg" onClick={generate}>
                    ↻ Retry
                  </Button>
                  <Button size="lg" onClick={cancel}>
                    Edit the review
                  </Button>
                  <Button size="lg" variant="ghost" onClick={manual}>
                    Enter manually
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    );
  }

  if (stored) {
    return (
      <div>
        <PageTitle
          right={
            <Button size="sm" variant="ghost" onClick={startOver} className="text-brand">
              Start over
            </Button>
          }
        >
          Review the entry
        </PageTitle>
        <div className={fadeIn ? "reveal-fade" : undefined}>
        <ReviewEditor
          key={stored.saveKey}
          mode="new"
          initial={stored.draft}
          saveKey={stored.saveKey}
          reveal={stored.saveKey === revealKey}
          onRevealDone={() => setRevealKey(null)}
          onDraftChange={(d) => {
            try {
              sessionStorage.setItem(STORE, JSON.stringify({ saveKey: stored.saveKey, draft: d }));
            } catch {
              /* ignore */
            }
          }}
          onSaved={(review: Review) => {
            sessionStorage.removeItem(STORE);
            toast("Added to records");
            navigate(`/?month=${review.posted_date.slice(0, 7)}&highlight=${review.id}&saved=1`);
          }}
        />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-40">
      <PageTitle sub="Paste the review, pick the date, and we'll draft the reply and find the employees named.">Add a review</PageTitle>
      <div className="space-y-4">
        <Card
          title="Google review"
          actions={
            <Button size="sm" onClick={pasteFromClipboard}>
              Paste from clipboard
            </Button>
          }
        >
          <label htmlFor="raw" className="mb-2 block text-sm font-semibold text-stone-700">
            Paste the Google review (everything you copied is fine)
          </label>
          <textarea
            id="raw"
            ref={taRef}
            className={cx(inputCls, "h-[42dvh] min-h-60 leading-relaxed")}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"Steve Rogers\n9 reviews · 1 photo\n\n2 months ago\nRubin and Brian did a terrific job…"}
          />
        </Card>
        <Card title="Posted date">
          <label htmlFor="posted" className="mb-2 block text-sm font-semibold text-stone-700">
            When was this review posted?
          </label>
          <input id="posted" type="date" required className={cx(inputCls, "max-w-xs")} value={posted} onChange={(e) => setPosted(e.target.value)} />
          <p className="mt-2 text-sm text-stone-500">Site defaults to today, but don't forget to change it if the review's a few days old</p>
        </Card>
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-3 pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <Button variant="primary" size="xl" className="w-full" onClick={generate} disabled={!raw.trim() || !isValidDate(posted)}>
            Generate reply
          </Button>
          <button type="button" className="min-h-11 text-sm font-semibold text-brand underline-offset-2 hover:underline" onClick={manual}>
            Skip AI and enter manually
          </button>
        </div>
      </div>
    </div>
  );
}
