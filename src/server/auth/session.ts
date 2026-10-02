import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv, AuthenticatedMember } from "../env.js";
import { base64UrlEncode, randomBytes, sha256Hex } from "../security/crypto.js";

const SECURE_SESSION_COOKIE = "__Host-malak_session";
const LOCAL_SESSION_COOKIE = "malak_session";
export const CSRF_COOKIE = "malak_csrf";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function cookiesFromHeader(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const item of (header ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(name) && /^[A-Za-z0-9._~-]{1,512}$/.test(value)) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

export function cookieMode(env: AppEnv): { secure: boolean; sameSite: "None" | "Lax" } {
  const secure = env.COOKIE_SECURE !== "false";
  return { secure, sameSite: secure ? "None" : "Lax" };
}

function cookieLine(name: string, value: string, env: AppEnv, options: { httpOnly: boolean; maxAge: number }): string {
  const mode = cookieMode(env);
  const parts = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${options.maxAge}`,
    `SameSite=${mode.sameSite}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (mode.secure) parts.push("Secure");
  return parts.join("; ");
}

export function appendCsrfCookie(headers: Headers, token: string, env: AppEnv): void {
  headers.append("Set-Cookie", cookieLine(CSRF_COOKIE, token, env, { httpOnly: false, maxAge: 8 * 60 * 60 }));
}

export function appendSessionCookies(headers: Headers, token: string, csrf: string, env: AppEnv): void {
  const mode = cookieMode(env);
  const name = mode.secure ? SECURE_SESSION_COOKIE : LOCAL_SESSION_COOKIE;
  appendCsrfCookie(headers, csrf, env);
  headers.append("Set-Cookie", cookieLine(name, token, env, { httpOnly: true, maxAge: SESSION_TTL_MS / 1000 }));
}

export function clearSessionCookies(headers: Headers, env: AppEnv): void {
  const mode = cookieMode(env);
  const names = [SECURE_SESSION_COOKIE, LOCAL_SESSION_COOKIE, CSRF_COOKIE];
  for (const name of names) {
    const parts = [`${name}=`, "Path=/", "Max-Age=0", "SameSite=" + mode.sameSite];
    if (name !== CSRF_COOKIE) parts.push("HttpOnly");
    if (mode.secure) parts.push("Secure");
    headers.append("Set-Cookie", parts.join("; "));
  }
}

export async function getAuthenticatedMember(
  db: D1Database,
  request: Request,
  env: AppEnv,
): Promise<{ member: AuthenticatedMember | null; rawCsrfCookie: string | null }> {
  const cookies = cookiesFromHeader(request.headers.get("Cookie"));
  const rawToken = cookies.get(SECURE_SESSION_COOKIE) ?? cookies.get(LOCAL_SESSION_COOKIE) ?? null;
  const rawCsrfCookie = cookies.get(CSRF_COOKIE) ?? null;
  if (!rawToken || rawToken.length < 32) return { member: null, rawCsrfCookie };

  const row = await db
    .prepare(`
      SELECT s.id AS session_id, s.csrf_token_hash, u.id AS user_id, u.email_normalized,
             v.id AS venue_id, v.name AS venue_name, v.slug AS venue_slug, vm.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN venue_members vm ON vm.user_id = u.id AND vm.active = 1
      JOIN venues v ON v.id = vm.venue_id
      WHERE s.token_hash = ? AND s.expires_at_ms > ? AND s.revoked_at_ms IS NULL
      LIMIT 1
    `)
    .bind(await sha256Hex(rawToken), Date.now())
    .first<{
      session_id: string;
      csrf_token_hash: string;
      user_id: string;
      email_normalized: string;
      venue_id: string;
      venue_name: string;
      venue_slug: string;
      role: "owner" | "staff";
    }>();

  if (!row) return { member: null, rawCsrfCookie };
  return {
    rawCsrfCookie,
    member: {
      userId: row.user_id,
      email: row.email_normalized,
      venueId: row.venue_id,
      venueName: row.venue_name,
      venueSlug: row.venue_slug,
      role: row.role,
      sessionId: row.session_id,
      csrfTokenHash: row.csrf_token_hash,
    },
  };
}

export async function createSession(
  db: D1Database,
  userId: string,
  headers: Headers,
  env: AppEnv,
): Promise<void> {
  const now = Date.now();
  const rawToken = base64UrlEncode(randomBytes(32));
  const csrf = base64UrlEncode(randomBytes(32));
  await db
    .prepare(`
      INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, created_at_ms, expires_at_ms, last_seen_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(crypto.randomUUID(), userId, await sha256Hex(rawToken), await sha256Hex(csrf), now, now + SESSION_TTL_MS, now)
    .run();
  appendSessionCookies(headers, rawToken, csrf, env);
}

export async function rotateAnonymousCsrf(headers: Headers, env: AppEnv): Promise<string> {
  const csrf = base64UrlEncode(randomBytes(32));
  appendCsrfCookie(headers, csrf, env);
  return csrf;
}
