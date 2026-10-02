export interface AppEnv {
  DB: D1Database;
  OWNER_EMAIL: string;
  OWNER_SETUP_TOKEN?: string;
  BOOKING_ENCRYPTION_KEY?: string;
  BOOKING_HASH_SECRET?: string;
  AUTH_PEPPER?: string;
  APP_ORIGINS?: string;
  COOKIE_SECURE?: string;
}

export interface AuthenticatedMember {
  userId: string;
  email: string;
  venueId: string;
  venueName: string;
  venueSlug: string;
  role: "owner" | "staff";
  sessionId: string;
  csrfTokenHash: string;
}

export interface RequestContext {
  env: AppEnv;
  request: Request;
  responseHeaders: Headers;
  member: AuthenticatedMember | null;
  rawCsrfCookie: string | null;
}

export function requireSecret(value: string | undefined, name: string): string {
  if (!value || value.length < 32 || value.trim() !== value) {
    throw new Error(`${name} is not configured with a strong value.`);
  }
  return value;
}
