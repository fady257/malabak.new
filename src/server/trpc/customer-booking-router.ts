import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router, staffProcedure } from "./core.js";
import type { RequestContext } from "../env.js";
import { enforceRateLimit } from "../security/rate-limit.js";
import { assertConfiguredSecret } from "../security/request-security.js";
import { decryptPhone, hmacSha256Hex, hashBookingCode, issueBookingCode, normalizeEgyptianPhone, encryptPhone } from "../security/crypto.js";
import { bookingInsertStatement, findCustomerBooking, loadBookingVenueBySlug } from "../booking/repository.js";
import { cairoBusinessDate, findAvailableSlot, listSlotOptions } from "../booking/availability.js";
import { expirePendingBookings } from "../booking/expiry.js";
import { auditEventStatement } from "../db/audit.js";
import { reserveBookingAtomically } from "../booking/slot-locks.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const phoneSchema = z.string().trim().min(8).max(40);
const codeSchema = z.string().trim().min(16).max(40);

async function phoneLookupHash(env: { BOOKING_HASH_SECRET?: string }, phone: string): Promise<{ normalized: string; hash: string }> {
  const secret = assertConfiguredSecret(env.BOOKING_HASH_SECRET, "BOOKING_HASH_SECRET");
  const normalized = normalizeEgyptianPhone(phone);
  return { normalized, hash: await hmacSha256Hex(secret, `phone:${normalized}`) };
}

function publicBooking(row: NonNullable<Awaited<ReturnType<typeof findCustomerBooking>>>) {
  return {
    bookingId: row.id,
    venueName: row.venue_name,
    venueSlug: row.venue_slug,
    venueWhatsapp: row.venue_whatsapp_number,
    pitchName: row.pitch_name,
    businessDate: row.business_date,
    startMinute: row.start_minute,
    durationMinutes: row.duration_minutes,
    startAtUtcMs: row.start_at_utc_ms,
    endAtUtcMs: row.end_at_utc_ms,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference,
    holdExpiresAtMs: row.hold_expires_at_ms,
    pricePiasters: row.price_piasters,
    paymentReceivedPiasters: row.payment_received_piasters,
  };
}

async function customerBooking(ctx: RequestContext, input: { code: string; phone: string; venueSlug?: string | undefined }) {
  const { hash: phoneHash } = await phoneLookupHash(ctx.env, input.phone);
  const codeHash = await hashBookingCode(ctx.env, input.code);
  const venue = input.venueSlug ? await loadBookingVenueBySlug(ctx.env.DB, input.venueSlug) : null;
  if (input.venueSlug && !venue) return null;
  return findCustomerBooking(ctx.env.DB, venue?.id ?? null, codeHash, phoneHash);
}

