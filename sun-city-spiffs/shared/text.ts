export interface LengthBucket {
  max_words: number | null; // null = no upper bound (must be last)
  label: string;
}

export function wordCount(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}

/** First bucket whose max_words >= count; the open-ended (null) bucket catches the rest. */
export function pickBucket(buckets: LengthBucket[], count: number): { index: number; bucket: LengthBucket } {
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    if (b.max_words === null || count <= b.max_words) return { index: i, bucket: b };
  }
  const last = buckets.length - 1;
  return { index: last, bucket: buckets[last] };
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
