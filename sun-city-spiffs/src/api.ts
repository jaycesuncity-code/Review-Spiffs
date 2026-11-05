export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, any> = {},
  ) {
    super(message);
  }
}

interface Opts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Network error. Check your connection and try again.");
  }
  let data: any = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Cloudflare Access may answer with an HTML login page when the session expired.
    if (res.status === 401 || res.status === 403 || /<html/i.test(text)) {
      throw new ApiError(401, "Your sign-in expired. Reload the page to sign in again.");
    }
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data ?? {});
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/analyze with the same request_id for automatic retries:
 * - one retry after a network failure
 * - polls while the server says the same request is still in progress
 */
export async function analyzeWithRetry<T>(body: { request_id: string; review_raw: string; posted_date: string }): Promise<T> {
  let networkRetried = false;
  const started = Date.now();
  for (;;) {
    try {
      return await api<T>("/api/analyze", { method: "POST", body });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0 && !networkRetried) {
        networkRetried = true;
        await sleep(1500);
        continue;
      }
      if (e instanceof ApiError && e.status === 409 && e.data.code === "in_progress" && Date.now() - started < 100_000) {
        await sleep(3000);
        continue;
      }
      throw e;
    }
  }
}
