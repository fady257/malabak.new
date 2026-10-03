import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ownerProcedure, router, staffProcedure } from "./core.js";
import type { AppEnv } from "../env.js";
import { assertConfiguredSecret } from "../security/request-security.js";
import { decryptPhone, encryptPhone, hashBookingCode, hmacSha256Hex, issueBookingCode, normalizeEgyptianPhone } from "../security/crypto.js";
import { enforceRateLimit } from "../security/rate-limit.js";
import { addCalendarDays, cairoBusinessDate, findAvailableSlot, listSlotOptions } from "../booking/availability.js";
import { loadBookingVenueById, bookingInsertStatement, type NewBookingRecord } from "../booking/repository.js";
import { auditEventStatement } from "../db/audit.js";
import { rescheduleBookingAtomicallyCas, type SlotLockReservation } from "../booking/slot-locks.js";
import { expirePendingBookings } from "../booking/expiry.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bookingStatusSchema = z.enum(["confirmed", "rejected", "cancelled", "completed", "no_show"]);
const paymentStatusSchema = z.enum(["unpaid", "deposit", "paid"]);

async function createManualOccurrence(args: {
  db: AppEnv["DB"];
  env: AppEnv;
  venueId: string;
  userId: string;
  venue: NonNullable<Awaited<ReturnType<typeof loadBookingVenueById>>>;
  pitchId: string;
  businessDate: string;
  startMinute: number;
  name: string;
  phone: string;
  note: string | null;
  seriesId: string | null;
  now: number;
  horizonDays: number;
}) {
  const slot = await findAvailableSlot(args.db, args.venue, args.pitchId, args.businessDate, args.startMinute, args.now, undefined, args.horizonDays);
  const normalizedPhone = normalizeEgyptianPhone(args.phone);
  const [encryptedPhone, lookupHash, code] = await Promise.all([
    encryptPhone(args.env, normalizedPhone),
    hmacSha256Hex(assertConfiguredSecret(args.env.BOOKING_HASH_SECRET, "BOOKING_HASH_SECRET"), `phone:${normalizedPhone}`),
    issueBookingCode(),
  ]);
  const record: NewBookingRecord = {
    id: crypto.randomUUID(),
    venueId: args.venueId,
    pitchId: args.pitchId,
    recurringSeriesId: args.seriesId,
    businessDate: slot.businessDate,
    startMinute: slot.startMinute,
    durationMinutes: slot.durationMinutes,
    startAtUtcMs: slot.startAtUtcMs,
    endAtUtcMs: slot.endAtUtcMs,
    customerName: args.name,
    customerPhoneCiphertext: encryptedPhone,
    customerPhoneLookupHash: lookupHash,
    bookingCodeHash: await hashBookingCode(args.env, code),
    status: "confirmed",
    paymentStatus: "unpaid",
    paymentReference: null,
    holdExpiresAtMs: null,
    createdByUserId: args.userId,
    updatedByUserId: args.userId,
    pricePiasters: slot.pricePiasters,
    paymentReceivedPiasters: 0,
    customerNote: args.note,
    createdAtMs: args.now,
  };
  const reservation: SlotLockReservation = {
    bookingId: record.id,
    pitchId: args.pitchId,
    businessDate: slot.businessDate,
    durationMinutes: slot.durationMinutes,
    bucketIndices: slot.bucketIndices,
    createdAtMs: args.now,
  };
  return { record, code, slot, reservation };
}

function transitionAllowed(from: string, to: string): boolean {
  if (from === to) return from === "confirmed";
  if (from === "pending") return ["confirmed", "rejected", "cancelled"].includes(to);
  if (from === "confirmed") return ["cancelled", "completed", "no_show"].includes(to);
  return false;
}

