// Server-side name matching and the cross-check that keeps the AI honest.
// The server never auto-picks a person on its own; it only confirms or widens the AI's answer.
import { nameTokens, normalizeName } from "../shared/names";
import type { AiOutput, AnalyzedMention, EmployeeLite } from "../shared/schemas";

export interface DirEmployee extends EmployeeLite {
  aliases: string[];
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const STOP = new Set([
  "mr", "mrs", "ms", "miss", "mister", "dr", "sir", "senor", "senora", "don", "dona",
  "the", "and", "our", "my", "tech", "technician", "plumber", "installer", "guy", "team", "from", "with",
]);

// Common nicknames -> directory first names. Keep short; the AI handles the long tail.
const NICKNAMES: Record<string, string[]> = {
  mike: ["michael", "miguel"],
  mikey: ["michael", "miguel"],
  josh: ["joshua"],
  sal: ["salvador"],
  tony: ["antonio"],
  chuy: ["jesus"],
  ray: ["raymond"],
  dan: ["daniel"],
  danny: ["daniel"],
  nate: ["nathan"],
  ben: ["benjamin"],
  will: ["william"],
  bill: ["william"],
  billy: ["william"],
  tom: ["thomas"],
  tommy: ["thomas"],
  joe: ["jose", "joseph", "joel"],
  pepe: ["jose"],
  fred: ["fredderik", "frederick"],
  freddy: ["fredderik", "frederick"],
  ike: ["isaac"],
  alex: ["alexander", "alejandro"],
  vic: ["victor"],
  jim: ["jaime", "james"],
  jimmy: ["jaime", "james"],
  rod: ["rodolfo"],
  rudy: ["rudolph"],
  jay: ["jayce", "jason"],
  rick: ["ricardo", "richard"],
  ricky: ["ricardo", "richard"],
  matt: ["matthew"],
  chris: ["christopher", "christian"],
  dave: ["david"],
};

interface Indexed {
  emp: DirEmployee;
  tokens: Set<string>; // name tokens (no suffix) + alias tokens
  suffixes: Set<string>;
}

/** Collapse common Spanish/English spelling variants: v/b, z/s, y/i, silent h, doubled letters. */
function phonetic(s: string): string {
  return s
    .replace(/ph/g, "f")
    .replace(/v/g, "b")
    .replace(/z/g, "s")
    .replace(/y/g, "i")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1");
}

/** Optimal string alignment distance (Levenshtein + adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

function strongTokenMatch(t: string, x: string): boolean {
  if (t === x) return true;
  if (t.length === 1) return x.startsWith(t); // middle initial "Jose A"
  if (NICKNAMES[t]?.includes(x)) return true;
  if (t.length >= 3 && x.length > t.length && x.startsWith(t)) return true; // "Ray" -> Raymond
  return false;
}

function fuzzyTokenMatch(t: string, x: string): boolean {
  if (t.length < 4 || x.length < 4) return false;
  if (phonetic(t) === phonetic(x)) return true;
  const limit = Math.min(t.length, x.length) >= 7 ? 2 : 1;
  return editDistance(t, x) <= limit;
}

export function indexDirectory(directory: DirEmployee[]): Indexed[] {
  return directory.map((emp) => {
    const tokens = new Set<string>();
    const suffixes = new Set<string>();
    for (const t of nameTokens(emp.full_name)) (SUFFIXES.has(t) ? suffixes : tokens).add(t);
    for (const a of emp.aliases) for (const t of nameTokens(a)) if (!SUFFIXES.has(t)) tokens.add(t);
    return { emp, tokens, suffixes };
  });
}

/** Directory ids that plausibly match a written name. Strong matches win; fuzzy only if nothing strong. */
export function serverCandidates(mentionText: string, index: Indexed[]): number[] {
  const all = nameTokens(mentionText);
  const wantSuffix = all.filter((t) => SUFFIXES.has(t));
  const tokens = all.filter((t) => !SUFFIXES.has(t) && !STOP.has(t));
  if (tokens.length === 0 || tokens.every((t) => t.length === 1)) return [];

  const pool = wantSuffix.length ? index.filter((e) => wantSuffix.every((s) => e.suffixes.has(s))) : index;

  const score = (e: Indexed, fuzzy: boolean) => {
    let exact = 0;
    for (const t of tokens) {
      const toks = [...e.tokens];
      if (toks.includes(t)) {
        exact++;
        continue;
      }
      if (toks.some((x) => strongTokenMatch(t, x))) continue;
      if (fuzzy && toks.some((x) => fuzzyTokenMatch(t, x))) continue;
      return -1;
    }
    return exact;
  };

  for (const fuzzy of [false, true]) {
    const hits = pool
      .map((e) => ({ e, s: score(e, fuzzy) }))
      .filter((h) => h.s >= 0)
      .sort((a, b) => b.s - a.s || a.e.emp.full_name.localeCompare(b.e.emp.full_name));
    if (hits.length) return hits.map((h) => h.e.emp.id);
  }
  return [];
}

const lite = (e: DirEmployee): EmployeeLite => ({
  id: e.id,
  full_name: e.full_name,
  department_id: e.department_id,
  department_name: e.department_name,
  spiff_type: e.spiff_type,
  active: e.active,
});

/**
 * Validates and cross-checks the AI's mentions against the directory:
 *  - drops unknown / inactive ids
 *  - "matched" survives only if the server's own candidate set is exactly that one person
 *  - otherwise the union of AI + server candidates is offered as "ambiguous" (user taps the right one)
 *  - deduplicates mentions that resolve to the same person
 */
export function reconcileMentions(aiMentions: AiOutput["mentions"], directory: DirEmployee[]): AnalyzedMention[] {
  const active = directory.filter((e) => e.active);
  const byId = new Map(active.map((e) => [e.id, e]));
  const index = indexDirectory(active);
  const out: AnalyzedMention[] = [];
  const seenText = new Set<string>();
  const matchedIds = new Set<number>();

  for (const m of aiMentions.slice(0, 12)) {
    const text = m.mention_text.trim();
    const key = normalizeName(text);
    if (!key || seenText.has(key)) continue;
    seenText.add(key);

    const aiIds = [...new Set(m.candidate_employee_ids.filter((id) => byId.has(id)))];
    const serverIds = serverCandidates(text, index);
    const union = [...aiIds, ...serverIds.filter((id) => !aiIds.includes(id))];

    let status: AnalyzedMention["match_status"];
    let note: string | null = null;
    if (m.match_status === "matched" && aiIds.length === 1 && serverIds.length === 1 && serverIds[0] === aiIds[0]) {
      status = "matched";
    } else if (union.length === 0) {
      status = "not_found";
    } else {
      status = "ambiguous";
      if (m.match_status === "matched") {
        note =
          serverIds.length === 0
            ? "Please confirm: this name did not clearly match the directory."
            : "More than one employee could fit this name. Tap the right one.";
      } else if (union.length === 1) {
        note = "Please confirm this is the right person.";
      }
    }

    if (status === "matched") {
      if (matchedIds.has(union[0])) continue; // same person mentioned twice
      matchedIds.add(union[0]);
    }

    out.push({
      mention_text: text,
      match_status: status,
      candidates: union.map((id) => lite(byId.get(id)!)),
      note,
    });
  }
  return out;
}
