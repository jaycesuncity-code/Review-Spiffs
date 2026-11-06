// The "All Nice and Pretty" report: a vector, text-selectable PDF on US Letter portrait.
// Pure layout: takes the reconciled report model, the verified "Prepared by" name and font bytes,
// returns PDF bytes. No DOM, so the same code is exercised by unit tests and print QA.
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { isWholeMonth, periodRangeShort, periodTitle, shortDate } from "../../shared/period";
import type { ReportLogRow, ReportModel } from "../../shared/report";
import { formatCents } from "../../shared/text";

export interface PdfFonts {
  regular: Uint8Array;
  semibold: Uint8Array;
  bold: Uint8Array;
}

export interface PdfMeta {
  /** The signed-in person's verified full name. */
  preparedBy: string;
  /** "November 6, 2026 at 2:15 PM MST" (America/Denver). */
  generatedAt: string;
}

// ---------- Page geometry (points; 72 pt = 1 in) ----------
const PAGE_W = 612; // 8.5 in
const PAGE_H = 792; // 11 in
const MARGIN = 36; // 0.5 in on every side
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = PAGE_H - MARGIN;
const FOOTER_RULE_Y = MARGIN + 16;
const BODY_BOTTOM = FOOTER_RULE_Y + 12;

// ---------- Palette ----------
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const MAROON = hex("#9a0d28");
const MAROON_DARK = hex("#6f0a1f");
const GOLD = hex("#c9a84c");
const INK = hex("#231f1e");
const BODY = hex("#3a3533");
const MUTED = hex("#77706c");
const RULE = hex("#d8d2cf");
const ZEBRA = hex("#f6f4f3");
const TILE = hex("#faf8f7");
const TOTAL_FILL = hex("#f8edef");
const WHITE = rgb(1, 1, 1);

// ---------- Type ----------
const BODY_SIZE = 8.6;
const LINE = 11.2;
const CELL_PAD_X = 6;
const CELL_PAD_Y = 4.6;
const HEAD_H = 19;

type Align = "left" | "right" | "center";
interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
}

/** Characters the embedded font can draw; anything else becomes its accent-free form or "?". */
function makeSanitizer(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (raw: string): string => {
    let out = "";
    for (const ch of raw.replace(/[\r\n\t]+/g, " ")) {
      const cp = ch.codePointAt(0)!;
      if (supported.has(cp)) out += ch;
      else if (cp < 32 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d) continue;
      else {
        const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
        out += base && [...base].every((c) => supported.has(c.codePointAt(0)!)) ? base : "?";
      }
    }
    return out.replace(/\s+/g, " ").trim();
  };
}

