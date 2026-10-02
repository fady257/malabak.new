import type { D1Database } from "@cloudflare/workers-types";
import type { AppEnv } from "../env.js";
import { encryptPhone, hmacSha256Hex, normalizeEgyptianPhone } from "../security/crypto.js";

export interface BookingVenueConfig {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  vodafone_cash_number: string | null;
  whatsapp_number: string | null;
  deposit_amount_piasters: number;
  hold_minutes: number;
  slot_length_minutes: 60 | 90;
  opening_minute: number;
  closing_business_minute: number;
  cancellation_notice_hours: number;
}

export async function loadBookingVenueBySlug(db: D1Database, slug: string): Promise<BookingVenueConfig | null> {
  return db.prepare(`
    SELECT id,slug,name,address,vodafone_cash_number,whatsapp_number,deposit_amount_piasters,
           hold_minutes,slot_length_minutes,opening_minute,closing_business_minute,cancellation_notice_hours
    FROM venues WHERE slug = ? COLLATE NOCASE AND public_booking_enabled = 1 LIMIT 1
  `).bind(slug).first<BookingVenueConfig>();
}

export async function loadBookingVenueById(db: D1Database, venueId: string): Promise<BookingVenueConfig | null> {
  return db.prepare(`
    SELECT id,slug,name,address,vodafone_cash_number,whatsapp_number,deposit_amount_piasters,
           hold_minutes,slot_length_minutes,opening_minute,closing_business_minute,cancellation_notice_hours
    FROM venues WHERE id = ? LIMIT 1
  `).bind(venueId).first<BookingVenueConfig>();
}

export async function phoneDigests(env: AppEnv, phoneInput: string): Promise<{ normalizedPhone: string; encryptedPhone: string; phoneLookupHash: string }> {
  const normalizedPhone = normalizeEgyptianPhone(phoneInput);
  const secret = env.BOOKING_HASH_SECRET;
  if (!secret) throw new Error("BOOKING_HASH_SECRET is missing.");
  const [encryptedPhone, phoneLookupHash] = await Promise.all([
    encryptPhone(env, normalizedPhone),
    hmacSha256Hex(secret, `phone:${normalizedPhone}`),
  ]);
  return { normalizedPhone, encryptedPhone, phoneLookupHash };
}

export interface NewBookingRecord {
  id: string;
  venueId: string;
  pitchId: string;
  recurringSeriesId: string | null;
  businessDate: string;
  startMinute: number;
  durationMinutes: 60 | 90;
  startAtUtcMs: number;
  endAtUtcMs: number;
  customerName: string;
  customerPhoneCiphertext: string;
  customerPhoneLookupHash: string;
  bookingCodeHash: string;
  status: "pending" | "confirmed";
  paymentStatus: "unpaid" | "deposit" | "paid";
  paymentReference: string | null;
  holdExpiresAtMs: number | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  pricePiasters: number;
  paymentReceivedPiasters: number;
  customerNote: string | null;
  createdAtMs: number;
}

export function bookingInsertStatement(db: D1Database, booking: NewBookingRecord): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO bookings (
      id,venue_id,pitch_id,recurring_series_id,business_date,start_minute,duration_minutes,
      start_at_utc_ms,end_at_utc_ms,customer_name,customer_phone_ciphertext,
      customer_phone_lookup_hash,booking_code_hash,status,payment_status,payment_reference,
      hold_expires_at_ms,cancellation_reason,created_by_user_id,updated_by_user_id,
      created_at_ms,updated_at_ms,customer_note,price_piasters,payment_received_piasters
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)
  `).bind(
    booking.id,
    booking.venueId,
    booking.pitchId,
    booking.recurringSeriesId,
    booking.businessDate,
    booking.startMinute,
    booking.durationMinutes,
    booking.startAtUtcMs,
    booking.endAtUtcMs,
    booking.customerName,
    booking.customerPhoneCiphertext,
    booking.customerPhoneLookupHash,
    booking.bookingCodeHash,
    booking.status,
    booking.paymentStatus,
    booking.paymentReference,
    booking.holdExpiresAtMs,
    booking.createdByUserId,
    booking.updatedByUserId,
    booking.createdAtMs,
    booking.createdAtMs,
    booking.customerNote,
    booking.pricePiasters,
    booking.paymentReceivedPiasters,
  );
}

export interface CustomerBookingRow {
  id: string;
  venue_id: string;
  venue_name: string;
  venue_slug: string;
  venue_whatsapp_number: string | null;
  pitch_name: string;
  business_date: string;
  start_minute: number;
  duration_minutes: 60 | 90;
  start_at_utc_ms: number;
  end_at_utc_ms: number;
  customer_name: string;
  customer_phone_ciphertext: string;
  customer_phone_lookup_hash: string;
  booking_code_hash: string;
  status: string;
  payment_status: string;
  payment_reference: string | null;
  hold_expires_at_ms: number | null;
  price_piasters: number;
  payment_received_piasters: number;
  updated_at_ms: number;
}

export async function findCustomerBooking(
  db: D1Database,
  venueId: string | null,
  codeHash: string,
  phoneLookupHash: string,
): Promise<CustomerBookingRow | null> {
  const venueClause = venueId ? "AND b.venue_id = ?" : "";
  const statement = db.prepare(`
    SELECT b.id,b.venue_id,v.name AS venue_name,v.slug AS venue_slug,v.whatsapp_number AS venue_whatsapp_number,
           p.name AS pitch_name,b.business_date,b.start_minute,b.duration_minutes,b.start_at_utc_ms,
           b.end_at_utc_ms,b.customer_name,b.customer_phone_ciphertext,b.customer_phone_lookup_hash,
           b.booking_code_hash,b.status,b.payment_status,b.payment_reference,b.hold_expires_at_ms,
           b.price_piasters,b.payment_received_piasters,b.updated_at_ms
    FROM bookings b JOIN venues v ON v.id = b.venue_id JOIN pitches p ON p.id = b.pitch_id
    WHERE b.booking_code_hash = ? AND b.customer_phone_lookup_hash = ? ${venueClause}
    LIMIT 1
  `);
  return (venueId
    ? statement.bind(codeHash, phoneLookupHash, venueId)
    : statement.bind(codeHash, phoneLookupHash))
    .first<CustomerBookingRow>();
}

export async function calculateCustomerDigests(env: AppEnv, phoneInput: string, codeHashFunction: (code: string) => Promise<string>, code: string) {
  const normalizedPhone = normalizeEgyptianPhone(phoneInput);
  if (!env.BOOKING_HASH_SECRET) throw new Error("BOOKING_HASH_SECRET is missing.");
  const [phoneLookupHash, bookingCodeHash] = await Promise.all([
    hmacSha256Hex(env.BOOKING_HASH_SECRET, `phone:${normalizedPhone}`),
    codeHashFunction(code),
  ]);
  return { normalizedPhone, phoneLookupHash, bookingCodeHash };
}
