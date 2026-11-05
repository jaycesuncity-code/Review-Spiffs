// Name normalization shared by the Worker, the seed generator and the UI search box.
// Lowercase, strip accents and punctuation, collapse whitespace.
// "Raymond Fonseca Jr." -> "raymond fonseca jr", "Brian Varela-Moraga" -> "brian varela moraga".
export function normalizeName(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nameTokens(input: string): string[] {
  const n = normalizeName(input);
  return n ? n.split(" ") : [];
}

/** First name as spelled in the directory ("Raymond Fonseca Jr." -> "Raymond"). */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}
