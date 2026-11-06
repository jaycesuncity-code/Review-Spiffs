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
  signal?: AbortSignal;
}

/** The error to rethrow when a request was aborted: the abort reason if one was given, else a standard AbortError. */
function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

export async function api<T>(path: string, opts: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch {
    // An aborted request is not a network error: rethrow it so callers never retry it.
    if (opts.signal?.aborted) throw abortError(opts.signal);
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

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Use the same request_id for transient network errors and pending server requests.
 * Both endpoints share the backend's per-user AI request rate limit.
 */
async function postAiWithRetry<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let networkRetried = false;
  const started = Date.now();
  for (;;) {
    try {
      return await api<T>(path, { method: "POST", body, signal });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0 && !networkRetried) {
        networkRetried = true;
        await sleep(1500, signal);
        continue;
      }
      if (e instanceof ApiError && e.status === 409 && e.data.code === "in_progress" && Date.now() - started < 100_000) {
        await sleep(3000, signal);
        continue;
      }
      throw e;
    }
  }
}

export function analyzeWithRetry<T>(body: { request_id: string; review_raw: string; posted_date: string }, signal?: AbortSignal): Promise<T> {
  return postAiWithRetry<T>("/api/analyze", body, signal);
}

export function rewriteWithRetry<T>(body: { request_id: string; review_raw: string; posted_date: string; current_reply: string; instructions: string }): Promise<T> {
  return postAiWithRetry<T>("/api/rewrite", body);
}
