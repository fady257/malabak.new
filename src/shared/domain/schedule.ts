export const BUSINESS_TIME_ZONE = "Africa/Cairo";
export const OPENING_MINUTE = 14 * 60;
export const CLOSING_BUSINESS_MINUTE = 26 * 60;
export const LOCK_BUCKET_MINUTES = 30;

export type SlotLengthMinutes = 60 | 90;
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "rejected"
  | "expired"
  | "completed"
  | "no_show";
export type SlotAvailability = "available" | "pending" | "booked";

export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface OccupancyRecord {
  status: BookingStatus;
  holdExpiresAtMs: number | null;
}

export interface BusinessSlot {
  businessDate: string;
  startMinute: number;
  durationMinutes: SlotLengthMinutes;
  startAtUtcMs: number;
  endAtUtcMs: number;
  startLabel: string;
  endLabel: string;
  bucketIndices: number[];
}

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function partsAt(instantMs: number, timeZone: string): CalendarParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  const hour = Number(values.get("hour"));
  const minute = Number(values.get("minute"));
  if (![year, month, day, hour, minute].every(Number.isInteger)) {
    throw new RangeError(`Could not read calendar fields for ${timeZone}`);
  }
  return { year, month, day, hour, minute };
}

function validateDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("Business date must use YYYY-MM-DD.");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1000 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError("Business date is not a real calendar date.");
  }
  return { year, month, day };
}

function addCalendarDays(date: string, days: number): string {
  const { year, month, day } = validateDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function fieldsAsUtcMs(fields: CalendarParts): number {
  return Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute);
}

function sameMinute(left: CalendarParts, right: CalendarParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

/**
 * Returns every UTC instant matching a local wall-clock minute. A spring-forward
 * gap returns no instant; a fall-back fold returns both instants in UTC order.
 *
 * The search samples offsets around the requested date rather than assuming a
 * fixed Cairo offset. This keeps the conversion tied to the runtime's IANA tzdata.
 */
export function possibleUtcInstants(
  localDate: string,
  minuteOfDay: number,
  timeZone = BUSINESS_TIME_ZONE,
): number[] {
  const { year, month, day } = validateDate(localDate);
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= 1440) {
    throw new RangeError("Minute of day must be an integer from 0 through 1439.");
  }

  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const wanted: CalendarParts = { year, month, day, hour, minute };
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const minuteMs = 60_000;
  const offsets = new Set<number>();

  // Cairo's present-day offsets are within this range. Sampling both sides of
  // a transition captures each legal offset without hard-coding UTC+2/UTC+3.
  for (let deltaHours = -48; deltaHours <= 48; deltaHours += 3) {
    const sampleMs = naiveUtcMs + deltaHours * 60 * minuteMs;
    const sampleMinuteMs = Math.floor(sampleMs / minuteMs) * minuteMs;
    const localAsUtcMs = fieldsAsUtcMs(partsAt(sampleMinuteMs, timeZone));
    offsets.add(localAsUtcMs - sampleMinuteMs);
  }

  const matches: number[] = [];
  for (const offsetMs of offsets) {
    const candidateMs = naiveUtcMs - offsetMs;
    if (sameMinute(partsAt(candidateMs, timeZone), wanted)) matches.push(candidateMs);
  }
  return [...new Set(matches)].sort((left, right) => left - right);
}

/** Uses the earlier real instant when the local wall time repeats at fall-back. */
export function resolveLocalMinuteToUtc(
  localDate: string,
  minuteOfDay: number,
  timeZone = BUSINESS_TIME_ZONE,
): number | null {
  return possibleUtcInstants(localDate, minuteOfDay, timeZone)[0] ?? null;
}

function localDateAndMinuteForBusinessMinute(
  businessDate: string,
  businessMinute: number,
): { date: string; minuteOfDay: number } {
  const dayOffset = Math.floor(businessMinute / 1440);
  return {
    date: addCalendarDays(businessDate, dayOffset),
    minuteOfDay: businessMinute - dayOffset * 1440,
  };
}

