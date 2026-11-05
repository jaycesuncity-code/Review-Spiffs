import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const API_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: API_HEADERS });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: err.message, ...(err.details ?? {}) }, err.status);
  }
  // Never echo internals (could include review text). Log only the message.
  console.error("Unhandled error:", err instanceof Error ? err.message : String(err));
  return json({ error: "Something went wrong on the server. Please try again." }, 500);
}

export function zodMessage(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

export function parseWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, zodMessage(r.error));
  return r.data;
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Content-Type must be application/json");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
  return parseWith(schema, body);
}

export function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid id");
  return n;
}
