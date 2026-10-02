import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertConfiguredSecret } from "../security/request-security.js";
import { constantTimeEqual, hmacSha256Hex, normalizeEgyptianPhone, randomBytes, base64UrlEncode } from "../security/crypto.js";
import { enforceRateLimit } from "../security/rate-limit.js";
import { createSession, clearSessionCookies } from "../auth/session.js";
import { hashPassword, validatePassword, verifyPassword } from "../auth/password.js";
import { ownerProcedure, protectedProcedure, publicProcedure, router } from "./core.js";

const emailSchema = z.string().trim().email().max(254);
const slugSchema = z.string().trim().toLowerCase().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const dummyHash = `pbkdf2-sha256$600000$${base64UrlEncode(new Uint8Array(16))}$${base64UrlEncode(new Uint8Array(32))}`;

function timeToMinute(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

export const authRouter = router({
  bootstrapState: publicProcedure.query(async ({ ctx }) => {
    const row = await ctx.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users_count,
        (SELECT COUNT(*) FROM app_settings WHERE key = 'owner_bootstrap_claim') AS claim_count
    `).first<{ users_count: number; claim_count: number }>();
    return {
      setupAvailable: (row?.users_count ?? 0) === 0 && (row?.claim_count ?? 0) === 0,
      ownerEmail: ctx.env.OWNER_EMAIL,
    };
  }),

  setupOwner: publicProcedure
    .input(z.object({
      setupToken: z.string().min(32).max(256),
      email: emailSchema,
      password: z.string().min(1).max(128),
      venueName: z.string().trim().min(2).max(160),
      slug: slugSchema,
      address: z.string().trim().max(240).nullable().optional(),
      vodafoneCashNumber: z.string().trim().max(32).nullable().optional(),
      depositEgp: z.number().finite().min(0).max(500_000),
      priceEgp: z.number().finite().min(0).max(500_000),
      holdMinutes: z.number().int().min(5).max(240),
      slotLengthMinutes: z.union([z.literal(60), z.literal(90)]),
      openingTime: timeSchema,
      closingTime: timeSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      await enforceRateLimit(ctx.env.DB, ctx.env, ctx.request, { scope: "owner-bootstrap", limit: 4, windowMs: 60 * 60_000, blockMs: 60 * 60_000 });
      const expected = assertConfiguredSecret(ctx.env.OWNER_SETUP_TOKEN, "OWNER_SETUP_TOKEN");
      const ownerEmail = (ctx.env.OWNER_EMAIL ?? "").trim().toLowerCase();
      if (!ownerEmail || input.email.trim().toLowerCase() !== ownerEmail || !constantTimeEqual(input.setupToken, expected)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "بيانات الإعداد غير صحيحة أو انتهت صلاحيتها." });
      }

      let passwordHash: string;
      try {
        validatePassword(input.password);
        passwordHash = await hashPassword(input.password, assertConfiguredSecret(ctx.env.AUTH_PEPPER, "AUTH_PEPPER"));
      } catch (error) {
        if (error instanceof RangeError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }

      const openingMinute = timeToMinute(input.openingTime);
      const closingClockMinute = timeToMinute(input.closingTime);
      const closingBusinessMinute = closingClockMinute <= openingMinute ? closingClockMinute + 1440 : closingClockMinute;
      if (closingBusinessMinute - openingMinute < input.slotLengthMinutes || closingBusinessMinute - openingMinute > 780) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "ساعات العمل يجب أن تتسع للمدة المختارة وألا تزيد عن 13 ساعة." });
      }

      let paymentNumber: string | null = null;
      if (input.vodafoneCashNumber) {
        try { paymentNumber = normalizeEgyptianPhone(input.vodafoneCashNumber); }
        catch { throw new TRPCError({ code: "BAD_REQUEST", message: "رقم فودافون كاش غير صالح." }); }
      }

      const now = Date.now();
      const userId = crypto.randomUUID();
      const venueId = crypto.randomUUID();
      const pitchId = crypto.randomUUID();
      try {
        const users = await ctx.env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
        if ((users?.count ?? 0) > 0) throw new TRPCError({ code: "CONFLICT", message: "إعداد المالك اكتمل بالفعل." });
        await ctx.env.DB.batch([
          ctx.env.DB.prepare("INSERT INTO app_settings (key,value,updated_at_ms) VALUES ('owner_bootstrap_claim',?,?)").bind(userId, now),
          ctx.env.DB.prepare(`
            INSERT INTO users (id,email,email_normalized,password_hash,created_at_ms,updated_at_ms)
            VALUES (?,?,?,?,?,?)
          `).bind(userId, ownerEmail, ownerEmail, passwordHash, now, now),
          ctx.env.DB.prepare(`
            INSERT INTO venues (
              id,owner_user_id,slug,name,address,vodafone_cash_number,deposit_amount_piasters,
              hold_minutes,slot_length_minutes,timezone,opening_minute,closing_business_minute,
              created_at_ms,updated_at_ms,public_booking_enabled,cancellation_notice_hours
            ) VALUES (?,?,?,?,?,?,?,?,?,'Africa/Cairo',?,?,?,?,1,2)
          `).bind(
            venueId, userId, input.slug, input.venueName, input.address ?? null, paymentNumber,
            Math.round(input.depositEgp * 100), input.holdMinutes, input.slotLengthMinutes,
            openingMinute, closingBusinessMinute, now, now,
          ),
          ctx.env.DB.prepare("INSERT INTO venue_members (venue_id,user_id,role,active,created_at_ms) VALUES (?,?, 'owner',1,?)").bind(venueId, userId, now),
          ctx.env.DB.prepare("INSERT INTO pitches (id,venue_id,name,active,display_order,created_at_ms,updated_at_ms) VALUES (?,?, 'الملعب الرئيسي',1,0,?,?)").bind(pitchId, venueId, now, now),
          ctx.env.DB.prepare(`
            INSERT INTO price_rules (id,venue_id,pitch_id,day_mask,start_minute,end_minute,price_piasters,created_at_ms,updated_at_ms)
            VALUES (?, ?, NULL, 127, ?, ?, ?, ?, ?)
          `).bind(crypto.randomUUID(), venueId, openingMinute, closingBusinessMinute, Math.round(input.priceEgp * 100), now, now),
        ]);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "CONFLICT", message: "تعذر إكمال الإعداد الأول. ربما تم إنشاء الحساب بالفعل." });
      }

      await createSession(ctx.env.DB, userId, ctx.responseHeaders, ctx.env);
      return { ok: true, venueSlug: input.slug };
    }),

  login: publicProcedure
    .input(z.object({ email: emailSchema, password: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      await Promise.all([
        enforceRateLimit(ctx.env.DB, ctx.env, ctx.request, { scope: "login-ip", limit: 8, windowMs: 15 * 60_000, blockMs: 30 * 60_000 }),
        enforceRateLimit(ctx.env.DB, ctx.env, ctx.request, { scope: `login-email:${email}`, limit: 6, windowMs: 15 * 60_000, blockMs: 30 * 60_000 }),
      ]);
      const row = await ctx.env.DB.prepare("SELECT id,email_normalized,password_hash FROM users WHERE email_normalized = ? COLLATE NOCASE LIMIT 1")
        .bind(email)
        .first<{ id: string; email_normalized: string; password_hash: string }>();
      const pepper = assertConfiguredSecret(ctx.env.AUTH_PEPPER, "AUTH_PEPPER");
      const passwordOk = row
        ? await verifyPassword(input.password, row.password_hash, pepper)
        : await verifyPassword(input.password, dummyHash, pepper);
      if (!row || !passwordOk) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "البريد أو كلمة المرور غير صحيحين." });
      }
      await createSession(ctx.env.DB, row.id, ctx.responseHeaders, ctx.env);
      return { ok: true };
    }),

  me: protectedProcedure.query(({ ctx }) => ({
    userId: ctx.member.userId,
    email: ctx.member.email,
    role: ctx.member.role,
    venueId: ctx.member.venueId,
    venueName: ctx.member.venueName,
    venueSlug: ctx.member.venueSlug,
  })),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    const now = Date.now();
    await ctx.env.DB.prepare("UPDATE sessions SET revoked_at_ms = ? WHERE id = ? AND revoked_at_ms IS NULL")
      .bind(now, ctx.member.sessionId)
      .run();
    clearSessionCookies(ctx.responseHeaders, ctx.env);
    return { ok: true };
  }),

  ownerOnly: ownerProcedure.query(({ ctx }) => ({ venueId: ctx.member.venueId })),
});