function formatClock(instantMs: number, timeZone: string): string {
  const { hour, minute } = partsAt(instantMs, timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function validateSlotLength(slotLengthMinutes: number): asserts slotLengthMinutes is SlotLengthMinutes {
  if (slotLengthMinutes !== 60 && slotLengthMinutes !== 90) {
    throw new RangeError("Slot length must be 60 or 90 minutes.");
  }
}

/**
 * Creates wall-clock start slots for one Cairo business day. The opening date
 * remains businessDate even for slots after midnight. Nonexistent local starts
 * during spring-forward are skipped; repeated labels during fall-back use the
 * earlier instant so a customer never sees two indistinguishable choices.
 */
export function createBusinessDaySlots(
  businessDate: string,
  slotLengthMinutes: number,
  timeZone = BUSINESS_TIME_ZONE,
  openingMinute = OPENING_MINUTE,
  closingBusinessMinute = CLOSING_BUSINESS_MINUTE,
): BusinessSlot[] {
  validateDate(businessDate);
  validateSlotLength(slotLengthMinutes);

  if (
    !Number.isInteger(openingMinute) || openingMinute < 0 || openingMinute >= 1440 ||
    !Number.isInteger(closingBusinessMinute) || closingBusinessMinute <= openingMinute ||
    closingBusinessMinute > 2880 || closingBusinessMinute - openingMinute > 780
  ) {
    throw new RangeError("Business hours must fit a 30-minute schedule of at most 13 hours.");
  }

  const openingLocal = localDateAndMinuteForBusinessMinute(businessDate, openingMinute);
  const openingInstants = possibleUtcInstants(openingLocal.date, openingLocal.minuteOfDay, timeZone);
  const businessStartUtcMs = openingInstants[0];
  if (businessStartUtcMs === undefined) {
    throw new RangeError("The business-day opening time does not exist in this time zone.");
  }

  const slots: BusinessSlot[] = [];
  let previousEndUtcMs = Number.NEGATIVE_INFINITY;

  for (
    let startMinute = openingMinute;
    startMinute + slotLengthMinutes <= closingBusinessMinute;
    startMinute += slotLengthMinutes
  ) {
    const localStart = localDateAndMinuteForBusinessMinute(businessDate, startMinute);
    const matchingInstants = possibleUtcInstants(localStart.date, localStart.minuteOfDay, timeZone);
    const startAtUtcMs = matchingInstants[0];

    // A local start inside a clock-change gap has no UTC instant and is not bookable.
    if (startAtUtcMs === undefined) continue;
    // Keep local wall-clock slots non-overlapping across a fall-back fold.
    if (startAtUtcMs < previousEndUtcMs) continue;

    const endAtUtcMs = startAtUtcMs + slotLengthMinutes * 60_000;
    const elapsedFromOpeningMinutes = (startAtUtcMs - businessStartUtcMs) / 60_000;
    if (
      !Number.isInteger(elapsedFromOpeningMinutes) ||
      elapsedFromOpeningMinutes < 0 ||
      elapsedFromOpeningMinutes % LOCK_BUCKET_MINUTES !== 0
    ) {
      throw new RangeError("Slot start is not aligned to a 30-minute reservation bucket.");
    }

    const firstBucket = elapsedFromOpeningMinutes / LOCK_BUCKET_MINUTES;
    const bucketCount = slotLengthMinutes / LOCK_BUCKET_MINUTES;
    const bucketIndices = Array.from({ length: bucketCount }, (_, offset) => firstBucket + offset);
    if (bucketIndices.some((bucket) => bucket < 0 || bucket > 25)) {
      throw new RangeError("Slot falls outside the supported business-day lock range.");
    }

    slots.push({
      businessDate,
      startMinute,
      durationMinutes: slotLengthMinutes,
      startAtUtcMs,
      endAtUtcMs,
      startLabel: formatClock(startAtUtcMs, timeZone),
      endLabel: formatClock(endAtUtcMs, timeZone),
      bucketIndices,
    });
    previousEndUtcMs = endAtUtcMs;
  }

  return slots;
}

/** Expired pending holds appear available at read time, even before DB cleanup. */
export function deriveSlotAvailability(
  reservations: readonly OccupancyRecord[],
  nowMs: number,
): SlotAvailability {
  if (!Number.isFinite(nowMs)) throw new RangeError("Current time must be finite.");
  if (reservations.some((reservation) => reservation.status === "confirmed")) return "booked";

  const livePending = reservations.some(
    (reservation) =>
      reservation.status === "pending" &&
      reservation.holdExpiresAtMs !== null &&
      reservation.holdExpiresAtMs > nowMs,
  );
  return livePending ? "pending" : "available";
}
