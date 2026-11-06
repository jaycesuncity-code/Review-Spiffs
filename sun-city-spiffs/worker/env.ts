export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_USER_EMAIL?: string;
  /** Local dev only: the full name shown as "Prepared by" for DEV_USER_EMAIL. */
  DEV_USER_NAME?: string;
  /** Optional Worker secret: JSON object of verified sign-in email -> full name, e.g. {"pat@company.com":"Pat Doe"}. */
  PREPARED_BY_NAMES?: string;
  OPENAI_API_KEY?: string;
}
