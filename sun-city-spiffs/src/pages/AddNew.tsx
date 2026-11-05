import { useEffect, useRef, useState } from "react";
import { cleanReviewPaste } from "../../shared/cleaner";
import { todayDenver, isValidDate } from "../../shared/dates";
import type { AnalyzeResult, Review } from "../../shared/schemas";
import { analyzeWithRetry } from "../api";
import { blankDraft, draftFromAnalysis, ReviewEditor, type Draft } from "../components/ReviewEditor";
import { Banner, Button, Card, inputCls, PageTitle, Spinner, useToast } from "../components/ui";
import { cx, uuid } from "../lib";
import { useRouter } from "../router";

const STORE = "review-spiffs:draft";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<Stored | null>(() => loadStored());
  const submitting = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!stored) taRef.current?.focus();
  }, [stored]);

  const begin = (s: Stored) => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(s));
    } catch {
      /* private mode */
    }
    setStored(s);
    window.scrollTo(0, 0);
  };

  const generate = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const requestId = uuid(); // reused for automatic retries of THIS submission only
    try {
      const r = await analyzeWithRetry<AnalyzeResult>({ request_id: requestId, review_raw: raw, posted_date: posted });
      begin({ saveKey: requestId, draft: draftFromAnalysis(r, raw, posted) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const manual = () => {
    // Keep the pasted text so nothing is lost; the reply is typed by hand.
    const cleaned = cleanReviewPaste(raw);
    const draft = blankDraft(raw, cleaned.text, isValidDate(posted) ? posted : todayDenver());
    draft.cleaner_confident = cleaned.confident || !raw.trim();
    // The reviewer's name is normally the first line of a Google paste.
    const first = raw.trim().split("\n")[0]?.trim() ?? "";
    if (cleaned.text !== raw.trim() && first && first.length <= 60) draft.customer_name = first;
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
    setRaw("");
    setPosted(todayDenver());
  };

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
        <ReviewEditor
          key={stored.saveKey}
          mode="new"
          initial={stored.draft}
          saveKey={stored.saveKey}
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
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-40">
      <PageTitle sub="Paste the review, pick the date, and we'll draft the reply and find the employees named.">Add a review</PageTitle>
      <div className="space-y-4">
        <Card
          title="Google review"
          actions={
            <Button size="sm" onClick={pasteFromClipboard} disabled={busy}>
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
            disabled={busy}
            placeholder={"Steve Rogers\n9 reviews · 1 photo\n\n2 months ago\nRubin and Brian did a terrific job…"}
          />
        </Card>
        <Card title="Posted date">
          <label htmlFor="posted" className="mb-2 block text-sm font-semibold text-stone-700">
            When was this review posted?
          </label>
          <input id="posted" type="date" required className={cx(inputCls, "max-w-xs")} value={posted} onChange={(e) => setPosted(e.target.value)} disabled={busy} />
          <p className="mt-2 text-sm text-stone-500">Google only shows “2 months ago”, so this date is the real one. Months group by it.</p>
        </Card>
        {error && (
          <Banner tone="error">
            <p className="font-medium">{error}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={generate}>
                Try again
              </Button>
              <Button size="sm" onClick={manual}>
                Enter manually
              </Button>
            </div>
          </Banner>
        )}
      </div>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-3 pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <Button variant="primary" size="xl" className="w-full" onClick={generate} disabled={busy || !raw.trim() || !isValidDate(posted)}>
            {busy ? (
              <>
                <Spinner /> Writing the reply…
              </>
            ) : (
              "Generate reply"
            )}
          </Button>
          {!busy && (
            <button type="button" className="min-h-11 text-sm font-semibold text-brand underline-offset-2 hover:underline" onClick={manual}>
              Skip AI and enter manually
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
