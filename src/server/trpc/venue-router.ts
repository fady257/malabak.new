import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { normalizeEgyptianPhone } from "../security/crypto.js";
import { assertConfiguredSecret } from "../security/request-security.js";
import { hashPassword, validatePassword } from "../auth/password.js";
import { enforceRateLimit } from "../security/rate-limit.js";
import { auditEventStatement } from "../db/audit.js";
import { ownerProcedure, protectedProcedure, publicProcedure, router } from "./core.js";
import { cairoBusinessDate } from "../booking/availability.js";

const minuteSchema = z.number().int().min(0).max(2879).multipleOf(30);
const venueFields = z.object({
  name: z.string().trim().min(2).max(160),
  address: z.string().trim().max(240).nullable(),
  description: z.string().trim().max(600).nullable(),
  vodafoneCashNumber: z.string().trim().max(32).nullable(),
  whatsappNumber: z.string().trim().max(32).nullable(),
  depositEgp: z.number().finite().min(0).max(500_000),
  holdMinutes: z.number().int().min(5).max(240),
  slotLengthMinutes: z.union([z.literal(60), z.literal(90)]),
  openingMinute: z.number().int().min(0).max(1439).multipleOf(30),
  closingBusinessMinute: z.number().int().min(30).max(2880).multipleOf(30),
  defaultPriceEgp: z.number().finite().min(0).max(500_000),
  cancellationNoticeHours: z.number().int().min(0).max(168),
  publicBookingEnabled: z.boolean(),
});

function safePhone(value: string | null): string | null {
  if (!value) return null;
  try { return normalizeEgyptianPhone(value); }
  catch { throw new TRPCError({ code: "BAD_REQUEST", message: "أدخل رقم موبايل مصري صالحًا." }); }
}

async function publicVenue(db: D1Database, slug?: string) {
  const venue = slug
    ? await db.prepare(`
        SELECT id,slug,name,address,description,vodafone_cash_number,whatsapp_number,
               deposit_amount_piasters,hold_minutes,slot_length_minutes,opening_minute,
               closing_business_minute,cancellation_notice_hours
        FROM venues WHERE slug = ? COLLATE NOCASE AND public_booking_enabled = 1 LIMIT 1
      `).bind(slug).first<{
        id: string; slug: string; name: string; address: string | null; description: string | null;
        vodafone_cash_number: string | null; whatsapp_number: string | null;
        deposit_amount_piasters: number; hold_minutes: number; slot_length_minutes: 60 | 90;
        opening_minute: number; closing_business_minute: number; cancellation_notice_hours: number;
      }>()
    : await db.prepare(`
        SELECT id,slug,name,address,description,vodafone_cash_number,whatsapp_number,
               deposit_amount_piasters,hold_minutes,slot_length_minutes,opening_minute,
               closing_business_minute,cancellation_notice_hours
        FROM venues WHERE public_booking_enabled = 1 ORDER BY created_at_ms ASC LIMIT 1
      `).first<{
        id: string; slug: string; name: string; address: string | null; description: string | null;
        vodafone_cash_number: string | null; whatsapp_number: string | null;
        deposit_amount_piasters: number; hold_minutes: number; slot_length_minutes: 60 | 90;
        opening_minute: number; closing_business_minute: number; cancellation_notice_hours: number;
      }>();
  if (!venue) return null;

  const pitches = await db.prepare(`
    SELECT p.id,p.name,p.description,p.indoor,
      (SELECT m.id FROM media_assets m WHERE m.pitch_id = p.id AND m.venue_id = p.venue_id
        AND m.purpose = 'pitch_photo' AND m.state = 'active' ORDER BY m.created_at_ms DESC LIMIT 1) AS cover_asset_id
    FROM pitches p WHERE p.venue_id = ? AND p.active = 1
    ORDER BY p.display_order ASC,p.created_at_ms ASC
  `).bind(venue.id).all<{ id: string; name: string; description: string | null; indoor: number; cover_asset_id: string | null }>();

  return {
    slug: venue.slug,
    name: venue.name,
    address: venue.address,
    description: venue.description,
    vodafoneCashNumber: venue.vodafone_cash_number,
    whatsappNumber: venue.whatsapp_number,
    depositPiasters: venue.deposit_amount_piasters,
    holdMinutes: venue.hold_minutes,
    slotLengthMinutes: venue.slot_length_minutes,
    openingMinute: venue.opening_minute,
    closingBusinessMinute: venue.closing_business_minute,
    cancellationNoticeHours: venue.cancellation_notice_hours,
    pitches: (pitches.results ?? []).map((pitch) => ({
      id: pitch.id,
      name: pitch.name,
      description: pitch.description,
      indoor: Boolean(pitch.indoor),
      coverUrl: pitch.cover_asset_id ? `/api/media/${encodeURIComponent(pitch.cover_asset_id)}` : null,
    })),
  };
}

