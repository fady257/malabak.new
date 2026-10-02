import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessDaySlots } from "../../.test-dist/shared/domain/schedule.js";

test("supports owner-selected opening and closing hours while retaining 30-minute locks", () => {
  const slots = createBusinessDaySlots("2026-10-02", 60, "Africa/Cairo", 9 * 60, 22 * 60);
  assert.equal(slots[0]?.startMinute, 540);
  assert.equal(slots.at(-1)?.startMinute, 1260);
  assert.equal(slots.every((slot) => slot.bucketIndices.length === 2), true);
});

test("supports a custom overnight business window and rejects unsafe overlong hours", () => {
  const slots = createBusinessDaySlots("2026-10-02", 90, "Africa/Cairo", 18 * 60, 27 * 60);
  assert.equal(slots[0]?.startMinute, 1080);
  assert.equal(slots.at(-1)?.startMinute, 1530);
  assert.throws(() => createBusinessDaySlots("2026-10-02", 60, "Africa/Cairo", 0, 14 * 60), /at most 13 hours/i);
});
