import type { D1Database } from "@cloudflare/workers-types";
import {
  BUSINESS_TIME_ZONE,
  createBusinessDaySlots,
  deriveSlotAvailability,
  type BusinessSlot,
} from "../../shared/domain/schedule.js";
import { expirePendingBookings } from "./expiry.js";

export interface VenueSchedule {
  id: string;
  slot_length_minutes: 60 | 90;
  opening_minute: number;
  closing_business_minute: number;
}

export interface SlotOption extends BusinessSlot {
  pitchId: string;
  availability: "available" | "pending" | "booked";
  pricePiasters: number;
}

export function cairoBusinessDate(nowMs = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function addCalendarDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days) || Math.abs(days) > 370) {
    throw new RangeError("Calendar shift is outside the supported range.");
  }
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (probe.toISOString().slice(0, 10) !== date) throw new RangeError("Date is not a real calendar date.");
  probe.setUTCDate(probe.getUTCDate() + days);
  return probe.toISOString().slice(0, 10);
}

export function assertBookableDate(date: string, nowMs = Date.now(), maxDays = 60): void {
  const today = cairoBusinessDate(nowMs);
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 370) throw new RangeError("Booking horizon is invalid.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > addCalendarDays(today, maxDays)) {
    throw new RangeError(`Choose a real business date from today through the next ${maxDays} days.`);
  }
  const [year, month, day] = date.split("-").map(Number);
  if (new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).toISOString().slice(0, 10) !== date) {
    throw new RangeError("Business date is not a real calendar date.");
  }
}

export async function priceForSlot(
  db: D1Database,
  venueId: string,
  pitchId: string,
  businessDate: string,
  startMinute: number,
): Promise<number> {
  const [year, month, day] = businessDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  const dayBit = 1 << weekday;
  const row = await db.prepare(`
    SELECT price_piasters
    FROM price_rules
    WHERE venue_id = ?
      AND (pitch_id = ? OR pitch_id IS NULL)
      AND (day_mask & ?) != 0
      AND start_minute <= ? AND end_minute > ?
      AND (valid_from_business_date IS NULL OR valid_from_business_date <= ?)
      AND (valid_until_business_date IS NULL OR valid_until_business_date >= ?)
    ORDER BY CASE WHEN pitch_id = ? THEN 0 ELSE 1 END, start_minute DESC, updated_at_ms DESC
    LIMIT 1
  `).bind(venueId, pitchId, dayBit, startMinute, startMinute, businessDate, businessDate, pitchId)
    .first<{ price_piasters: number }>();
  return row?.price_piasters ?? 0;
}

export async function listSlotOptions(
  db: D1Database,
  venue: VenueSchedule,
  pitchId: string,
  businessDate: string,
  nowMs = Date.now(),
  ignoreBookingId?: string,
  maxDays = 60,
): Promise<SlotOption[]> {
  assertBookableDate(businessDate, nowMs, maxDays);
  await expirePendingBookings(db, nowMs, businessDate);
  const slots = createBusinessDaySlots(
    businessDate,
    venue.slot_length_minutes,
    BUSINESS_TIME_ZONE,
    venue.opening_minute,
    venue.closing_business_minute,
  );
  const rows = await db.prepare(`
    SELECT l.bucket_index, b.id AS booking_id, b.status, b.hold_expires_at_ms
    FROM slot_locks l
    JOIN bookings b ON b.id = l.booking_id
    WHERE l.pitch_id = ? AND l.business_date = ?
      AND b.venue_id = ? AND b.status IN ('pending', 'confirmed')
  `).bind(pitchId, businessDate, venue.id).all<{
    bucket_index: number;
    booking_id: string;
    status: "pending" | "confirmed";
    hold_expires_at_ms: number | null;
  }>();
  const locks = rows.results ?? [];
  const [year, month, day] = businessDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  const dayBit = 1 << weekday;
  const ruleRows = await db.prepare(`
    SELECT pitch_id,start_minute,end_minute,price_piasters,valid_from_business_date,valid_until_business_date,updated_at_ms
    FROM price_rules WHERE venue_id = ? AND (pitch_id = ? OR pitch_id IS NULL) AND (day_mask & ?) != 0
      AND (valid_from_business_date IS NULL OR valid_from_business_date <= ?)
      AND (valid_until_business_date IS NULL OR valid_until_business_date >= ?)
  `).bind(venue.id, pitchId, dayBit, businessDate, businessDate).all<{
    pitch_id: string | null; start_minute: number; end_minute: number; price_piasters: number;
    valid_from_business_date: string | null; valid_until_business_date: string | null; updated_at_ms: number;
  }>();
  const priceRules = ruleRows.results ?? [];
  const options: SlotOption[] = [];
  for (const slot of slots) {
    const reservationMap = new Map<string, { status: "pending" | "confirmed"; holdExpiresAtMs: number | null }>();
    for (const lock of locks) {
      if (lock.booking_id !== ignoreBookingId && slot.bucketIndices.includes(lock.bucket_index)) {
        reservationMap.set(lock.booking_id, { status: lock.status, holdExpiresAtMs: lock.hold_expires_at_ms });
      }
    }
    options.push({
      ...slot,
      pitchId,
      availability: deriveSlotAvailability([...reservationMap.values()], nowMs),
      pricePiasters: priceRules
        .filter((rule) => rule.start_minute <= slot.startMinute && rule.end_minute > slot.startMinute)
        .sort((left, right) => {
          const specific = Number(left.pitch_id !== pitchId) - Number(right.pitch_id !== pitchId);
          return specific || right.start_minute - left.start_minute || right.updated_at_ms - left.updated_at_ms;
        })[0]?.price_piasters ?? 0,
    });
  }
  return options;
}

export async function findAvailableSlot(
  db: D1Database,
  venue: VenueSchedule,
  pitchId: string,
  businessDate: string,
  startMinute: number,
  nowMs = Date.now(),
  ignoreBookingId?: string,
  maxDays = 60,
): Promise<SlotOption> {
  const options = await listSlotOptions(db, venue, pitchId, businessDate, nowMs, ignoreBookingId, maxDays);
  const found = options.find((slot) => slot.startMinute === startMinute);
  if (!found) throw new RangeError("الموعد غير موجود ضمن ساعات العمل المختارة.");
  if (found.availability !== "available") throw new RangeError("الميعاد ده اتحجز، اختار وقت تاني.");
  if (found.startAtUtcMs <= nowMs) throw new RangeError("موعد البداية فات؛ اختار وقتًا لاحقًا.");
  return found;
}