export const venueRouter = router({
  publicDefault: publicProcedure.query(({ ctx }) => publicVenue(ctx.env.DB)),
  publicBySlug: publicProcedure.input(z.object({ slug: z.string().min(2).max(80) })).query(({ ctx, input }) => publicVenue(ctx.env.DB, input.slug)),

  settings: ownerProcedure.query(async ({ ctx }) => {
    const row = await ctx.env.DB.prepare(`
      SELECT v.id,v.name,v.slug,v.address,v.description,v.vodafone_cash_number,v.whatsapp_number,
             v.deposit_amount_piasters,v.hold_minutes,v.slot_length_minutes,v.opening_minute,
             v.closing_business_minute,v.cancellation_notice_hours,v.public_booking_enabled,
             (SELECT price_piasters FROM price_rules r WHERE r.venue_id = v.id AND r.pitch_id IS NULL
              ORDER BY CASE WHEN r.day_mask = 127 THEN 0 ELSE 1 END,r.start_minute LIMIT 1) AS default_price_piasters
      FROM venues v WHERE v.id = ? LIMIT 1
    `).bind(ctx.member.venueId).first<{
      id: string; name: string; slug: string; address: string | null; description: string | null;
      vodafone_cash_number: string | null; whatsapp_number: string | null;
      deposit_amount_piasters: number; hold_minutes: number; slot_length_minutes: 60 | 90;
      opening_minute: number; closing_business_minute: number; cancellation_notice_hours: number;
      public_booking_enabled: number; default_price_piasters: number | null;
    }>();
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "المكان غير موجود." });
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      address: row.address,
      description: row.description,
      vodafoneCashNumber: row.vodafone_cash_number,
      whatsappNumber: row.whatsapp_number,
      depositEgp: row.deposit_amount_piasters / 100,
      holdMinutes: row.hold_minutes,
      slotLengthMinutes: row.slot_length_minutes,
      openingMinute: row.opening_minute,
      closingBusinessMinute: row.closing_business_minute,
      cancellationNoticeHours: row.cancellation_notice_hours,
      publicBookingEnabled: Boolean(row.public_booking_enabled),
      defaultPriceEgp: (row.default_price_piasters ?? 0) / 100,
    };
  }),

  updateSettings: ownerProcedure.input(venueFields).mutation(async ({ ctx, input }) => {
    if (input.closingBusinessMinute <= input.openingMinute || input.closingBusinessMinute - input.openingMinute > 780) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "ساعات العمل يجب أن تكون بعد الفتح وبحد أقصى 13 ساعة." });
    }
    if (input.closingBusinessMinute - input.openingMinute < input.slotLengthMinutes) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "مدة العمل أقصر من مدة الحجز المختارة." });
    }
    const today = cairoBusinessDate();
    const conflicts = await ctx.env.DB.prepare(`
      SELECT COUNT(*) AS count FROM bookings
      WHERE venue_id = ? AND status IN ('pending','confirmed') AND business_date >= ?
        AND (duration_minutes != ? OR start_minute < ? OR start_minute + duration_minutes > ?)
    `).bind(ctx.member.venueId, today, input.slotLengthMinutes, input.openingMinute, input.closingBusinessMinute)
      .first<{ count: number }>();
    if ((conflicts?.count ?? 0) > 0) {
      throw new TRPCError({ code: "CONFLICT", message: `يوجد ${conflicts?.count} حجز نشط خارج الإعدادات الجديدة. أعد جدولته أو ألغِه أولًا.` });
    }

    const now = Date.now();
    const priceId = `default-${ctx.member.venueId}`;
    const payment = safePhone(input.vodafoneCashNumber);
    const whatsapp = safePhone(input.whatsappNumber);
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`
        UPDATE venues SET name = ?, address = ?, description = ?, vodafone_cash_number = ?,
          whatsapp_number = ?, deposit_amount_piasters = ?, hold_minutes = ?, slot_length_minutes = ?,
          opening_minute = ?, closing_business_minute = ?, cancellation_notice_hours = ?,
          public_booking_enabled = ?, updated_at_ms = ?
        WHERE id = ? AND owner_user_id = ?
      `).bind(
        input.name, input.address, input.description, payment, whatsapp,
        Math.round(input.depositEgp * 100), input.holdMinutes, input.slotLengthMinutes,
        input.openingMinute, input.closingBusinessMinute, input.cancellationNoticeHours,
        input.publicBookingEnabled ? 1 : 0, now, ctx.member.venueId, ctx.member.userId,
      ),
      ctx.env.DB.prepare(`
        INSERT INTO price_rules (id,venue_id,pitch_id,day_mask,start_minute,end_minute,price_piasters,created_at_ms,updated_at_ms)
        VALUES (?, ?, NULL, 127, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET start_minute=excluded.start_minute,
          end_minute=excluded.end_minute,price_piasters=excluded.price_piasters,updated_at_ms=excluded.updated_at_ms
        WHERE price_rules.venue_id = excluded.venue_id
      `).bind(priceId, ctx.member.venueId, input.openingMinute, input.closingBusinessMinute, Math.round(input.defaultPriceEgp * 100), now, now),
      auditEventStatement(ctx.env.DB, {
        venueId: ctx.member.venueId,
        actorUserId: ctx.member.userId,
        entityType: "venue",
        entityId: ctx.member.venueId,
        action: "settings_updated",
        createdAtMs: now,
      }),
    ]);
    return { ok: true, savedAtMs: now };
  }),

  pitches: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.env.DB.prepare(`
      SELECT p.id,p.name,p.description,p.indoor,p.active,p.display_order,
        (SELECT m.id FROM media_assets m WHERE m.pitch_id = p.id AND m.purpose = 'pitch_photo' AND m.state = 'active'
          ORDER BY m.created_at_ms DESC LIMIT 1) AS cover_asset_id
      FROM pitches p WHERE p.venue_id = ? ORDER BY p.display_order,p.created_at_ms
    `).bind(ctx.member.venueId).all<{
      id: string; name: string; description: string | null; indoor: number; active: number;
      display_order: number; cover_asset_id: string | null;
    }>();
    return (rows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      indoor: Boolean(row.indoor),
      active: Boolean(row.active),
      displayOrder: row.display_order,
      coverUrl: row.cover_asset_id ? `/api/media/${encodeURIComponent(row.cover_asset_id)}` : null,
    }));
  }),

  createPitch: ownerProcedure.input(z.object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(400).nullable(),
    indoor: z.boolean(),
  })).mutation(async ({ ctx, input }) => {
    const count = await ctx.env.DB.prepare("SELECT COUNT(*) AS count FROM pitches WHERE venue_id = ?")
      .bind(ctx.member.venueId).first<{ count: number }>();
    if ((count?.count ?? 0) >= 12) throw new TRPCError({ code: "BAD_REQUEST", message: "الحد الأقصى 12 ملعبًا لكل مكان." });
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await ctx.env.DB.batch([
        ctx.env.DB.prepare("INSERT INTO pitches (id,venue_id,name,active,display_order,created_at_ms,updated_at_ms,description,indoor) VALUES (?,?,?,1,?,?,?, ?, ?)")
          .bind(id, ctx.member.venueId, input.name, count?.count ?? 0, now, now, input.description, input.indoor ? 1 : 0),
        auditEventStatement(ctx.env.DB, { venueId: ctx.member.venueId, actorUserId: ctx.member.userId, entityType: "pitch", entityId: id, action: "created", createdAtMs: now }),
      ]);
    } catch {
      throw new TRPCError({ code: "CONFLICT", message: "تعذر إضافة الملعب؛ تأكد من عدم تكرار الاسم." });
    }
    return { id };
  }),

  updatePitch: ownerProcedure.input(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(400).nullable(),
    indoor: z.boolean(),
    active: z.boolean(),
  })).mutation(async ({ ctx, input }) => {
    if (!input.active) {
      const today = cairoBusinessDate();
      const activeBookings = await ctx.env.DB.prepare(`
        SELECT COUNT(*) AS count FROM bookings WHERE venue_id = ? AND pitch_id = ?
          AND business_date >= ? AND status IN ('pending','confirmed')
      `).bind(ctx.member.venueId, input.id, today).first<{ count: number }>();
      if ((activeBookings?.count ?? 0) > 0) throw new TRPCError({ code: "CONFLICT", message: "انقل أو ألغِ الحجوزات القادمة قبل إيقاف هذا الملعب." });
    }
    const now = Date.now();
    try {
      const result = await ctx.env.DB.prepare(`
        UPDATE pitches SET name = ?, description = ?, indoor = ?, active = ?, updated_at_ms = ?
        WHERE id = ? AND venue_id = ?
      `).bind(input.name, input.description, input.indoor ? 1 : 0, input.active ? 1 : 0, now, input.id, ctx.member.venueId).run();
      if ((result.meta.changes ?? 0) === 0) throw new TRPCError({ code: "NOT_FOUND", message: "الملعب غير موجود." });
      await ctx.env.DB.prepare("INSERT INTO audit_events (id,venue_id,actor_user_id,entity_type,entity_id,action,created_at_ms) VALUES (?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), ctx.member.venueId, ctx.member.userId, "pitch", input.id, "updated", now).run();
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({ code: "CONFLICT", message: "تعذر حفظ بيانات الملعب؛ ربما الاسم مستخدم." });
    }
    return { ok: true, savedAtMs: now };
  }),

  staffList: ownerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.env.DB.prepare(`
      SELECT u.id,u.email,vm.active,vm.created_at_ms
      FROM venue_members vm JOIN users u ON u.id=vm.user_id
      WHERE vm.venue_id=? AND vm.role='staff'
      ORDER BY vm.active DESC,vm.created_at_ms ASC LIMIT 100
    `).bind(ctx.member.venueId).all<{ id: string; email: string; active: number; created_at_ms: number }>();
    return (rows.results ?? []).map((row) => ({ id: row.id, email: row.email, active: Boolean(row.active), createdAtMs: row.created_at_ms }));
  }),

  priceRules: ownerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.env.DB.prepare(`
      SELECT r.id,r.pitch_id,p.name AS pitch_name,r.day_mask,r.start_minute,r.end_minute,r.price_piasters
      FROM price_rules r LEFT JOIN pitches p ON p.id=r.pitch_id AND p.venue_id=r.venue_id
      WHERE r.venue_id=? AND r.id != ?
      ORDER BY r.pitch_id IS NOT NULL,r.day_mask,r.start_minute
    `).bind(ctx.member.venueId, `default-${ctx.member.venueId}`).all<{
      id: string; pitch_id: string | null; pitch_name: string | null; day_mask: number;
      start_minute: number; end_minute: number; price_piasters: number;
    }>();
    return (rows.results ?? []).map((row) => ({
      id: row.id, pitchId: row.pitch_id, pitchName: row.pitch_name, dayMask: row.day_mask,
      startMinute: row.start_minute, endMinute: row.end_minute, priceEgp: row.price_piasters / 100,
    }));
  }),

  savePriceRule: ownerProcedure.input(z.object({
    id: z.string().uuid().optional(),
    pitchId: z.string().uuid().nullable(),
    dayMask: z.number().int().min(1).max(127),
    startMinute: z.number().int().min(0).max(2879).multipleOf(30),
    endMinute: z.number().int().min(30).max(2880).multipleOf(30),
    priceEgp: z.number().finite().min(0).max(500_000),
  })).mutation(async ({ ctx, input }) => {
    const venue = await ctx.env.DB.prepare("SELECT opening_minute,closing_business_minute FROM venues WHERE id=?")
      .bind(ctx.member.venueId).first<{ opening_minute: number; closing_business_minute: number }>();
    if (!venue) throw new TRPCError({ code: "NOT_FOUND", message: "المكان غير موجود." });
    if (input.startMinute < venue.opening_minute || input.endMinute > venue.closing_business_minute || input.endMinute <= input.startMinute) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "الفترة السعرية لازم تكون داخل ساعات العمل وتبدأ قبل نهايتها." });
    }
    if (input.pitchId) {
      const pitch = await ctx.env.DB.prepare("SELECT id FROM pitches WHERE id=? AND venue_id=? LIMIT 1")
        .bind(input.pitchId, ctx.member.venueId).first<{ id: string }>();
      if (!pitch) throw new TRPCError({ code: "NOT_FOUND", message: "الملعب المحدد غير موجود." });
    }
    const now = Date.now();
    const id = input.id ?? crypto.randomUUID();
    if (input.id) {
      const exists = await ctx.env.DB.prepare("SELECT id FROM price_rules WHERE id=? AND venue_id=? AND id != ? LIMIT 1")
        .bind(input.id, ctx.member.venueId, `default-${ctx.member.venueId}`).first<{ id: string }>();
      if (!exists) throw new TRPCError({ code: "NOT_FOUND", message: "قاعدة السعر غير موجودة." });
    }
    const statement = input.id
      ? ctx.env.DB.prepare(`UPDATE price_rules SET pitch_id=?,day_mask=?,start_minute=?,end_minute=?,price_piasters=?,updated_at_ms=? WHERE id=? AND venue_id=?`)
        .bind(input.pitchId, input.dayMask, input.startMinute, input.endMinute, Math.round(input.priceEgp * 100), now, id, ctx.member.venueId)
      : ctx.env.DB.prepare(`INSERT INTO price_rules (id,venue_id,pitch_id,day_mask,start_minute,end_minute,price_piasters,valid_from_business_date,valid_until_business_date,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?)`)
        .bind(id, ctx.member.venueId, input.pitchId, input.dayMask, input.startMinute, input.endMinute, Math.round(input.priceEgp * 100), now, now);
    await ctx.env.DB.batch([
      statement,
      auditEventStatement(ctx.env.DB, { venueId: ctx.member.venueId, actorUserId: ctx.member.userId, entityType: "price_rule", entityId: id, action: input.id ? "updated" : "created", createdAtMs: now }),
    ]);
    return { ok: true, id, savedAtMs: now };
  }),

  deletePriceRule: ownerProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.env.DB.prepare("SELECT id FROM price_rules WHERE id=? AND venue_id=? AND id != ? LIMIT 1")
      .bind(input.id, ctx.member.venueId, `default-${ctx.member.venueId}`).first<{ id: string }>();
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "قاعدة السعر غير موجودة." });
    const now = Date.now();
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("DELETE FROM price_rules WHERE id=? AND venue_id=?").bind(input.id, ctx.member.venueId),
      auditEventStatement(ctx.env.DB, { venueId: ctx.member.venueId, actorUserId: ctx.member.userId, entityType: "price_rule", entityId: input.id, action: "deleted", createdAtMs: now }),
    ]);
    return { ok: true, savedAtMs: now };
  }),

  addStaff: ownerProcedure.input(z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(128),
  })).mutation(async ({ ctx, input }) => {
    await enforceRateLimit(ctx.env.DB, ctx.env, ctx.request, { scope: `staff-create:${ctx.member.venueId}`, limit: 10, windowMs: 60 * 60_000, blockMs: 60 * 60_000 });
    const email = input.email.trim().toLowerCase();
    if (email === ctx.member.email.toLowerCase()) throw new TRPCError({ code: "BAD_REQUEST", message: "استخدم بريدًا مستقلًا للموظف." });
    try {
      validatePassword(input.password);
    } catch (error) {
      if (error instanceof RangeError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      throw error;
    }
    const pepper = assertConfiguredSecret(ctx.env.AUTH_PEPPER, "AUTH_PEPPER");
    const passwordHash = await hashPassword(input.password, pepper);
    const now = Date.now();
    const userId = crypto.randomUUID();
    try {
      await ctx.env.DB.batch([
        ctx.env.DB.prepare("INSERT INTO users (id,email,email_normalized,password_hash,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?)")
          .bind(userId, email, email, passwordHash, now, now),
        ctx.env.DB.prepare("INSERT INTO venue_members (venue_id,user_id,role,active,created_at_ms) VALUES (?,?,'staff',1,?)")
          .bind(ctx.member.venueId, userId, now),
        auditEventStatement(ctx.env.DB, { venueId: ctx.member.venueId, actorUserId: ctx.member.userId, entityType: "staff", entityId: userId, action: "staff_created", createdAtMs: now }),
      ]);
    } catch {
      throw new TRPCError({ code: "CONFLICT", message: "تعذر إنشاء الحساب. قد يكون البريد مستخدمًا بالفعل؛ لم نغيّر حسابًا سابقًا." });
    }
    return { ok: true, email, savedAtMs: now };
  }),

  setStaffActive: ownerProcedure.input(z.object({ userId: z.string().uuid(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
    const now = Date.now();
    const results = await ctx.env.DB.batch([
      ctx.env.DB.prepare(`
        UPDATE venue_members SET active=? WHERE venue_id=? AND user_id=? AND role='staff'
      `).bind(input.active ? 1 : 0, ctx.member.venueId, input.userId),
      ctx.env.DB.prepare(`
        INSERT INTO audit_events (id,venue_id,actor_user_id,entity_type,entity_id,action,created_at_ms)
        SELECT ?,?,?, 'staff',?,?,? WHERE EXISTS (
          SELECT 1 FROM venue_members WHERE venue_id=? AND user_id=? AND role='staff' AND active=?
        )
      `).bind(
        crypto.randomUUID(), ctx.member.venueId, ctx.member.userId, input.userId,
        input.active ? "staff_activated" : "staff_deactivated", now,
        ctx.member.venueId, input.userId, input.active ? 1 : 0,
      ),
    ]);
    if ((results[0]?.meta.changes ?? 0) === 0) throw new TRPCError({ code: "NOT_FOUND", message: "حساب الموظف غير موجود." });
    return { ok: true, savedAtMs: now };
  }),

  today: protectedProcedure.query(({ ctx }) => ({ businessDate: cairoBusinessDate(), venueName: ctx.member.venueName })),
});