export const customerBookingRouter = router({
  availability: publicProcedure.input(z.object({
    venueSlug: z.string().min(2).max(80),
    pitchId: z.string().uuid(),
    businessDate: dateSchema,
  })).query(async ({ ctx, input }) => {
    const venue = await loadBookingVenueBySlug(ctx.env.DB, input.venueSlug);
    if (!venue) throw new TRPCError({ code: "NOT_FOUND", message: "المكان غير متاح للحجز حاليًا." });
    const pitch = await ctx.env.DB.prepare("SELECT id FROM pitches WHERE id = ? AND venue_id = ? AND active = 1 LIMIT 1")
      .bind(input.pitchId, venue.id).first<{ id: string }>();
    if (!pitch) throw new TRPCError({ code: "NOT_FOUND", message: "الملعب غير متاح." });
    try {
      return await listSlotOptions(ctx.env.DB, venue, pitch.id, input.businessDate);
    } catch (error) {
      if (error instanceof RangeError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      throw error;
    }
  }),

  create: publicProcedure.input(z.object({
    venueSlug: z.string().min(2).max(80),
    pitchId: z.string().uuid(),
    businessDate: dateSchema,
    startMinute: z.number().int().min(0).max(2879).multipleOf(30),
    customerName: z.string().trim().min(2).max(120),
    customerPhone: phoneSchema,
    paymentReference: z.string().trim().max(100).nullable().optional(),
    customerNote: z.string().trim().max(300).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const { normalized, hash: lookupHash } = await phoneLookupHash(ctx.env, input.customerPhone);
    await Promise.all([
      enforceRateLimit(ctx.env.DB, ctx.env, ctx.request, { scope: "booking-create-ip", limit: 8, windowMs: 60 * 60_000, blockMs: 60 * 60_000 }),
      enforceRateLimit(ctx.env.DB, ctx.env, ctx.request, { scope: `booking-create-phone:${lookupHash}`, limit: 4, windowMs: 24 * 60 * 60_000, blockMs: 24 * 60 * 60_000 }),
    ]);

    const venue = await loadBookingVenueBySlug(ctx.env.DB, input.venueSlug);
    if (!venue) throw new TRPCError({ code: "NOT_FOUND", message: "المكان غير متاح للحجز حاليًا." });
    const pitch = await ctx.env.DB.prepare("SELECT id FROM pitches WHERE id = ? AND venue_id = ? AND active = 1 LIMIT 1")
      .bind(input.pitchId, venue.id).first<{ id: string }>();
    if (!pitch) throw new TRPCError({ code: "NOT_FOUND", message: "الملعب غير متاح." });

    const now = Date.now();
    await expirePendingBookings(ctx.env.DB, now);
    const pendingCapacity = await ctx.env.DB.prepare(`
      SELECT active_count FROM pending_phone_capacity WHERE venue_id = ? AND phone_lookup_hash = ? LIMIT 1
    `).bind(venue.id, lookupHash).first<{ active_count: number }>();
    if ((pendingCapacity?.active_count ?? 0) >= 2) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "عندك طلبين معلقين بالفعل. تابع الحجز الموجود أو انتظر انتهاء المهلة قبل طلب موعد جديد." });
    }

    if (venue.deposit_amount_piasters > 0 && !input.paymentReference?.trim()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "أدخل مرجع تحويل العربون قبل تثبيت الحجز المعلق." });
    }
    let slot;
    try { slot = await findAvailableSlot(ctx.env.DB, venue, pitch.id, input.businessDate, input.startMinute); }
    catch (error) {
      if (error instanceof RangeError) throw new TRPCError({ code: "CONFLICT", message: error.message });
      throw error;
    }

    const bookingId = crypto.randomUUID();
    const bookingCode = await issueBookingCode();
    const bookingCodeHash = await hashBookingCode(ctx.env, bookingCode);
    const encryptedPhone = await encryptPhone(ctx.env, normalized);
    const holdExpiresAtMs = now + venue.hold_minutes * 60_000;
    const booking = {
      id: bookingId,
      venueId: venue.id,
      pitchId: pitch.id,
      recurringSeriesId: null,
      businessDate: slot.businessDate,
      startMinute: slot.startMinute,
      durationMinutes: slot.durationMinutes,
      startAtUtcMs: slot.startAtUtcMs,
      endAtUtcMs: slot.endAtUtcMs,
      customerName: input.customerName,
      customerPhoneCiphertext: encryptedPhone,
      customerPhoneLookupHash: lookupHash,
      bookingCodeHash,
      status: "pending" as const,
      paymentStatus: "unpaid" as const,
      paymentReference: input.paymentReference?.trim() || null,
      holdExpiresAtMs,
      createdByUserId: null,
      updatedByUserId: null,
      pricePiasters: slot.pricePiasters,
      paymentReceivedPiasters: 0,
      customerNote: input.customerNote?.trim() || null,
      createdAtMs: now,
    };
    try {
      await reserveBookingAtomically(ctx.env.DB, bookingInsertStatement(ctx.env.DB, booking), {
        bookingId,
        pitchId: pitch.id,
        businessDate: slot.businessDate,
        durationMinutes: slot.durationMinutes,
        bucketIndices: slot.bucketIndices,
        createdAtMs: now,
      }, [auditEventStatement(ctx.env.DB, {
        venueId: venue.id, actorUserId: null, entityType: "booking", entityId: bookingId,
        action: "customer_hold_created", createdAtMs: now,
      })]);
    } catch {
      throw new TRPCError({ code: "CONFLICT", message: "الميعاد اتحجز أو وصل رقمك للحد الأقصى لطلبين معلقين. اختار وقتًا آخر أو تابع طلباتك؛ لم يُحفظ طلب مكرر." });
    }
    return {
      bookingId,
      bookingCode,
      status: "pending" as const,
      holdExpiresAtMs,
      pricePiasters: slot.pricePiasters,
      depositPiasters: venue.deposit_amount_piasters,
      businessDate: slot.businessDate,
      startMinute: slot.startMinute,
      durationMinutes: slot.durationMinutes,
    };
  }),

  lookup: publicProcedure.input(z.object({ code: codeSchema, phone: phoneSchema, venueSlug: z.string().min(2).max(80).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { hash } = await phoneLookupHash(ctx.env, input.phone);
      await enforceRateLimit(ctx.env.DB, ctx.env, ctx.request, { scope: `booking-lookup:${hash}`, limit: 8, windowMs: 15 * 60_000, blockMs: 30 * 60_000 });
      const row = await customerBooking(ctx, input);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "لم نعثر على الحجز. راجع رقم الهاتف ورمز الحجز." });
      if (row.status === "pending" && (row.hold_expires_at_ms ?? 0) <= Date.now()) {
        await expirePendingBookings(ctx.env.DB, Date.now(), row.business_date);
        const refreshed = await customerBooking(ctx, input);
        if (!refreshed) throw new TRPCError({ code: "NOT_FOUND", message: "لم نعثر على الحجز." });
        return publicBooking(refreshed);
      }
      return publicBooking(row);
    }),

  cancelOwn: publicProcedure.input(z.object({ code: codeSchema, phone: phoneSchema, venueSlug: z.string().min(2).max(80).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { hash } = await phoneLookupHash(ctx.env, input.phone);
      await enforceRateLimit(ctx.env.DB, ctx.env, ctx.request, { scope: `booking-cancel:${hash}`, limit: 5, windowMs: 60 * 60_000, blockMs: 60 * 60_000 });
      const row = await customerBooking(ctx, input);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "لم نعثر على الحجز." });
      const now = Date.now();
      if (!["pending", "confirmed"].includes(row.status) || row.start_at_utc_ms <= now) {
        throw new TRPCError({ code: "CONFLICT", message: "لا يمكن إلغاء هذا الحجز من الرابط الآن. تواصل مع الملعب للمساعدة." });
      }
      if (row.status === "pending" && (row.hold_expires_at_ms ?? 0) <= now) {
        await expirePendingBookings(ctx.env.DB, now, row.business_date);
        throw new TRPCError({ code: "CONFLICT", message: "انتهت مهلة الحجز المؤقت؛ اختار موعدًا متاحًا من جديد." });
      }
      const venue = await ctx.env.DB.prepare("SELECT cancellation_notice_hours FROM venues WHERE id = ?")
        .bind(row.venue_id).first<{ cancellation_notice_hours: number }>();
      if (row.status === "confirmed") {
        const cutoff = (venue?.cancellation_notice_hours ?? 0) * 60 * 60_000;
        if (row.start_at_utc_ms - now < cutoff) {
          throw new TRPCError({ code: "FORBIDDEN", message: "اقترب موعد المباراة. لإلغاء الحجز اتصل بالملعب مباشرة." });
        }
      }
      const updatedAt = now;
      const results = await ctx.env.DB.batch([
        ctx.env.DB.prepare(`
          DELETE FROM slot_locks WHERE booking_id = ? AND EXISTS (
            SELECT 1 FROM bookings WHERE id = ? AND venue_id = ? AND updated_at_ms = ? AND status IN ('pending','confirmed')
          )
        `).bind(row.id, row.id, row.venue_id, row.updated_at_ms),
        ctx.env.DB.prepare(`
          UPDATE bookings SET status = 'cancelled',hold_expires_at_ms = NULL,cancellation_reason = 'customer_requested',updated_at_ms = ?
          WHERE id = ? AND venue_id = ? AND updated_at_ms = ? AND status IN ('pending','confirmed')
        `).bind(updatedAt, row.id, row.venue_id, row.updated_at_ms),
        ctx.env.DB.prepare(`
          INSERT INTO audit_events (id,venue_id,actor_user_id,entity_type,entity_id,action,created_at_ms)
          SELECT ?,?,NULL,'booking',?,'customer_cancelled',? WHERE EXISTS (
            SELECT 1 FROM bookings WHERE id = ? AND venue_id = ? AND status = 'cancelled' AND updated_at_ms = ?
          )
        `).bind(crypto.randomUUID(), row.venue_id, row.id, now, row.id, row.venue_id, updatedAt),
      ]);
      if ((results[1]?.meta.changes ?? 0) === 0) throw new TRPCError({ code: "CONFLICT", message: "تغيرت حالة الحجز أثناء الإلغاء. حدّث الصفحة وتأكد من حالته." });
      return { ok: true, status: "cancelled" as const };
    }),

  ownerBookingsForDay: staffProcedure.input(z.object({ businessDate: dateSchema.optional() })).query(async ({ ctx, input }) => {
    await expirePendingBookings(ctx.env.DB, Date.now(), input.businessDate);
    const today = cairoBusinessDate();
    const rows = await ctx.env.DB.prepare(`
      SELECT b.id,b.pitch_id,p.name AS pitch_name,b.business_date,b.start_minute,b.duration_minutes,
        b.start_at_utc_ms,b.end_at_utc_ms,b.customer_name,b.customer_phone_ciphertext,b.status,
        b.payment_status,b.payment_reference,b.hold_expires_at_ms,b.price_piasters,b.payment_received_piasters,
        b.updated_at_ms,b.customer_note,
        (SELECT COUNT(*) FROM bookings prior WHERE prior.venue_id=b.venue_id
          AND prior.customer_phone_lookup_hash=b.customer_phone_lookup_hash AND prior.status='no_show'
          AND (prior.business_date < b.business_date OR (prior.business_date=b.business_date AND prior.start_minute < b.start_minute))) AS prior_no_shows
      FROM bookings b JOIN pitches p ON p.id=b.pitch_id
      WHERE b.venue_id=? AND b.business_date >= COALESCE(?,?)
        AND (? IS NULL OR b.business_date=?)
      ORDER BY b.business_date ASC,b.start_minute ASC LIMIT 500
    `).bind(ctx.member.venueId, input.businessDate ?? null, today, input.businessDate ?? null, input.businessDate ?? null).all<{
      id: string; pitch_id: string; pitch_name: string; business_date: string; start_minute: number;
      duration_minutes: 60 | 90; start_at_utc_ms: number; end_at_utc_ms: number; customer_name: string;
      customer_phone_ciphertext: string; status: string; payment_status: string; payment_reference: string | null;
      hold_expires_at_ms: number | null; price_piasters: number; payment_received_piasters: number;
      updated_at_ms: number; customer_note: string | null; prior_no_shows: number;
    }>();
    return Promise.all((rows.results ?? []).map(async (row) => ({
      id: row.id,
      pitchId: row.pitch_id,
      pitchName: row.pitch_name,
      businessDate: row.business_date,
      startMinute: row.start_minute,
      durationMinutes: row.duration_minutes,
      startAtUtcMs: row.start_at_utc_ms,
      endAtUtcMs: row.end_at_utc_ms,
      customerName: row.customer_name,
      customerPhone: await decryptPhone(ctx.env, row.customer_phone_ciphertext),
      status: row.status,
      paymentStatus: row.payment_status,
      paymentReference: row.payment_reference,
      holdExpiresAtMs: row.hold_expires_at_ms,
      pricePiasters: row.price_piasters,
      paymentReceivedPiasters: row.payment_received_piasters,
      updatedAtMs: row.updated_at_ms,
      customerNote: row.customer_note,
      priorNoShows: row.prior_no_shows,
    })));
  }),
});
