# Review Spiffs · Sun City Plumbing & Heating

Internal tool: paste a Google review, get a draft company reply plus the employees it names, confirm who was meant, and press **Add all to records**. The app calculates spiffs itself (the AI never decides money), logs every change, and replaces the old monthly Excel workbook.

**Stack:** one Cloudflare Worker serving both the API (`/api/*`) and the React + Vite + Tailwind build (Workers static assets), D1 (SQLite), and the OpenAI Responses API with strict Structured Outputs. TypeScript throughout, zod on every API boundary.

> **Why a Worker and not Pages?** Cloudflare now points new full-stack projects to Workers with static assets; Pages still works but new features land on Workers. A Worker also deploys straight from GitHub (Workers Builds), so the workflow is the same as Pages.

---

## Current state

- **D1 database is already created and seeded:** `review-spiffs` (id `cb35f97b-4d83-428a-9f17-4d8e0ae88056`, western North America), already in `wrangler.toml`. Both migrations are recorded as applied, so `wrangler d1 migrations apply` only runs future migrations.
- You still need to do these yourself: connect the repo, set the OpenAI secret, and put Cloudflare Access in front.

---

## One-time setup

### 1. Push to GitHub
```bash
git init && git add . && git commit -m "Review Spiffs"
git remote add origin git@github.com:<you>/review-spiffs.git
git push -u origin main
```

### 2. Connect the repo to Cloudflare (Workers Builds)
Dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick the repo.

| Setting | Value |
|---|---|
| Project / Worker name | `review-spiffs` (must match `name` in `wrangler.toml`) |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

Every push to `main` now builds and deploys. The first deploy succeeds, but the app answers **500 "Server is not configured"** until step 4 is done. That's on purpose: it fails closed.

### 3. Add the OpenAI key (secret)
Worker → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `OPENAI_API_KEY`.
(Or from a terminal: `npx wrangler login` then `npx wrangler secret put OPENAI_API_KEY`.)
Secrets survive deploys. Never put the key in the repo.

