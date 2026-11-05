// Heuristic cleaner for reviews copied from Google Maps.
// Keeps only the review body: drops reviewer header, relative dates, price/services blocks,
// Like/Share buttons and the owner response. Falls back to the raw text when unsure.

const REL_DATE =
  /^(edited\s+)?(a|an|one|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago(\s+on\s+\w+)?$/i;

const HEADER_NOISE: RegExp[] = [
  /^\d[\d,]*\s+reviews?(\s*·.*)?$/i, // "9 reviews · 1 photo"
  /^local guide\b/i, // "Local Guide · 45 reviews · 120 photos"
  /^\d[\d,]*\s+photos?$/i,
  /^level\s+\d+$/i,
  /^new$/i,
  /^[★☆⭐\s]+$/, // star glyphs
  /^\d(\.\d)?\s*\/\s*5$/, // "5/5"
  /^(rated\s+)?\d(\.\d)?\s+(out of 5\s+)?stars?$/i,
  /^(more|…\s*more|\.\.\.\s*more)$/i,
];

const END_MARKERS: RegExp[] = [
  /^price assessment$/i,
  /^price$/i,
  /^services?$/i,
  /^like$/i,
  /^share$/i,
  /^response from the owner\b/i,
  /^edit$/i,
  /^delete$/i,
  /^visited in\b/i,
  /^(hide|report) review$/i,
];

const isNoise = (l: string) => HEADER_NOISE.some((r) => r.test(l));
const isEnd = (l: string) => END_MARKERS.some((r) => r.test(l));

export interface CleanResult {
  text: string;
  confident: boolean;
}

export function cleanReviewPaste(raw: string): CleanResult {
  const original = raw.replace(/\r\n?/g, "\n").trim();
  if (!original) return { text: "", confident: false };

  let lines = original.split("\n").map((l) => l.replace(/ /g, " ").trim());

  // Everything from the owner response onward is not the customer's text.
  const ownerIdx = lines.findIndex((l) => /^response from the owner\b/i.test(l));
  if (ownerIdx >= 0) lines = lines.slice(0, ownerIdx);

  // Body begins after the relative date line ("2 months ago"), which sits in the header.
  let start = 0;
  let sawStructure = ownerIdx >= 0;
  const dateIdx = lines.findIndex((l, i) => i < 10 && REL_DATE.test(l));
  if (dateIdx >= 0) {
    start = dateIdx + 1;
    sawStructure = true;
  } else {
    // No date line: drop a "name" line only if it is followed by header noise.
    let i = 0;
    while (i < lines.length && lines[i] === "") i++;
    if (i + 1 < lines.length && isNoise(lines[i + 1])) {
      i += 1;
      while (i < lines.length && (lines[i] === "" || isNoise(lines[i]))) i++;
      start = i;
      sawStructure = true;
    }
  }
  while (start < lines.length && (lines[start] === "" || isNoise(lines[start]) || REL_DATE.test(lines[start]))) start++;

  let stop = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (isEnd(lines[i])) {
      stop = i;
      sawStructure = true;
      break;
    }
  }

  const body = lines
    .slice(start, stop)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*(…|\.\.\.)\s*more$/i, "")
    .trim();

  if (!body) return { text: original, confident: false };
  // Plain pastes (just the review) have no structure and come back unchanged, which is correct.
  return { text: body, confident: sawStructure || body === original };
}
