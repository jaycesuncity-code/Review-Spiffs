// Export downloads: the PDF is built in the browser from one authenticated report snapshot;
// the CSVs come straight from the Worker. Nothing is stored or shared anywhere.
import { periodQuery, periodSlug, toPeriod, formatGeneratedAt, type ExportPeriod } from "../../shared/period";
import { buildReportModel, type ReportData } from "../../shared/report";
import { api, ApiError } from "../api";
import regularUrl from "./fonts/Figtree-Regular.ttf?url";
import semiboldUrl from "./fonts/Figtree-SemiBold.ttf?url";
import boldUrl from "./fonts/Figtree-Bold.ttf?url";

export type CsvKind = "mentions" | "totals";

export function pdfFilename(p: ExportPeriod): string {
  return `Sun-City-Review-Spiffs-${periodSlug(p)}.pdf`;
}

export function csvFilename(p: ExportPeriod, kind: CsvKind): string {
  return `spiff-${kind}-${periodSlug(p)}.csv`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the object URL is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function fontBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn’t load the report font. Check your connection and try again.");
  return new Uint8Array(await res.arrayBuffer());
}

export async function downloadCsv(period: ExportPeriod, kind: CsvKind): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/export?${periodQuery(period)}&kind=${kind}`, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "Network error. Check your connection and try again.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("text/csv")) {
    let message = `Export failed (${res.status}).`;
    if (type.includes("application/json")) message = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? message;
    else if (res.status === 401 || res.status === 403 || type.includes("text/html")) message = "Your sign-in expired. Reload the page to sign in again.";
    throw new ApiError(res.status, message);
  }
  saveBlob(new Blob([await res.arrayBuffer()], { type: "text/csv;charset=utf-8" }), csvFilename(period, kind));
}

export async function downloadPdf(period: ExportPeriod): Promise<void> {
  const { start, end } = toPeriod(period);
  const [me, data, pdf, regular, semibold, bold] = await Promise.all([
    // Always re-read the verified identity: the name comes from the server, never from the page.
    api<{ email: string; full_name: string | null }>("/api/me"),
    api<ReportData>(`/api/report?start=${start}&end=${end}`),
    import("./pdf"),
    fontBytes(regularUrl),
    fontBytes(semiboldUrl),
    fontBytes(boldUrl),
  ]);
  if (!me.full_name) {
    throw new Error(`No verified full name is set up for ${me.email}, so the report can’t show “Prepared by.” Ask the app admin to add your name.`);
  }
  if (data.start !== start || data.end !== end) throw new Error("The report came back for a different period. Please try again.");
  const model = buildReportModel(data);
  const bytes = await pdf.buildReportPdf(model, { preparedBy: me.full_name, generatedAt: formatGeneratedAt(new Date()) }, { regular, semibold, bold });
  saveBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), pdfFilename(period));
}
