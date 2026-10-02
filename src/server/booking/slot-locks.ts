import type { D1BatchLike, D1StatementLike } from "../db/d1.js";
import type { D1Database } from "@cloudflare/workers-types";

export interface SlotLockReservation {
  bookingId: string;
  pitchId: string;
  businessDate: string;
  durationMinutes: 60 | 90;
  bucketIndices: readonly number[];
  createdAtMs: number;
}

const INSERT_SLOT_LOCK_SQL = `
  INSERT INTO slot_locks (pitch_id, business_date, bucket_index, booking_id, created_at_ms)
  VALUES (?, ?, ?, ?, ?)
`;

function validateReservation(reservation: SlotLockReservation): number[] {
  if (!reservation.bookingId || !reservation.pitchId) {
    throw new RangeError("Booking and pitch IDs are required for slot locks.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reservation.businessDate)) {
    throw new RangeError("Business date must use YYYY-MM-DD.");
  }
  if (!Number.isSafeInteger(reservation.createdAtMs) || reservation.createdAtMs < 0) {
    throw new RangeError("Creation time must be a non-negative UTC millisecond timestamp.");
  }
  if (reservation.durationMinutes !== 60 && reservation.durationMinutes !== 90) {
    throw new RangeError("Reservation duration must be 60 or 90 minutes.");
  }

  const requiredBucketCount = reservation.durationMinutes / 30;
  const buckets = [...reservation.bucketIndices];
  if (buckets.length !== requiredBucketCount) throw new RangeError("Slot lock count must match the slot length.");
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    const previous = index > 0 ? buckets[index - 1] : undefined;
    if (
      bucket === undefined || !Number.isInteger(bucket) || bucket < 0 || bucket > 25 ||
      (index > 0 && (previous === undefined || bucket !== previous + 1))
    ) throw new RangeError("Slot locks must be a contiguous 30-minute range.");
  }
  return buckets;
}

function lockStatements(db: D1BatchLike, reservation: SlotLockReservation, buckets: readonly number[]): D1StatementLike[] {
  return buckets.map((bucket) =>
    db.prepare(INSERT_SLOT_LOCK_SQL).bind(
      reservation.pitchId,
      reservation.businessDate,
      bucket,
      reservation.bookingId,
      reservation.createdAtMs,
    ),
  );
}

export function slotLockInsertStatements(db: D1BatchLike, reservation: SlotLockReservation): D1StatementLike[] {
  return lockStatements(db, reservation, validateReservation(reservation));
}

export function slotLockPreparedStatements(db: D1Database, reservation: SlotLockReservation): D1PreparedStatement[] {
  return lockStatements(db, reservation, validateReservation(reservation)) as D1PreparedStatement[];
}

export async function reserveBookingAtomically(
  db: D1BatchLike,
  bookingInsert: D1StatementLike,
  reservation: SlotLockReservation,
  extraStatements: readonly D1StatementLike[] = [],
) {
  const buckets = validateReservation(reservation);
  return db.batch([bookingInsert, ...lockStatements(db, reservation, buckets), ...extraStatements]);
}

/**
 * Compare-and-swap schedule edit. A conflict on any new lock rolls back the
 * update and the deletion of the old locks. A stale version changes nothing.
 */
export async function rescheduleBookingAtomicallyCas(
  db: D1BatchLike,
  input: {
    bookingId: string;
    venueId: string;
    expectedUpdatedAtMs: number;
    oldPitchId: string;
    oldBusinessDate: string;
    oldStartMinute: number;
    targetStartMinute: number;
    bookingUpdate: D1StatementLike;
    target: SlotLockReservation;
    extraStatements?: readonly D1StatementLike[];
  },
): Promise<{ updated: boolean; results: Awaited<ReturnType<D1BatchLike["batch"]>> }> {
  const { target } = input;
  if (!input.bookingId || input.bookingId !== target.bookingId || !input.venueId) {
    throw new RangeError("A reschedule must preserve its booking and venue identity.");
  }
  if (!Number.isSafeInteger(input.expectedUpdatedAtMs) || input.expectedUpdatedAtMs < 0) {
    throw new RangeError("Expected booking version is invalid.");
  }
  const buckets = validateReservation(target);
  const activeVersion = `id = ? AND venue_id = ? AND updated_at_ms = ? AND status IN ('pending','confirmed')`;
  const releaseOldLocks = db.prepare(`
    DELETE FROM slot_locks
    WHERE booking_id = ? AND pitch_id = ? AND business_date = ?
      AND EXISTS (SELECT 1 FROM bookings WHERE ${activeVersion} AND pitch_id = ? AND business_date = ? AND start_minute = ?)
  `).bind(
    input.bookingId,
    input.oldPitchId,
    input.oldBusinessDate,
    input.bookingId,
    input.venueId,
    input.expectedUpdatedAtMs,
    input.oldPitchId,
    input.oldBusinessDate,
    input.oldStartMinute,
  );
  const guardedLocks = buckets.map((bucket) =>
    db.prepare(`
      INSERT INTO slot_locks (pitch_id, business_date, bucket_index, booking_id, created_at_ms)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM bookings
        WHERE id = ? AND venue_id = ? AND updated_at_ms = ?
          AND status IN ('pending','confirmed') AND pitch_id = ?
          AND business_date = ? AND start_minute = ? AND duration_minutes = ?
      )
    `).bind(
      target.pitchId,
      target.businessDate,
      bucket,
      target.bookingId,
      target.createdAtMs,
      input.bookingId,
      input.venueId,
      target.createdAtMs,
      target.pitchId,
      target.businessDate,
      input.targetStartMinute,
      target.durationMinutes,
    ),
  );
  const requireUpdatedVersion = db.prepare(`
    INSERT INTO slot_locks (pitch_id,business_date,bucket_index,booking_id,created_at_ms)
    SELECT ?,?,99,?,? WHERE NOT EXISTS (
      SELECT 1 FROM bookings WHERE id=? AND venue_id=? AND updated_at_ms=?
        AND status IN ('pending','confirmed') AND pitch_id=?
        AND business_date=? AND start_minute=? AND duration_minutes=?
    )
  `).bind(
    target.pitchId, target.businessDate, target.bookingId, target.createdAtMs,
    input.bookingId, input.venueId, target.createdAtMs, target.pitchId,
    target.businessDate, input.targetStartMinute, target.durationMinutes,
  );
  const results = await db.batch([
    releaseOldLocks,
    input.bookingUpdate,
    requireUpdatedVersion,
    ...guardedLocks,
    ...(input.extraStatements ?? []),
  ]);
  return { updated: (results[1]?.meta?.changes ?? 0) > 0, results };
}
