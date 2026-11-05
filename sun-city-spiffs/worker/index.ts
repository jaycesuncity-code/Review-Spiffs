import { todayDenver } from "../shared/dates";
import { handleAnalyze } from "./analyze";
import { authenticate } from "./auth";
import { getSettings } from "./db";
import type { Env } from "./env";
import { errorResponse, HttpError, json, parseId, readJson } from "./http";
import { createExample, deleteExample, listChangeLog, listExamples, putSettings, updateExample } from "./routes/admin";
import {
  createEmployee,
  createSpiffRule,
  listDepartments,
  listEmployees,
  listSpiffRules,
  updateDepartment,
  updateEmployee,
} from "./routes/directory";
import { calcPreview, createReview, deleteReview, exportCsv, listMonths, listReviews, loadReview, updateReview } from "./routes/reviews";
import { z } from "zod";

type Ctx = { req: Request; env: Env; url: URL; user: string; params: string[] };
type Handler = (c: Ctx) => Promise<Response>;

const anyJson = z.unknown();
const body = (c: Ctx) => readJson(c.req, anyJson);

const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/me$/, async (c) => json({ email: c.user, environment: c.env.ENVIRONMENT ?? "production", today: todayDenver() })],
  ["GET", /^\/api\/months$/, async (c) => json(await listMonths(c.env.DB))],
  ["GET", /^\/api\/reviews$/, async (c) => json(await listReviews(c.env.DB, c.url.searchParams.get("month") ?? ""))],
  [
    "GET",
    /^\/api\/reviews\/(\d+)$/,
    async (c) => {
      const r = await loadReview(c.env.DB, parseId(c.params[0]));
      if (!r) throw new HttpError(404, "Entry not found");
      return json({ review: r });
    },
  ],
  ["POST", /^\/api\/reviews$/, async (c) => json(await createReview(c.env, c.user, await body(c)), 201)],
  ["PUT", /^\/api\/reviews\/(\d+)$/, async (c) => json(await updateReview(c.env, c.user, parseId(c.params[0]), await body(c)))],
  ["DELETE", /^\/api\/reviews\/(\d+)$/, async (c) => json(await deleteReview(c.env, c.user, parseId(c.params[0])))],
  ["POST", /^\/api\/analyze$/, async (c) => json(await handleAnalyze(c.env, c.user, await body(c)))],
  ["POST", /^\/api\/calc$/, async (c) => json(await calcPreview(c.env, await body(c)))],
  ["GET", /^\/api\/export$/, async (c) => exportCsv(c.env.DB, c.url.searchParams.get("month") ?? "", c.url.searchParams.get("kind") ?? "mentions")],

  ["GET", /^\/api\/employees$/, async (c) => json(await listEmployees(c.env.DB, c.url))],
  ["POST", /^\/api\/employees$/, async (c) => json(await createEmployee(c.env, c.user, await body(c)), 201)],
  ["PUT", /^\/api\/employees\/(\d+)$/, async (c) => json(await updateEmployee(c.env, c.user, parseId(c.params[0]), await body(c)))],
  ["GET", /^\/api\/departments$/, async (c) => json(await listDepartments(c.env.DB))],
  ["PUT", /^\/api\/departments\/(\d+)$/, async (c) => json(await updateDepartment(c.env, c.user, parseId(c.params[0]), await body(c)))],
  ["GET", /^\/api\/spiff-rules$/, async (c) => json(await listSpiffRules(c.env.DB))],
  ["POST", /^\/api\/spiff-rules$/, async (c) => json(await createSpiffRule(c.env, c.user, await body(c)), 201)],

  ["GET", /^\/api\/settings$/, async (c) => json({ settings: await getSettings(c.env.DB) })],
  ["PUT", /^\/api\/settings$/, async (c) => json(await putSettings(c.env, c.user, await body(c)))],
  ["GET", /^\/api\/examples$/, async (c) => json(await listExamples(c.env.DB))],
  ["POST", /^\/api\/examples$/, async (c) => json(await createExample(c.env, c.user, await body(c)), 201)],
  ["PUT", /^\/api\/examples\/(\d+)$/, async (c) => json(await updateExample(c.env, c.user, parseId(c.params[0]), await body(c)))],
  ["DELETE", /^\/api\/examples\/(\d+)$/, async (c) => json(await deleteExample(c.env, c.user, parseId(c.params[0])))],
  ["GET", /^\/api\/changelog$/, async (c) => json(await listChangeLog(c.env.DB, c.url))],
];

/** Same-origin only for anything that changes data. */
function assertSameOrigin(req: Request, url: URL) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site requests are not allowed");
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) throw new HttpError(403, "Cross-origin requests are not allowed");
}

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

async function handleApi(req: Request, env: Env, url: URL, user: string): Promise<Response> {
  assertSameOrigin(req, url);
  for (const [method, pattern, handler] of routes) {
    const m = url.pathname.match(pattern);
    if (!m) continue;
    if (req.method !== method) continue;
    return handler({ req, env, url, user, params: m.slice(1) });
  }
  const pathExists = routes.some(([, p]) => p.test(url.pathname));
  throw new HttpError(pathExists ? 405 : 404, pathExists ? "Method not allowed" : "Not found");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const isApi = url.pathname.startsWith("/api/");
    try {
      const user = await authenticate(req, env);
      if (!user) {
        return isApi
          ? json({ error: "Not signed in. Reload the page to sign in through Cloudflare Access." }, 401)
          : new Response("Unauthorized. This app is only available through Cloudflare Access.", { status: 401, headers: { "Content-Type": "text/plain" } });
      }
      if (isApi) return await handleApi(req, env, url, user);

      const asset = await env.ASSETS.fetch(req);
      const res = new Response(asset.body, asset);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
      return res;
    } catch (err) {
      return errorResponse(err);
    }
  },
} satisfies ExportedHandler<Env>;
