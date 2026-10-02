import test from "node:test";
import assert from "node:assert/strict";
import {
  reserveBookingAtomically,
  rescheduleBookingAtomicallyCas,
} from "../../.test-dist/server/booking/slot-locks.js";

function createFakeDatabase({ changes } = {}) {
  const batches = [];
  const statements = [];
  return {
    batches,
    statements,
    prepare(sql) {
      const statement = { sql, values: [], bind(...values) { this.values = values; return this; } };
      statements.push(statement);
      return statement;
    },
    async batch(batch) {
      batches.push(batch);
      return batch.map((_, index) => ({ meta: { changes: changes?.[index] ?? 1 } }));
    },
  };
}

const reservation = {
  bookingId: "booking-1",
  pitchId: "pitch-1",
  businessDate: "2026-10-01",
  durationMinutes: 90,
  bucketIndices: [4, 5, 6],
  createdAtMs: 1_800_000_000_000,
};

test("creates the booking and every half-hour lock in one ordered D1 batch", async () => {
  const db = createFakeDatabase();
  const bookingInsert = db.prepare("INSERT INTO bookings").bind("booking-1");
  await reserveBookingAtomically(db, bookingInsert, reservation);

  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 4);
  assert.equal(db.batches[0][0], bookingInsert);
  assert.deepEqual(db.batches[0].slice(1).map((statement) => statement.values), [
    ["pitch-1", "2026-10-01", 4, "booking-1", 1_800_000_000_000],
    ["pitch-1", "2026-10-01", 5, "booking-1", 1_800_000_000_000],
    ["pitch-1", "2026-10-01", 6, "booking-1", 1_800_000_000_000],
  ]);
});

test("compare-and-swap rescheduling releases old locks and acquires new locks in one batch", async () => {
  const db = createFakeDatabase();
  const bookingUpdate = db.prepare("UPDATE bookings").bind("booking-1");
  const target = { ...reservation, businessDate: "2026-10-08", bucketIndices: [8, 9, 10] };
  const result = await rescheduleBookingAtomicallyCas(db, {
    bookingId: "booking-1", venueId: "venue-1", expectedUpdatedAtMs: 1_799_999_000_000,
    oldPitchId: "pitch-1", oldBusinessDate: "2026-10-01", oldStartMinute: 120,
    targetStartMinute: 240, bookingUpdate, target,
  });

  const batch = db.batches[0];
  assert.equal(result.updated, true);
  assert.equal(db.batches.length, 1);
  assert.equal(batch.length, 6);
  assert.match(batch[0].sql, /DELETE FROM slot_locks/);
  assert.deepEqual(batch[0].values, ["booking-1", "pitch-1", "2026-10-01", "booking-1", "venue-1", 1_799_999_000_000, "pitch-1", "2026-10-01", 120]);
  assert.equal(batch[1], bookingUpdate);
  assert.match(batch[2].sql, /INSERT INTO slot_locks[\s\S]*WHERE NOT EXISTS/);
  assert.equal(batch[2].values[2], "booking-1");
  assert.deepEqual(batch.slice(3).map((statement) => statement.values.slice(0, 5)), [
    ["pitch-1", "2026-10-08", 8, "booking-1", 1_800_000_000_000],
    ["pitch-1", "2026-10-08", 9, "booking-1", 1_800_000_000_000],
    ["pitch-1", "2026-10-08", 10, "booking-1", 1_800_000_000_000],
  ]);
});

test("reports a stale version without claiming that the reschedule was saved", async () => {
  const db = createFakeDatabase({ changes: [1, 0, 0, 0, 0, 0] });
  const target = { ...reservation, businessDate: "2026-10-08", bucketIndices: [8, 9, 10] };
  const result = await rescheduleBookingAtomicallyCas(db, {
    bookingId: "booking-1", venueId: "venue-1", expectedUpdatedAtMs: 50,
    oldPitchId: "pitch-1", oldBusinessDate: "2026-10-01", oldStartMinute: 120,
    targetStartMinute: 240, bookingUpdate: db.prepare("UPDATE bookings"), target,
  });
  assert.equal(result.updated, false);
  assert.equal(db.batches.length, 1);
});

test("rejects malformed lock ranges and mismatched booking identity before writing", async () => {
  const db = createFakeDatabase();
  const insert = db.prepare("INSERT INTO bookings");
  await assert.rejects(reserveBookingAtomically(db, insert, { ...reservation, bucketIndices: [4, 6, 7] }), /contiguous/);
  await assert.rejects(rescheduleBookingAtomicallyCas(db, {
    bookingId: "another-booking", venueId: "venue-1", expectedUpdatedAtMs: 1,
    oldPitchId: "pitch-1", oldBusinessDate: "2026-10-01", oldStartMinute: 120,
    targetStartMinute: 240, bookingUpdate: insert, target: reservation,
  }), /preserve its booking/);
  assert.equal(db.batches.length, 0);
});
