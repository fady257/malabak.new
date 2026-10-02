import { TRPCError } from "@trpc/server";
import type { D1Database } from "@cloudflare/workers-types";
import { requireSecret, type AppEnv } from "../env.js";
import { hmacSha256Hex } from "./crypto.js";

export interface RateLimitOptions {
  scope: string;
  limit: number;
  windowMs: number;
  blockMs?: number;
}

export async function enforceRateLimit(
  db: D1Database,
  env: AppEnv,
  request: Request,
  options: RateLimitOptions,
): Promise<void> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new RangeError("Rate-limit threshold is invalid.");
  }
  requireSecret(env.AUTH_PEPPER, "AUTH_PEPPER");
  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP")?.slice(0, 80) ?? "unknown-client";
  const keyHash = await hmacSha256Hex(env.AUTH_PEPPER!, `${options.scope}\u0000${ip}`);
  const windowMs = Math.max(1_000, Math.min(options.windowMs, 24 * 60 * 60 * 1000));
  const blockMs = Math.max(1_000, Math.min(options.blockMs ?? windowMs, 24 * 60 * 60 * 1000));

  await db.prepare(`
    INSERT INTO rate_limit_buckets (key_hash, window_started_at_ms, hits, blocked_until_ms)
    VALUES (?, ?, 1, NULL)
    ON CONFLICT(key_hash) DO UPDATE SET
      window_started_at_ms = CASE
        WHEN rate_limit_buckets.window_started_at_ms <= ? THEN excluded.window_started_at_ms
        ELSE rate_limit_buckets.window_started_at_ms END,
      hits = CASE
        WHEN rate_limit_buckets.window_started_at_ms <= ? THEN 1
        ELSE rate_limit_buckets.hits + 1 END,
      blocked_until_ms = CASE
        WHEN rate_limit_buckets.window_started_at_ms <= ? THEN NULL
        WHEN rate_limit_buckets.hits + 1 >= ? THEN MAX(COALESCE(rate_limit_buckets.blocked_until_ms, 0), ?)
        ELSE rate_limit_buckets.blocked_until_ms END
  `).bind(keyHash, now, now - windowMs, now - windowMs, now - windowMs, options.limit, now + blockMs).run();

  const bucket = await db
    .prepare("SELECT hits, blocked_until_ms FROM rate_limit_buckets WHERE key_hash = ?")
    .bind(keyHash)
    .first<{ hits: number; blocked_until_ms: number | null }>();
  if (!bucket || bucket.hits > options.limit || (bucket.blocked_until_ms !== null && bucket.blocked_until_ms > now)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "طلبات كثيرة خلال وقت قصير. حاول بعد قليل." });
  }
}