export const adminBookingRouter = router({
  availability: staffProcedure.input(z.object({
    pitchId: z.string().uuid(), businessDate: dateSchema, ignoreBookingId: z.string().uuid().optional(),
  }))
    .query(async ({ ctx, input }) => {
      const venue = await loadBookingVenueById(ctx.env.DB, ctx.member.venueId);
      const pitch = await ctx.env.DB.prepare("SELECT id FROM pitches WHERE id=? AND venue_id=? AND active=1 LIMIT 1")
        .bind(input.pitchId, ctx.member.venueId).first<{ id: string }>();
      if (!venue || !pitch) throw new TRPCError({ code: "NOT_FOUND", message: "الملعب غير متاح." });
      if (input.ignoreBookingId) {
        const owned = await ctx.env.DB.prepare("SELECT id FROM bookings WHERE id=? AND venue_id=? AND status IN ('pending','confirmed') LIMIT 1")
          .bind(input.ignoreBookingId, ctx.member.venueId).first<{ id: string }>();
        if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "الحجز المراد تعديله غير موجود." });
      }
      try {
        return await listSlotOptions(ctx.env.DB, venue, pitch.id, input.businessDate, Date.now(), input.ignoreBookingId, 370);
      } catch (error) {
        if (error instanceof RangeError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),

  createManual: staffProcedure.input(z.object({
    pitchId: z.string().uuid(),
    businessDate: dateSchema,
    startMinute: z.number().int().min(0).max(2879).multipleOf(30),
    customerName: z.string().trim().min(2).max(120),
    customerPhone: z.string().trim().min(8).max(40),
    customerNote: z.string().trim().max(300).nullable().optional(),
    repeatWeeks: z.number().int().min(1).max(52).default(1),
  })).mutation(async ({ ctx, input }) => {
    await enforceRateLimit(ctx.env.DB, ctx.env, ctx.request, { scope: "owner-manual-booking", limit: 60, windowMs: 60 * 60_000, blockMs: 60 * 60_000 });
    const venue = await loadBookingVenueById(ctx.env.DB, ctx.member.venueId);
    if (!venue) throw new TRPCError({ code: "NOT_FOUND", message: "المكان غير موجود." });
    const pitch = await ctx.env.DB.prepare("SELECT id FROM pitches WHERE id = ? AND venue_id = ? AND active = 1")
      .bind(input.pitchId, ctx.member.venueId).first<{ id: string }>();
    if (!pitch) throw new TRPCError({ code: "NOT_FOUND", message: "الملعب غير متاح." });

    const now = Date.now();
    const occurrenceCount = input.repeatWeeks;
    const seriesId = occurrenceCount > 1 ? crypto.randomUUID() : null;
    let occurrences: Awaited<ReturnType<typeof createManualOccurrence>>[] = [];
    try {
      for (let index = 0; index < occurrenceCount; index += 1) {
        occurrences.push(await createManualOccurrence({
          db: ctx.env.DB, env: ctx.env, venueId: ctx.member.venueId, userId: ctx.member.userId,
          venue, pitchId: pitch.id, businessDate: addCalendarDays(input.businessDate, index * 7),
          startMinute: input.startMinute, name: input.customerName, phone: input.customerPhone,
          note: input.customerNote?.trim() || null, seriesId, now: now + index, horizonDays: 370,
        }));
      }
    } catch (error) {
      if (error instanceof RangeError) throw new TRPCError({ code: "CONFLICT", message: error.message });
      throw error;
    }

    const statements: D1PreparedStatement[] = [];
    if (seriesId) {
      const first = occurrences[0];
      if (!first) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر إنشاء التكرار." });
      const firstRecord = first.record;
      statements.push(ctx.env.DB.prepare(`
        INSERT INTO recurring_series (
          id,venue_id,pitch_id,first_business_date,start_minute,duration_minutes,occurrence_count,
          customer_name,customer_phone_ciphertext,customer_phone_lookup_hash,status,created_by_user_id,created_at_ms,updated_at_ms
        ) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?,?)
      `).bind(
        seriesId, ctx.member.venueId, pitch.id, input.businessDate, firstRecord.startMinute,
        firstRecord.durationMinutes, occurrenceCount, input.customerName, firstRecord.customerPhoneCiphertext,
        firstRecord.customerPhoneLookupHash, ctx.member.userId, now, now,
      ));
    }
    for (const occurrence of occurrences) {
      statements.push(bookingInsertStatement(ctx.env.DB, occurrence.record));
      for (const bucket of occurrence.reservation.bucketIndices) {
        statements.push(ctx.env.DB.prepare(`
          INSERT INTO slot_locks (pitch_id,business_date,bucket_index,booking_id,created_at_ms)
          VALUES (?,?,?,?,?)
        `).bind(
          occurrence.reservation.pitchId,
          occurrence.reservation.businessDate,
          bucket,
          occurrence.reservation.bookingId,
          occurrence.reservation.createdAtMs,
        ));
      }
    }
    statements.push(auditEventStatement(ctx.env.DB, {
      venueId: ctx.member.venueId, actorUserId: ctx.member.userId,
      entityType: seriesId ? "recurring_series" : "booking", entityId: seriesId ?? occurrences[0]?.record.id ?? "",
      action: seriesId ? "weekly_series_created" : "manual_booking_created", createdAtMs: now,
    }));
    try {
      await ctx.env.DB.batch(statements);
    } catch {
      throw new TRPCError({ code: "CONFLICT", message: "يوجد موعد متداخل في إحدى الأسابيع؛ لم نحفظ أي حجز من السلسلة." });
    }
    return {
      ok: true,
      seriesId,
      bookings: occurrences.map(({ record, code, slot }) => ({
        id: record.id,
        businessDate: record.businessDate,
        startMinute: record.startMinute,
        customerCode: code,
        pricePiasters: slot.pricePiasters,
      })),
      savedAtMs: now,
    };
  }),

  reschedule: staffProcedure.input(z.object({
    bookingId: z.string().uuid(),
    expectedUpdatedAtMs: z.number().int().nonnegative(),
    pitchId: z.string().uuid(),
    businessDate: dateSchema,
    startMinute: z.number().int().min(0).max(2879).multipleOf(30),
  })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.env.DB.prepare(`
      SELECT id,venue_id,pitch_id,business_date,start_minute,duration_minutes,start_at_utc_ms,status,
             hold_expires_at_ms,updated_at_ms,payment_received_piasters
      FROM bookings WHERE id = ? AND venue_id = ? LIMIT 1
    `).bind(input.bookingId, ctx.member.venueId).first<{
      id: string; venue_id: string; pitch_id: string; business_date: string; start_minute: number;
      duration_minutes: 60 | 90; start_at_utc_ms: number; status: string; hold_expires_at_ms: number | null;
      updated_at_ms: number; payment_received_piasters: number;
    }>();
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "الحجز غير موجود." });
    if (existing.updated_at_ms !== input.expectedUpdatedAtMs) throw new TRPCError({ code: "CONFLICT", message: "تم تغيير الحجز من نافذة أخرى؛ حدّث الجدول ثم أعد التعديل." });
    const now = Date.now();
    if (!["pending", "confirmed"].includes(existing.status) || existing.start_at_utc_ms <= now) {
      throw new TRPCError({ code: "CONFLICT", message: "يمكن تعديل الحجوزات القادمة المعلقة أو المؤكدة فقط." });
    }
    if (existing.status === "pending" && (existing.hold_expires_at_ms ?? 0) <= now) {
      throw new TRPCError({ code: "CONFLICT", message: "انتهت مهلة الحجز المؤقت؛ لا يمكن نقله." });
    }
    const venue = await loadBookingVenueById(ctx.env.DB, ctx.member.venueId);
    const pitch = await ctx.env.DB.prepare("SELECT id FROM pitches WHERE id = ? AND venue_id = ? AND active = 1")
      .bind(input.pitchId, ctx.member.venueId).first<{ id: string }>();
    if (!venue || !pitch) throw new TRPCError({ code: "NOT_FOUND", message: "المكان أو الملعب غير موجود." });
    let slot;
    try {
      slot = await findAvailableSlot(ctx.env.DB, venue, input.pitchId, input.businessDate, input.startMinute, now, existing.id, 370);
    } catch (error) {
      if (error instanceof RangeError) throw new TRPCError({ code: "CONFLICT", message: error.message });
      throw error;
    }
    if (existing.payment_received_piasters > slot.pricePiasters) {
      throw new TRPCError({ code: "CONFLICT", message: "السعر الجديد أقل من المبلغ المسجل. راجع الدفع يدويًا قبل نقل الموعد." });
    }
    const updatedAt = Math.max(now, existing.updated_at_ms + 1);
    const update = ctx.env.DB.prepare(`
      UPDATE bookings SET pitch_id=?,business_date=?,start_minute=?,duration_minutes=?,start_at_utc_ms=?,end_at_utc_ms=?,
        price_piasters=?,recurring_series_id=NULL,updated_at_ms=?,updated_by_user_id=?
      WHERE id=? AND venue_id=? AND updated_at_ms=? AND status IN ('pending','confirmed')
        AND (? IS NULL OR hold_expires_at_ms > ?)
    `).bind(
      pitch.id, slot.businessDate, slot.startMinute, slot.durationMinutes, slot.startAtUtcMs, slot.endAtUtcMs,
      slot.pricePiasters, updatedAt, ctx.member.userId, existing.id, ctx.member.venueId,
      input.expectedUpdatedAtMs, existing.status === "pending" ? 1 : null, now,
    );
    const audit = ctx.env.DB.prepare(`
      INSERT INTO audit_events (id,venue_id,actor_user_id,entity_type,entity_id,action,created_at_ms)
      SELECT ?,?,?,'booking',?,'schedule_rescheduled',? WHERE EXISTS (
        SELECT 1 FROM bookings WHERE id=? AND venue_id=? AND updated_at_ms=?
          AND business_date=? AND start_minute=? AND pitch_id=?
      )
    `).bind(crypto.randomUUID(), ctx.member.venueId, ctx.member.userId, existing.id, updatedAt,
      existing.id, ctx.member.venueId, updatedAt, slot.businessDate, slot.startMinute, pitch.id);
    try {
      const result = await rescheduleBookingAtomicallyCas(ctx.env.DB, {
        bookingId: existing.id,
        venueId: ctx.member.venueId,
        expectedUpdatedAtMs: input.expectedUpdatedAtMs,
        oldPitchId: existing.pitch_id,
        oldBusinessDate: existing.business_date,
        oldStartMinute: existing.start_minute,
        targetStartMinute: slot.startMinute,
        bookingUpdate: update,
        target: {
          bookingId: existing.id,
          pitchId: pitch.id,
          businessDate: slot.businessDate,
          durationMinutes: slot.durationMinutes,
          bucketIndices: slot.bucketIndices,
          createdAtMs: updatedAt,
        },
        extraStatements: [audit],
      });
      if (!result.updated) throw new TRPCError({ code: "CONFLICT", message: "تغير الحجز قبل حفظ التعديل؛ حدّث الجدول وأعد المحاولة." });
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({ code: "CONFLICT", message: "الوقت الجديد اتحجز أثناء التعديل؛ رجعنا الموعد القديم كما هو." });
    }
    return { ok: true, savedAtMs: updatedAt, pricePiasters: slot.pricePiasters };
  }),

  changeStatus: staffProcedure.input(z.object({
    bookingId: z.string().uuid(),
    expectedUpdatedAtMs: z.number().int().nonnegative(),
    status: bookingStatusSchema,
    paymentStatus: paymentStatusSchema.optional(),
  })).mutation(async ({ ctx, input }) => {
    const row = await ctx.env.DB.prepare(`
      SELECT id,venue_id,status,start_at_utc_ms,end_at_utc_ms,hold_expires_at_ms,updated_at_ms,price_piasters,payment_received_piasters,payment_status
      FROM bookings WHERE id = ? AND venue_id = ? LIMIT 1
    `).bind(input.bookingId, ctx.member.venueId).first<{
      id: string; venue_id: string; status: string; start_at_utc_ms: number; end_at_utc_ms: number;
      hold_expires_at_ms: number | null; updated_at_ms: number; price_piasters: number; payment_received_piasters: number;
      payment_status: "unpaid" | "deposit" | "paid";
    }>();
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "الحجز غير موجود." });
    if (row.updated_at_ms !== input.expectedUpdatedAtMs) throw new TRPCError({ code: "CONFLICT", message: "تم تحديث الحجز من نافذة أخرى؛ حدّث البيانات أولًا." });
    if (!transitionAllowed(row.status, input.status)) throw new TRPCError({ code: "CONFLICT", message: `لا يمكن نقل الحالة من ${row.status} إلى ${input.status}.` });
    const now = Date.now();
    if (input.status === "confirmed" && row.status === "pending" && (row.hold_expires_at_ms ?? 0) <= now) {
      await expirePendingBookings(ctx.env.DB, now, undefined);
      throw new TRPCError({ code: "CONFLICT", message: "انتهت مهلة الحجز؛ حررنا الوقت. لا يمكن تأكيده الآن." });
    }
    if (["completed", "no_show"].includes(input.status) && row.end_at_utc_ms > now) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن تسجيل انتهاء المباراة أو عدم الحضور قبل نهاية الموعد." });
    }
    const venue = await loadBookingVenueById(ctx.env.DB, ctx.member.venueId);
    if (!venue) throw new TRPCError({ code: "NOT_FOUND", message: "المكان غير موجود." });
    let paymentStatus: "unpaid" | "deposit" | "paid" = input.paymentStatus ?? row.payment_status;
    let received = row.payment_received_piasters;
    if (input.paymentStatus === "paid") { paymentStatus = "paid"; received = row.price_piasters; }
    if (input.paymentStatus === "unpaid") { paymentStatus = "unpaid"; received = 0; }
    if (input.paymentStatus === "deposit") {
      received = Math.min(venue.deposit_amount_piasters, row.price_piasters);
      if (received <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "أدخل عربون المكان في الإعدادات أولًا." });
      paymentStatus = received >= row.price_piasters ? "paid" : "deposit";
    }
    const updatedAt = Math.max(now, row.updated_at_ms + 1);
    const releasesLocks = ["rejected", "cancelled", "completed", "no_show"].includes(input.status);
    const statements: D1PreparedStatement[] = [];
    if (releasesLocks) {
      statements.push(ctx.env.DB.prepare(`
        DELETE FROM slot_locks WHERE booking_id=? AND EXISTS (
          SELECT 1 FROM bookings WHERE id=? AND venue_id=? AND updated_at_ms=? AND status IN ('pending','confirmed')
        )
      `).bind(row.id, row.id, row.venue_id, input.expectedUpdatedAtMs));
    }
    statements.push(ctx.env.DB.prepare(`
      UPDATE bookings SET status=?,payment_status=?,payment_received_piasters=?,hold_expires_at_ms=NULL,
        cancellation_reason=?,updated_at_ms=?,updated_by_user_id=?
      WHERE id=? AND venue_id=? AND updated_at_ms=? AND status IN ('pending','confirmed')
    `).bind(
      input.status, paymentStatus, received,
      ["cancelled", "rejected"].includes(input.status) ? `owner_${input.status}` : null,
      updatedAt, ctx.member.userId, row.id, row.venue_id, input.expectedUpdatedAtMs,
    ));
    statements.push(ctx.env.DB.prepare(`
      INSERT INTO audit_events (id,venue_id,actor_user_id,entity_type,entity_id,action,created_at_ms)
      SELECT ?,?,?,'booking',?,?,? WHERE EXISTS (
        SELECT 1 FROM bookings WHERE id=? AND venue_id=? AND status=? AND updated_at_ms=?
      )
    `).bind(crypto.randomUUID(), row.venue_id, ctx.member.userId, row.id, `status_${input.status}`, updatedAt, row.id, row.venue_id, input.status, updatedAt));
    const results = await ctx.env.DB.batch(statements);
    const updateIndex = releasesLocks ? 1 : 0;
    if ((results[updateIndex]?.meta.changes ?? 0) === 0) throw new TRPCError({ code: "CONFLICT", message: "تغير الحجز قبل حفظ الحالة؛ حدّث الجدول." });
    return { ok: true, savedAtMs: updatedAt, status: input.status, paymentStatus };
  }),

  analytics: ownerProcedure.query(async ({ ctx }) => {
    const now = Date.now();
    const today = cairoBusinessDate(now);
    const fromDate = addCalendarDays(today, -29);
    const [totals, todayCounts, peaks, pitchCount, venue] = await Promise.all([
      ctx.env.DB.prepare(`
        SELECT COUNT(*) AS booking_count,
          COALESCE(SUM(CASE WHEN status IN ('confirmed','completed','no_show') THEN payment_received_piasters ELSE 0 END),0) AS revenue_piasters,
          SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) AS no_show_count,
          SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled_count
          ,SUM(CASE WHEN status IN ('completed','no_show') THEN 1 ELSE 0 END) AS resolved_count
        FROM bookings WHERE venue_id=? AND business_date BETWEEN ? AND ?
      `).bind(ctx.member.venueId, fromDate, today).first<{ booking_count: number; revenue_piasters: number; no_show_count: number; cancelled_count: number; resolved_count: number }>(),
      ctx.env.DB.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN status='pending' AND hold_expires_at_ms > ? THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed
        FROM bookings WHERE venue_id=? AND business_date=?
      `).bind(now, ctx.member.venueId, today).first<{ total: number; pending: number; confirmed: number }>(),
      ctx.env.DB.prepare(`
        SELECT start_minute,COUNT(*) AS count FROM bookings
        WHERE venue_id=? AND business_date BETWEEN ? AND ? AND status IN ('confirmed','completed','no_show')
        GROUP BY start_minute ORDER BY count DESC,start_minute ASC LIMIT 5
      `).bind(ctx.member.venueId, fromDate, today).all<{ start_minute: number; count: number }>(),
      ctx.env.DB.prepare("SELECT COUNT(*) AS count FROM pitches WHERE venue_id=? AND active=1")
        .bind(ctx.member.venueId).first<{ count: number }>(),
      ctx.env.DB.prepare("SELECT opening_minute,closing_business_minute FROM venues WHERE id=?")
        .bind(ctx.member.venueId).first<{ opening_minute: number; closing_business_minute: number }>(),
    ]);
    const days = Math.max(1, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000) + 1);
    const booked = await ctx.env.DB.prepare(`
      SELECT COALESCE(SUM(duration_minutes / 30),0) AS buckets FROM bookings
      WHERE venue_id=? AND business_date BETWEEN ? AND ? AND status IN ('confirmed','completed','no_show')
    `).bind(ctx.member.venueId, fromDate, today).first<{ buckets: number }>();
    const availableBuckets = Math.max(1,
      (((venue?.closing_business_minute ?? 1560) - (venue?.opening_minute ?? 840)) / 30) *
      (pitchCount?.count ?? 0) * days,
    );
    return {
      today: { total: todayCounts?.total ?? 0, pending: todayCounts?.pending ?? 0, confirmed: todayCounts?.confirmed ?? 0 },
      last30Days: {
        bookings: totals?.booking_count ?? 0,
        revenueEgp: (totals?.revenue_piasters ?? 0) / 100,
        noShows: totals?.no_show_count ?? 0,
        noShowRatePercent: (totals?.resolved_count ?? 0) > 0 ? Math.round(((totals?.no_show_count ?? 0) / (totals?.resolved_count ?? 1)) * 100) : 0,
        cancellations: totals?.cancelled_count ?? 0,
        occupancyPercent: Math.min(100, Math.round(((booked?.buckets ?? 0) / availableBuckets) * 100)),
      },
      peakStarts: (peaks.results ?? []).map((row) => ({ startMinute: row.start_minute, bookings: row.count })),
    };
  }),
});
