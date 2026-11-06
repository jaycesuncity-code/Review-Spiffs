// The signed-in person's full name, for "Prepared by" on exported reports.
// Every source is tied to the email Cloudflare Access already verified for THIS request; nothing
// the browser sends (query string, body, headers other than the verified token) can change it,
// and a name is never guessed from an email address.
//
// Sources, in order:
//  1. PREPARED_BY_NAMES (Worker secret): an admin-maintained {"email": "Full Name"} map.
//  2. Cloudflare Access get-identity for the verified token: the identity provider's `name`
//     (Microsoft Entra ID and most OIDC/SAML providers send it), used only when that identity's
//     email matches the verified email.
//  3. Local dev bypass only: DEV_USER_NAME.
// If none gives a name, the result is null and the app refuses to build a PDF rather than invent one.
import type { AccessUser } from "./auth";
import { teamUrl } from "./auth";
import type { Env } from "./env";

/** A usable display name, or null. Rejects blanks, email addresses and control characters. */
export function cleanFullName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 100) return null;
  if (name.includes("@") || /[\u0000-\u001f\u007f]/.test(name)) return null;
  if (!/\p{L}/u.test(name)) return null;
  return name;
}

function fromMapping(env: Env, email: string): string | null {
  const raw = env.PREPARED_BY_NAMES?.trim();
  if (!raw) return null;
  let map: unknown;
  try {
    map = JSON.parse(raw);
  } catch {
    console.error("PREPARED_BY_NAMES is not valid JSON; ignoring it.");
    return null;
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    if (k.trim().toLowerCase() === email) return cleanFullName(v);
  }
  return null;
}

const cache = new Map<string, { name: string | null; at: number }>();
const CACHE_MS = 10 * 60 * 1000;

async function fromAccessIdentity(env: Env, user: AccessUser, fetchFn: typeof fetch): Promise<string | null> {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  if (!user.token || !team) return null;
  const hit = cache.get(user.token);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.name;
  let name: string | null = null;
  try {
    const res = await fetchFn(`${teamUrl(team)}/cdn-cgi/access/get-identity`, {
      headers: { cookie: `CF_Authorization=${user.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const id = (await res.json()) as { email?: unknown; name?: unknown };
      // Only trust a name that belongs to the same verified person.
      if (typeof id.email === "string" && id.email.trim().toLowerCase() === user.email) name = cleanFullName(id.name);
    }
  } catch (err) {
    console.error("Access get-identity failed:", err instanceof Error ? err.message : String(err));
    return null; // not cached: a transient failure should not stick for ten minutes
  }
  if (cache.size > 200) cache.clear();
  cache.set(user.token, { name, at: Date.now() });
  return name;
}

export async function resolveFullName(env: Env, user: AccessUser, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const mapped = fromMapping(env, user.email);
  if (mapped) return mapped;
  const fromIdp = await fromAccessIdentity(env, user, fetchFn);
  if (fromIdp) return fromIdp;
  if (user.token === null && env.ENVIRONMENT === "dev") return cleanFullName(env.DEV_USER_NAME);
  return null;
}
