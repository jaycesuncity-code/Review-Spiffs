// Cloudflare Access JWT verification. Runs on every request (assets included).
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";
import { HttpError } from "./http";

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function teamUrl(raw: string): string {
  const t = raw.trim().replace(/\/+$/, "");
  return t.startsWith("https://") ? t : `https://${t}`;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/** Returns the verified user email (lowercased), or null when the request is not authenticated. */
export async function authenticate(req: Request, env: Env): Promise<string | null> {
  // Local development bypass: requires ENVIRONMENT=dev (only set in .dev.vars) AND a localhost URL.
  // A deployed Worker is never reached on localhost, so this can't be used in production.
  const url = new URL(req.url);
  if (env.ENVIRONMENT === "dev" && env.DEV_USER_EMAIL && isLocalHost(url.hostname)) {
    return env.DEV_USER_EMAIL.trim().toLowerCase();
  }

  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audiences = (env.CF_ACCESS_AUD ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!team || audiences.length === 0) {
    throw new HttpError(500, "Server is not configured: set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD in wrangler.toml.");
  }

  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token) return null;

  const issuer = teamUrl(team);
  let jwks = jwksByTeam.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByTeam.set(issuer, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: audiences, algorithms: ["RS256"] });
    const email = payload.email;
    if (typeof email !== "string" || !email.includes("@")) return null; // service tokens have no email
    return email.toLowerCase();
  } catch {
    return null;
  }
}