/**
 * Word-wraps to `width`. Breaks at spaces first, then after hyphens ("Abernathy-" / "Montgomery"),
 * and only breaks inside a word by character when nothing else fits. Always returns at least one line.
 */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const w = (s: string) => font.widthOfTextAtSize(s, size);
  // Tokens carry whether they follow a space ("Jo Ann") or glue onto the previous hyphen ("Abernathy-Montgomery").
  const tokens: { t: string; space: boolean }[] = [];
  for (const word of text.split(" ").filter(Boolean)) {
    word.split(/(?<=-)(?=.)/).forEach((t, i) => tokens.push({ t, space: i === 0 }));
  }
  const lines: string[] = [];
  let line = "";
  for (const { t, space } of tokens) {
    const candidate = line ? line + (space ? " " : "") + t : t;
    if (w(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = t;
    while (w(rest) > width) {
      let n = rest.length - 1;
      while (n > 1 && w(rest.slice(0, n)) > width) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

/** Largest size (down to `min`) at which `text` fits `width` on one line. */
function fitSize(text: string, font: PDFFont, size: number, width: number, min: number): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > width) s -= 0.25;
  return s;
}


// ---------- Table model ----------
interface Column {
  title: string;
  /** Optional second header label drawn right-aligned in the same header cell. */
  titleRight?: string;
  width: number;
  align: Align;
}

interface Row {
  height: number;
  /** Draws the row's contents with its top edge at `top`. */
  draw: (page: PDFPage, top: number) => void;
  fill?: RGB;
  /** Rule drawn above the row (used for total lines). */
  ruleAbove?: RGB;
}

class Report {
  private pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = 0;
  private clean: (s: string) => string;

  constructor(
    private doc: PDFDocument,
    private f: Fonts,
    private model: ReportModel,
    private meta: PdfMeta,
  ) {
    this.clean = makeSanitizer(f.regular);
  }

  // ----- primitives -----
  private text(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size: number, color: RGB, align: Align = "left", width = 0) {
    const t = this.clean(s);
    if (!t) return;
    const tw = font.widthOfTextAtSize(t, size);
    const dx = align === "right" ? width - tw : align === "center" ? (width - tw) / 2 : 0;
    page.drawText(t, { x: x + dx, y, font, size, color });
  }

  private trackedWidth(s: string, font: PDFFont, size: number, spacing: number) {
    const chars = [...this.clean(s)];
    return chars.reduce((a, c) => a + font.widthOfTextAtSize(c, size), 0) + spacing * Math.max(0, chars.length - 1);
  }

  /** Letter-spaced label; pdf-lib has no tracking option, so glyphs are placed one by one. */
  private tracked(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size: number, color: RGB, spacing: number, align: Align = "left", width = 0) {
    const t = this.clean(s);
    const total = this.trackedWidth(t, font, size, spacing);
    let cx = x + (align === "right" ? width - total : align === "center" ? (width - total) / 2 : 0);
    for (const c of t) {
      if (c !== " ") page.drawText(c, { x: cx, y, font, size, color });
      cx += font.widthOfTextAtSize(c, size) + spacing;
    }
  }

  private rule(page: PDFPage, y: number, color: RGB, thickness: number, x = MARGIN, w = CONTENT_W) {
    page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness, color });
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = this.pages.length === 1 ? this.firstHeader() : this.runningHeader();
  }

  private room() {
    return this.y - BODY_BOTTOM;
  }

  // ----- headers & footers -----
  private firstHeader(): number {
    const p = this.page;
    const { regular, semibold, bold } = this.f;
    const period = { start: this.model.start, end: this.model.end };
    const title = periodTitle(period);
    const rightW = 250;

    this.tracked(p, "SUN CITY PLUMBING & HEATING", MARGIN, TOP - 9, bold, 8.6, MAROON, 1.5);
    this.text(p, "Google Review Spiff Report", MARGIN, TOP - 33, bold, 21, INK);
    this.text(p, `Generated ${this.meta.generatedAt}`, MARGIN, TOP - 49, regular, 7.8, MUTED);

    const rx = PAGE_W - MARGIN - rightW;
    this.tracked(p, "REPORTING PERIOD", rx, TOP - 9, semibold, 7, MUTED, 1.2, "right", rightW);
    const ts = fitSize(title, bold, 15, rightW, 10);
    this.text(p, title, rx, TOP - 29, bold, ts, MAROON, "right", rightW);
    if (isWholeMonth(period)) this.text(p, periodRangeShort(period), rx, TOP - 43, regular, 8, MUTED, "right", rightW);

    const ruleY = TOP - 62;
    this.rule(p, ruleY, MAROON, 2);
    this.rule(p, ruleY - 3, GOLD, 0.75);
    return ruleY - 18;
  }

  private runningHeader(): number {
    const p = this.page;
    const title = periodTitle({ start: this.model.start, end: this.model.end });
    this.tracked(p, "SUN CITY PLUMBING & HEATING", MARGIN, TOP - 8, this.f.bold, 7.2, MAROON, 1.2);
    const w = this.trackedWidth("SUN CITY PLUMBING & HEATING", this.f.bold, 7.2, 1.2);
    this.text(p, "·", MARGIN + w + 5, TOP - 8, this.f.semibold, 7.6, MUTED);
    this.text(p, "Google Review Spiff Report", MARGIN + w + 13, TOP - 8, this.f.semibold, 7.6, BODY);
    this.text(p, title, MARGIN, TOP - 8, this.f.semibold, 7.6, MAROON, "right", CONTENT_W);
    this.rule(p, TOP - 15, MAROON, 1);
    this.rule(p, TOP - 17.25, GOLD, 0.5);
    return TOP - 32;
  }

  private footers() {
    const n = this.pages.length;
    const { regular, semibold } = this.f;
    this.pages.forEach((p, i) => {
      this.rule(p, FOOTER_RULE_Y, RULE, 0.6);
      const y = FOOTER_RULE_Y - 13;
      const label = "Prepared by: ";
      this.text(p, label, MARGIN, y, semibold, 8, MUTED);
      this.text(p, this.meta.preparedBy, MARGIN + semibold.widthOfTextAtSize(label, 8), y, semibold, 8, INK);
      this.text(p, `Page ${i + 1} of ${n}`, MARGIN, y, regular, 8, MUTED, "right", CONTENT_W);
    });
  }

  // ----- summary figures -----
  private metrics() {
    const p = this.page;
    const gap = 12;
    const h = 66;
    const w = (CONTENT_W - gap * 2) / 3;
    const top = this.y;
    const tiles: [string, string, RGB][] = [
      ["# Of Reviews", this.model.reviewCount.toLocaleString("en-US"), INK],
      ["Employee Mentioned", this.model.mentionCount.toLocaleString("en-US"), INK],
      ["Total Spiff $'s", formatCents(this.model.totalCents), MAROON],
    ];
    tiles.forEach(([label, value, color], i) => {
      const x = MARGIN + i * (w + gap);
      p.drawRectangle({ x, y: top - h, width: w, height: h, color: TILE, borderColor: RULE, borderWidth: 0.6 });
      p.drawRectangle({ x, y: top - h, width: 3, height: h, color: MAROON });
      this.text(p, label, x + 15, top - 20, this.f.semibold, 9, MUTED);
      const size = fitSize(value, this.f.bold, 27, w - 30, 14);
      this.text(p, value, x + 15, top - h + 15, this.f.bold, size, color);
    });
    this.y = top - h - 26;
  }

  // ----- sections & tables -----
  private sectionTitle(title: string, continued: boolean) {
    const p = this.page;
    const base = this.y - 12;
    p.drawRectangle({ x: MARGIN, y: base - 1.5, width: 3, height: 13, color: GOLD });
    this.text(p, title, MARGIN + 10, base, this.f.bold, 12, INK);
    if (continued) this.text(p, "(continued)", MARGIN + 10 + this.f.bold.widthOfTextAtSize(title, 12) + 7, base, this.f.regular, 8.5, MUTED);
    this.y -= 22;
  }

  private tableHeader(cols: Column[]) {
    const p = this.page;
    const top = this.y;
    p.drawRectangle({ x: MARGIN, y: top - HEAD_H, width: CONTENT_W, height: HEAD_H, color: MAROON });
    let x = MARGIN;
    const base = top - HEAD_H + 6.4;
    for (const c of cols) {
      this.text(p, c.title, x + CELL_PAD_X, base, this.f.semibold, 8, WHITE, c.titleRight ? "left" : c.align, c.width - CELL_PAD_X * 2);
      if (c.titleRight) this.text(p, c.titleRight, x + CELL_PAD_X, base, this.f.semibold, 8, WHITE, "right", c.width - CELL_PAD_X * 2);
      x += c.width;
    }
    this.y = top - HEAD_H;
  }

  /**
   * Lays out a table across as many pages as it needs. A row never splits; when it does not fit,
   * it moves to the next page under a repeated section title and column header. The section title
   * never sits alone at the bottom of a page.
   */
  private table(title: string, cols: Column[], rows: Row[]) {
    const first = rows[0]?.height ?? 0;
    if (this.room() < 22 + HEAD_H + first + 4) this.newPage();
    this.sectionTitle(title, false);
    this.tableHeader(cols);
    let stripe = 0;
    for (const row of rows) {
      if (row.height > this.room()) {
        this.rule(this.page, this.y, RULE, 0.6);
        this.newPage();
        this.sectionTitle(title, true);
        this.tableHeader(cols);
        stripe = 0;
      }
      const p = this.page;
      const fill = row.fill ?? (stripe % 2 === 1 ? ZEBRA : undefined);
      if (fill) p.drawRectangle({ x: MARGIN, y: this.y - row.height, width: CONTENT_W, height: row.height, color: fill });
      if (row.ruleAbove) this.rule(p, this.y, row.ruleAbove, 0.9);
      row.draw(p, this.y);
      this.y -= row.height;
      stripe++;
    }
    this.rule(this.page, this.y, MAROON, 0.9);
    this.y -= 26;
  }

  /** A simple one-line-per-cell row (wrapping where needed). */
  private simpleRow(cols: Column[], cells: string[], font: PDFFont, color: RGB = BODY, opts: Partial<Row> = {}): Row {
    const wrapped = cells.map((c, i) => wrap(this.clean(c), font, BODY_SIZE, cols[i].width - CELL_PAD_X * 2));
    const lines = Math.max(...wrapped.map((w) => w.length));
    return {
      height: lines * LINE + CELL_PAD_Y * 2,
      draw: (p, top) => {
        let x = MARGIN;
        wrapped.forEach((ls, i) => {
          ls.forEach((l, j) => this.text(p, l, x + CELL_PAD_X, top - CELL_PAD_Y - 8.4 - j * LINE, font, BODY_SIZE, color, cols[i].align, cols[i].width - CELL_PAD_X * 2));
          x += cols[i].width;
        });
      },
      ...opts,
    };
  }

  private totalRow(cols: Column[], cells: string[]): Row {
    return this.simpleRow(cols, cells, this.f.bold, INK, { fill: TOTAL_FILL, ruleAbove: MAROON });
  }

  private emptyRow(message: string): Row {
    return {
      height: LINE + CELL_PAD_Y * 2 + 4,
      draw: (p, top) => this.text(p, message, MARGIN + CELL_PAD_X, top - CELL_PAD_Y - 10.4, this.f.regular, BODY_SIZE, MUTED),
    };
  }

  private employeeSummary() {
    const cols: Column[] = [
      { title: "Employee", width: 214, align: "left" },
      { title: "Department", width: 170, align: "left" },
      { title: "QTY (mentions)", width: 70, align: "right" },
      { title: "Total Spiff", width: 86, align: "right" },
    ];
    const m = this.model;
    const rows: Row[] = m.employees.map((e) => this.simpleRow(cols, [e.name, e.department, e.mentions.toLocaleString("en-US"), formatCents(e.total_cents)], this.f.regular));
    if (rows.length === 0) rows.push(this.emptyRow("No employees were mentioned in this period."));
    rows.push(this.totalRow(cols, ["Total", "", m.mentionCount.toLocaleString("en-US"), formatCents(m.totalCents)]));
    this.table("Employee Summary", cols, rows);
  }

  private departmentSubtotals() {
    const cols: Column[] = [
      { title: "Department", width: 384, align: "left" },
      { title: "QTY (mentions)", width: 70, align: "right" },
      { title: "Total Spiff", width: 86, align: "right" },
    ];
    const m = this.model;
    const rows: Row[] = m.departments.map((d) => this.simpleRow(cols, [d.name, d.mentions.toLocaleString("en-US"), formatCents(d.total_cents)], this.f.regular));
    if (rows.length === 0) rows.push(this.emptyRow("No department credit in this period."));
    rows.push(this.totalRow(cols, ["Total", m.mentionCount.toLocaleString("en-US"), formatCents(m.totalCents)]));
    this.table("Department Subtotals", cols, rows);
  }

  private reviewLog() {
    const cols: Column[] = [
      { title: "Date", width: 62, align: "left" },
      { title: "Customer", width: 104, align: "left" },
      { title: "Employee(s)", titleRight: "Spiff", width: 164, align: "left" },
      { title: "Department(s)", width: 114, align: "left" },
      { title: "Stars", width: 36, align: "center" },
      { title: "Review Total", width: 60, align: "right" },
    ];
    const inner = (i: number) => cols[i].width - CELL_PAD_X * 2;
    const maxRow = PAGE_H - MARGIN - 32 - 22 - HEAD_H - BODY_BOTTOM - 2; // one full continuation page
    const rows: Row[] = [];
    for (const r of this.model.reviews) rows.push(...this.logRows(r, cols, inner, maxRow));
    if (rows.length === 0) rows.push(this.emptyRow("No reviews were recorded in this period."));
    this.table("Review Log", cols, rows);
  }

  /**
   * One row per review. Each credited employee gets their own line with their own saved amount
   * and saved department. A review with so many mentions that it cannot fit on one page is split
   * into labeled parts, so nothing is ever clipped.
   */
  private logRows(r: ReportLogRow, cols: Column[], inner: (i: number) => number, maxRow: number): Row[] {
    const { regular, semibold } = this.f;
    const date = wrap(shortDate(r.posted_date), regular, BODY_SIZE, inner(0));
    const customer = wrap(this.clean(r.customer_name), semibold, BODY_SIZE, inner(1));
    const stars = r.star_rating === null ? "—" : `${r.star_rating}/5`;
    const total = formatCents(r.total_cents);

    const amountW = 46;
    const subs = r.mentions.map((m) => {
      const amount = formatCents(m.amount_cents);
      const name = wrap(this.clean(m.employee_name_snapshot), regular, BODY_SIZE, inner(2) - amountW - 4);
      const dept = wrap(this.clean(m.department_name_snapshot), regular, BODY_SIZE, inner(3));
      return { name, dept, amount, lines: Math.max(name.length, dept.length) };
    });

    const fixedLines = Math.max(date.length, customer.length);
    // Group mention lines into parts that each fit a page.
    const parts: (typeof subs)[] = [[]];
    let used = 0;
    const cap = Math.floor((maxRow - CELL_PAD_Y * 2) / LINE);
    for (const s of subs) {
      if (used + s.lines > cap && parts[parts.length - 1].length) {
        parts.push([]);
        used = 0;
      }
      parts[parts.length - 1].push(s);
      used += s.lines;
    }

    return parts.map((part, pi) => {
      const firstPart = pi === 0;
      const subLines = part.reduce((a, s) => a + s.lines, 0) || 1;
      const lines = Math.max(subLines, firstPart ? fixedLines : 2);
      return {
        height: lines * LINE + CELL_PAD_Y * 2,
        draw: (p: PDFPage, top: number) => {
          const base = (j: number) => top - CELL_PAD_Y - 8.4 - j * LINE;
          const xs = cols.reduce<number[]>((a, c, i) => [...a, i === 0 ? MARGIN : a[i - 1] + cols[i - 1].width], []);
          if (firstPart) {
            date.forEach((l, j) => this.text(p, l, xs[0] + CELL_PAD_X, base(j), regular, BODY_SIZE, BODY));
            customer.forEach((l, j) => this.text(p, l, xs[1] + CELL_PAD_X, base(j), semibold, BODY_SIZE, INK));
            this.text(p, stars, xs[4] + CELL_PAD_X, base(0), regular, BODY_SIZE, r.star_rating === null ? MUTED : BODY, "center", inner(4));
            this.text(p, total, xs[5] + CELL_PAD_X, base(0), semibold, BODY_SIZE, INK, "right", inner(5));
          } else {
            customer.slice(0, 1).forEach((l) => this.text(p, l, xs[1] + CELL_PAD_X, base(0), semibold, BODY_SIZE, INK));
            this.text(p, `(continued, part ${pi + 1} of ${parts.length})`, xs[1] + CELL_PAD_X, base(1), regular, 7.6, MUTED);
          }
          if (part.length === 0) {
            this.text(p, "None", xs[2] + CELL_PAD_X, base(0), regular, BODY_SIZE, MUTED);
            this.text(p, "—", xs[3] + CELL_PAD_X, base(0), regular, BODY_SIZE, MUTED);
            return;
          }
          let j = 0;
          for (const s of part) {
            s.name.forEach((l, k) => this.text(p, l, xs[2] + CELL_PAD_X, base(j + k), regular, BODY_SIZE, BODY));
            this.text(p, s.amount, xs[2] + CELL_PAD_X, base(j), regular, BODY_SIZE, BODY, "right", inner(2));
            s.dept.forEach((l, k) => this.text(p, l, xs[3] + CELL_PAD_X, base(j + k), regular, BODY_SIZE, BODY));
            j += s.lines;
          }
        },
      };
    });
  }

  build() {
    this.newPage();
    this.metrics();
    this.employeeSummary();
    this.departmentSubtotals();
    this.reviewLog();
    this.footers();
  }
}

export async function buildReportPdf(model: ReportModel, meta: PdfMeta, fontBytes: PdfFonts): Promise<Uint8Array> {
  if (!meta.preparedBy.trim()) throw new Error("A verified full name is required for Prepared by.");
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await doc.embedFont(fontBytes.regular, { subset: true }),
    semibold: await doc.embedFont(fontBytes.semibold, { subset: true }),
    bold: await doc.embedFont(fontBytes.bold, { subset: true }),
  };
  const title = periodTitle({ start: model.start, end: model.end });
  doc.setTitle(`Google Review Spiff Report: ${title}`);
  doc.setAuthor(meta.preparedBy);
  doc.setSubject(`Sun City Plumbing & Heating, ${model.start} to ${model.end}`);
  doc.setCreator("Sun City Review Spiffs");
  doc.setProducer("Sun City Review Spiffs");
  doc.setLanguage("en-US");
  new Report(doc, fonts, model, meta).build();
  return doc.save();
}
