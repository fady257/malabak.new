import type { D1BatchLike } from "../db/d1.js";

const DELETE_EXPIRED_LOCKS_SQL = `
  DELETE FROM slot_locks
  WHERE booking_id IN (
    SELECT id
    FROM bookings
    WHERE status = 'pending'
      AND hold_expires_at_ms IS NOT NULL
      AND hold_expires_at_ms <= ?
      AND (? IS NULL OR business_date = ?)
  )
`;

const MARK_EXPIRED_BOOKINGS_SQL = `
  UPDATE bookings
  SET status = 'expired', updated_at_ms = ?
  WHERE status = 'pending'
    AND hold_expires_at_ms IS NOT NULL
    AND hold_expires_at_ms <= ?
    AND (? IS NULL OR business_date = ?)
`;

export interface ExpiryResult {
  releasedLocks: number;
  expiredBookings: number;
}

/**
 * Frees expired holds and marks their booking records in one D1 transaction.
 * Confirmation code must conditionally update status and preserve locks in its
 * own batch, so either confirmation or expiry wins wholly, never half-way.
 */
export async function expirePendingBookings(
  db: D1BatchLike,
  nowMs: number,
  businessDate?: string,
): Promise<ExpiryResult> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError("Expiry time must be a non-negative UTC millisecond timestamp.");
  }
  if (businessDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new RangeError("Business date must use YYYY-MM-DD.");
  }

  const dateFilter = businessDate ?? null;
  const results = await db.batch([
    db.prepare(DELETE_EXPIRED_LOCKS_SQL).bind(nowMs, dateFilter, dateFilter),
    db
      .prepare(MARK_EXPIRED_BOOKINGS_SQL)
      .bind(nowMs, nowMs, dateFilter, dateFilter),
  ]);

  return {
    releasedLocks: results[0]?.meta?.changes ?? 0,
    expiredBookings: results[1]?.meta?.changes ?? 0,
  };
}