### 4. Put Cloudflare Access in front (required)
The Worker verifies the Access JWT (`Cf-Access-Jwt-Assertion`: signature via your team's JWKS, issuer, AUD) on **every** request, assets included. Without a valid token, every request gets a 401.

**Option A: no custom domain (simplest)**
1. Worker → **Settings** → **Domains & Routes** → `workers.dev` → **Enable Cloudflare Access**.
2. **Manage Cloudflare Access**: set the policy to your email(s) or your company email domain.
3. Copy the **Application Audience (AUD) Tag** (Zero Trust → Access → Applications → this app).
4. Your team domain is `https://<team-name>.cloudflareaccess.com` (Zero Trust → Settings → Team name).

**Option B: custom domain** (e.g. `spiffs.yourdomain.com`, zone must be on Cloudflare)
1. Uncomment and edit `routes` in `wrangler.toml`.
2. Zero Trust → Access → Applications → **Add** → Self-hosted → that hostname → policy with your emails.
3. Copy that app's AUD tag. Set `workers_dev = false` in `wrangler.toml` so the workers.dev URL is off.

Then edit `wrangler.toml` and push:
```toml
[vars]
CF_ACCESS_TEAM_DOMAIN = "https://<team-name>.cloudflareaccess.com"
CF_ACCESS_AUD = "<aud tag>"            # comma-separate if more than one Access app points here
```
`preview_urls = false` is already set, so preview links can't bypass Access.

### 5. Open the app
Sign in through Access. The footer shows "Signed in as you@…". First things to check: **Settings → Employees** (see the note on Jermaine Yancey below), then add a test review.

---

## Changing the database later
Add a new file in `migrations/` (`0003_something.sql`), then either:
- run it from your machine: `npx wrangler login` then `npm run db:migrate:remote`, or
- let deploys run it: give the Workers Builds API token **D1 → Edit** (My Profile → API Tokens), then change the deploy command to
  `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`.

`scripts/gen-seed.ts` only generated the initial `0002_seed.sql`. Don't edit an applied migration; after the first deploy, change data in the app.

## Local development
```bash
npm install
cp .dev.vars.example .dev.vars          # ENVIRONMENT=dev, DEV_USER_EMAIL, OPENAI_API_KEY
npm run db:migrate:local                # local D1 in .wrangler/
npm run dev                             # build + wrangler dev on http://localhost:8787
# or, with hot reload: `npm run dev:api` in one terminal and `npm run dev:web` (http://localhost:5173) in another
npm test                                # spiff math, paste cleaner, matching cross-check, idempotency (Node ≥ 22.13)
npm run typecheck
```
The `DEV_USER_EMAIL` bypass only works when **both** `ENVIRONMENT=dev` (set only in `.dev.vars`, which deploys never use) **and** the request is to `localhost`. A deployed Worker never satisfies both.

## Everyday admin (all in Settings, all logged)
- **Change a rate:** Settings → Spiff rules → *Add new rate effective from…*. Old rates are kept. Each review uses the latest rate on or before its posted date. Saved entries never change unless you edit that entry's employees or date.
- **Change a department's spiff type:** same tab, Departments list.
- **Reply voice / length / model:** Settings → Reply instructions. The fixed safety contract is appended by the app and can't be removed.
- **Reply examples:** Settings → Examples (add, edit, activate/deactivate, delete).
- **Employees:** add, rename, change department, aliases, deactivate (never deleted).
- **Audit:** Settings → Changes log (filter by user, type, dates). The database itself rejects UPDATE/DELETE on `change_log`.

---

## How it works (short)
- **`POST /api/analyze`**: idempotent by `request_id` (a repeat returns the stored result and never calls OpenAI again; an in-flight repeat younger than 90 s gets a 409). Rate limit is 30/user/hour. The paste is cleaned (`shared/cleaner.ts`), the length bucket is picked, examples (half from the same bucket) and the last 3 saved replies are added, and the request goes to OpenAI with a strict JSON schema, a 45 s timeout and **at most one** retry (network, 5xx or invalid output only). Token counts and example ids are stored in `ai_requests`.
- **Name matching** (`worker/matching.ts`): the server re-checks every AI mention against the directory (case, accents, typos, v/b and s/z swaps, nicknames, aliases, first and last names). An AI "matched" stands only if the server finds exactly that one person; otherwise the user taps the right chip. Unknown or inactive ids are dropped.
- **Money** (`worker/spiffs.ts` → `calculateSpiffs`): one function serves both the live preview (`/api/calc`) and every save, so they can't disagree. Amounts are integer cents. Each mention stores name, department, type and amount snapshots. Totals are always computed by query.
- **Saves** are idempotent by `request_id` (double-tap = one review). Every write and its change-log rows go in one `db.batch()`.

## Assumptions (choices the spec left open)
1. **Workers + static assets** instead of Pages (see top). The Worker runs first for all paths so it can verify Access on assets too.
2. **Model:** `gpt-5.4-mini` via the Responses API, `reasoning.effort = "low"`, `store: false`. Both are editable in Settings. Reasoning effort is only sent for gpt-5 / o-series model names.
3. **Seed as migration:** the seed lives in `migrations/0002_seed.sql` (generated by `scripts/gen-seed.ts`) instead of a loose `seed.sql`, so it runs exactly once and is tracked.
4. **Extra settings keys:** `reasoning_effort` and `analyze_rate_limit_per_hour` (default 30).
5. **Extra columns:** `reviews.review_hash` (strong-duplicate check), `ai_requests.claimed_at` (90 s in-progress window), `spiff_rules.created_at/created_by`.
6. **Rate rule, generalized:** for both types, amount = solo if counted headcount is 1, else shared. Install is seeded $30/$30, so it's "$30 each regardless". Service is $30/$15. Managers aren't counted.
7. **Single uncertain match:** if the AI is sure but the server can't confirm (or vice versa), the one candidate shows as a chip to tap. The app never silently assigns a person.
8. **Regenerate reply** replaces only the reply text (new `request_id`). Confirmed employees and other edits stay.
9. **Editing an entry:** when its employees or posted date change, all of that entry's mentions are recalculated and their snapshots refreshed. Other edits don't touch amounts. Edits use optimistic locking: if someone else saved first, you're asked to reload.
10. **Duplicates at save:** the server answers 409 with the matches. The UI shows them with **Save anyway**, which resends with `acknowledge_duplicates`.
11. **Enter manually:** opens the review screen with a blank reply, the cleaned review text, and the customer name guessed from the paste's first line (editable).
12. **CSV:** the per-mention export uses saved snapshots. The per-employee totals use current names and departments. Cells starting with `= + - @` are prefixed to block spreadsheet formula injection.
13. **Changes-log date filters** use UTC day boundaries.
14. **Deleting a review** writes one change-log row whose `old_value` is the full JSON snapshot (review + mentions).
15. **Seed spelling:** employee names follow the spec. The printed 2026 directory spells one manager **"Jermaine Yancy"** while the spec says **"Jermaine Yancey"**. The seed uses the spec's spelling; fix it in Settings → Employees if the directory is right.
16. Content-Security-Policy, `X-Frame-Options: DENY`, same-origin checks (Origin / Sec-Fetch-Site) and `Content-Type: application/json` are enforced on writes. All user and AI text renders as plain text (React escaping, no `dangerouslySetInnerHTML`).

## Project layout
```
worker/        API: index.ts (router + auth gate), analyze.ts, spiffs.ts, matching.ts, openai.ts, prompt.ts, routes/*
shared/        zod schemas, defaults, cleaner, names, dates, text (used by Worker and UI)
src/           React app: pages (Home, AddNew, EntryDetail, Settings), components (ReviewEditor, EmployeePicker, ui)
migrations/    0001_schema.sql, 0002_seed.sql
test/          vitest suites + Google-paste fixtures (runs real migrations on node:sqlite)
```
