import test from "node:test";
import assert from "node:assert/strict";
import {
  createBusinessDaySlots,
  deriveSlotAvailability,
  possibleUtcInstants,
  resolveLocalMinuteToUtc,
} from "../../.test-dist/shared/domain/schedule.js";
import { expirePendingBookings } from "../../.test-dist/server/booking/expiry.js";

test("creates exactly twelve 60-minute slots and eight 90-minute slots on a normal business day", () => {
  const sixty = createBusinessDaySlots("2026-10-01", 60);
  const ninety = createBusinessDaySlots("2026-10-01", 90);
  assert.equal(sixty.length, 12);
  assert.equal(ninety.length, 8);
  assert.deepEqual([sixty[0].startLabel, sixty[0].endLabel], ["14:00", "15:00"]);
  assert.deepEqual([ninety.at(-1).startLabel, ninety.at(-1).endLabel], ["00:30", "02:00"]);
  assert.ok(sixty.every((slot) => slot.businessDate === "2026-10-01"));
});

test("keeps after-midnight slots on the opening business date and stores UTC instants", () => {
  const last = createBusinessDaySlots("2026-10-01", 60).at(-1);
  assert.ok(last);
  assert.equal(last.businessDate, "2026-10-01");
  assert.equal(last.startMinute, 1500);
  assert.equal(last.startLabel, "01:00");
  assert.equal(last.endLabel, "02:00");
  assert.equal(last.endAtUtcMs - last.startAtUtcMs, 60 * 60_000);
});

test("assigns unique sequential 30-minute lock buckets to each slot", () => {
  const slots = createBusinessDaySlots("2026-10-01", 90);
  assert.deepEqual(slots[0].bucketIndices, [0, 1, 2]);
  assert.deepEqual(slots[1].bucketIndices, [3, 4, 5]);
  const all = slots.flatMap((slot) => slot.bucketIndices);
  assert.equal(new Set(all).size, all.length);
});

test("skips a Cairo wall-clock start that does not exist during the spring-forward gap", () => {
  assert.deepEqual(possibleUtcInstants("2026-04-24", 30), []);
  const slots = createBusinessDaySlots("2026-04-23", 60);
  assert.ok(!slots.some((slot) => slot.startMinute === 1440));
  assert.ok(slots.some((slot) => slot.startMinute === 1500 && slot.startLabel === "01:00"));
  assert.ok(slots.every((slot) => slot.businessDate === "2026-04-23"));
});

test("chooses the earlier instant for an ambiguous Cairo wall time during fall-back", () => {
  const candidates = possibleUtcInstants("2026-10-29", 23 * 60 + 30);
  assert.equal(candidates.length, 2);
  assert.ok(candidates[0] < candidates[1]);
  assert.equal(resolveLocalMinuteToUtc("2026-10-29", 23 * 60 + 30), candidates[0]);
});

test("uses actual elapsed time for lock buckets around fall-back and avoids overlapping slots", () => {
  const slots = createBusinessDaySlots("2026-10-29", 60);
  for (let index = 1; index < slots.length; index += 1) {
    assert.ok(slots[index].startAtUtcMs >= slots[index - 1].endAtUtcMs);
  }
  for (const slot of slots) {
    assert.equal(slot.bucketIndices.length, 2);
    assert.ok(slot.bucketIndices.every((bucket) => bucket >= 0 && bucket <= 25));
  }
});

test("rejects invalid business dates and unsupported slot lengths", () => {
  assert.throws(() => createBusinessDaySlots("2026-02-30", 60), /real calendar date/);
  assert.throws(() => createBusinessDaySlots("2026-10-01", 75), /60 or 90/);
});

test("expired pending holds read as available, live holds as pending, confirmed reservations as booked", () => {
  const now = 1_800_000_000_000;
  assert.equal(
    deriveSlotAvailability([{ status: "pending", holdExpiresAtMs: now }], now),
    "available",
  );
  assert.equal(
    deriveSlotAvailability([{ status: "pending", holdExpiresAtMs: now + 1 }], now),
    "pending",
  );
  assert.equal(
    deriveSlotAvailability(
      [
        { status: "pending", holdExpiresAtMs: now - 1 },
        { status: "confirmed", holdExpiresAtMs: null },
      ],
      now,
    ),
    "booked",
  );
});

test("expires holds and releases locks in one D1 batch, scoped to a business day when requested", async () => {
  const prepared = [];
  const database = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      assert.equal(statements.length, 2);
      assert.equal(statements[0], prepared[0]);
      assert.equal(statements[1], prepared[1]);
      return [{ meta: { changes: 3 } }, { meta: { changes: 2 } }];
    },
  };

  const result = await expirePendingBookings(database, 1_800_000_000_000, "2026-10-01");
  assert.deepEqual(result, { releasedLocks: 3, expiredBookings: 2 });
  assert.match(prepared[0].sql, /DELETE FROM slot_locks/);
  assert.match(prepared[1].sql, /UPDATE bookings/);
  assert.match(prepared[0].sql, /status = 'pending'/);
  assert.deepEqual(prepared[0].values, [1_800_000_000_000, "2026-10-01", "2026-10-01"]);
  assert.deepEqual(prepared[1].values, [1_800_000_000_000, 1_800_000_000_000, "2026-10-01", "2026-10-01"]);
});
