export function uuid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Department chip colors, following the company directory color coding. */
export function deptClasses(department: string): string {
  const d = department.toLowerCase();
  if (d.includes("hvac service")) return "bg-red-100 text-red-900 ring-red-300";
  if (d.includes("hvac install")) return "bg-rose-200 text-rose-950 ring-rose-400";
  if (d.includes("new construction")) return "bg-orange-100 text-orange-900 ring-orange-300";
  if (d.includes("plumbing service")) return "bg-sky-100 text-sky-900 ring-sky-300";
  if (d.includes("plumbing install")) return "bg-indigo-100 text-indigo-950 ring-indigo-300";
  if (d.includes("manager")) return "bg-stone-200 text-stone-800 ring-stone-400";
  return "bg-stone-100 text-stone-800 ring-stone-300";
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
