import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanReviewPaste } from "../shared/cleaner";
import { wordCount } from "../shared/text";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("cleanReviewPaste", () => {
  it("Steve Rogers: drops header, price block, services, buttons and owner response", () => {
    const r = cleanReviewPaste(fx("steve-rogers.txt"));
    expect(r.text).toBe("Rubin and Brian did a terrific job. Very professional, skilled, courteous and efficient. Would recommend highly to everyone!");
    expect(r.confident).toBe(true);
    expect(wordCount(r.text)).toBe(18);
  });

  it("John Tapia: no price block, ends with Edit/Delete", () => {
    expect(cleanReviewPaste(fx("john-tapia.txt")).text).toBe("Malachi and Esteban were professional and very helpful!!  Sun City is a good run company.");
  });

  it("Trevor Weiss: Local Guide header and 'New' badge", () => {
    expect(cleanReviewPaste(fx("trevor-weiss.txt")).text).toBe(
      "They arrived on time, were professional, and did a great job replacing the AC Unit! Fantastic work!",
    );
  });

  it("Keith Risinger: 'Edited a month ago' date line", () => {
    expect(cleanReviewPaste(fx("keith-risinger.txt")).text).toMatch(/^Justin replaced our outside faucets.*Thank you Justin!$/);
  });

  it("Mary Spence: keeps both paragraphs", () => {
    const r = cleanReviewPaste(fx("mary-spence.txt"));
    expect(r.text.startsWith("I very rarely write reviews")).toBe(true);
    expect(r.text.endsWith("every time from now on.")).toBe(true);
    expect(r.text).toContain("\n\nThen we got Sun City");
    expect(r.text).not.toContain("Like");
    expect(wordCount(r.text)).toBeGreaterThan(120);
  });

  it("plain review text is returned unchanged", () => {
    const t = "Ruben fixed our water heater fast. Thanks!";
    expect(cleanReviewPaste(t)).toEqual({ text: t, confident: true });
  });

  it("falls back to raw when nothing is left", () => {
    const r = cleanReviewPaste("Like\nShare");
    expect(r.confident).toBe(false);
    expect(r.text).toBe("Like\nShare");
  });
});
