// The institution's official teaching slots.
//
// Teaching happens in fixed two-hour periods, with an hour kept free over lunch:
//
//   Mon–Fri   9:00–11:00   11:00–1:00   [lunch]   2:00–4:00   4:00–6:00
//   Saturday  9:00–11:00   11:00–1:00   [lunch]   2:00–4:00
//
// Nothing may be scheduled outside these. Real sheets are messy — the same
// period appears as "9:00AM - 10:55AM", "11:05AM - 1:00PM" or "2:00PM-3:55PM" —
// so `snapToOfficialSlot` folds those variants onto the period they clearly mean,
// while genuinely unofficial times (a lunch-hour class, a 5:45 PM start) are left
// alone and reported so a human can decide what to do with them.
import { DayCode } from "./types";
import { minutesToLabel } from "./clean";

export interface Slot {
  startMin: number;
  endMin: number;
}

const at = (hour: number, minute = 0) => hour * 60 + minute;

/** Monday–Friday: four periods, 9:00 AM to 6:00 PM with an hour for lunch. */
export const WEEKDAY_SLOTS: Slot[] = [
  { startMin: at(9), endMin: at(11) },
  { startMin: at(11), endMin: at(13) },
  { startMin: at(14), endMin: at(16) },
  { startMin: at(16), endMin: at(18) },
];

/** Saturday: three periods, finishing at 4:00 PM. */
export const SATURDAY_SLOTS: Slot[] = [
  { startMin: at(9), endMin: at(11) },
  { startMin: at(11), endMin: at(13) },
  { startMin: at(14), endMin: at(16) },
];

/** The periods available on a given day. */
export function slotsForDay(day: DayCode | null): Slot[] {
  if (day === null) return [];
  if (day === "SUN") return [];
  return day === "SAT" ? SATURDAY_SLOTS : WEEKDAY_SLOTS;
}

/** Teaching-day bounds for a day, used for the Saturday cut-off and messages. */
export function teachingWindow(day: DayCode | null): Slot | null {
  const slots = slotsForDay(day);
  if (slots.length === 0) return null;
  return { startMin: slots[0].startMin, endMin: slots[slots.length - 1].endMin };
}

/** How many classes a day can physically hold (4 on weekdays, 3 on Saturday). */
export function slotCountForDay(day: DayCode | null): number {
  return slotsForDay(day).length;
}

export function isOfficialSlot(day: DayCode | null, startMin: number | null, endMin: number | null): boolean {
  if (startMin === null || endMin === null) return false;
  return slotsForDay(day).some((s) => s.startMin === startMin && s.endMin === endMin);
}

/**
 * How far a time may drift from an official start and still be considered that
 * period. Covers the usual sheet variants (a five-minute changeover, a class
 * written as one hour instead of two) without swallowing a genuinely different
 * time such as a 1:00 PM lunch-hour class or a 5:45 PM evening start.
 */
export const SNAP_TOLERANCE_MIN = 30;

/**
 * The official period a messy time clearly refers to, or null when it doesn't
 * correspond to one. Matching is on the START of the period, since every
 * official period is two hours long.
 */
export function snapToOfficialSlot(
  day: DayCode | null,
  startMin: number | null,
  endMin: number | null,
): Slot | null {
  const direct = matchSlot(day, startMin, endMin);
  if (direct) return direct;
  return repairAmPm(day, startMin, endMin);
}

/** Nearest official period, if the given range plausibly IS that period. */
function matchSlot(day: DayCode | null, startMin: number | null, endMin: number | null): Slot | null {
  if (startMin === null) return null;
  const slots = slotsForDay(day);
  if (slots.length === 0) return null;

  let best: Slot | null = null;
  let bestDrift = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const drift = Math.abs(slot.startMin - startMin);
    if (drift < bestDrift) {
      bestDrift = drift;
      best = slot;
    }
  }
  if (best === null || bestDrift > SNAP_TOLERANCE_MIN) return null;

  // A range that runs well past the period it starts in (e.g. 9:00 AM–10:55 PM)
  // is a typo, not this period.
  if (endMin !== null && endMin > best.endMin + SNAP_TOLERANCE_MIN) return null;
  return best;
}

const HALF_DAY = 12 * 60;

/**
 * Recover an obvious AM/PM slip.
 *
 * Sheets routinely carry "2:00 AM - 3:55 PM" for the afternoon period, or
 * "11:05 PM - 1:00 PM" for the late-morning one. Such a range is either
 * backwards or absurdly long, which is what makes the repair safe: a legitimate
 * time is never touched. A flipped start or end is accepted only when exactly
 * one of them lands on an official period.
 */
function repairAmPm(day: DayCode | null, startMin: number | null, endMin: number | null): Slot | null {
  if (startMin === null || endMin === null) return null;
  const span = endMin - startMin;
  const clearlyWrong = span <= 0 || span > 6 * 60;
  if (!clearlyWrong) return null;

  const shift = (v: number, by: number) => {
    const out = v + by;
    return out >= 0 && out < 24 * 60 ? out : null;
  };

  const attempts: [number | null, number | null][] = [
    [shift(startMin, HALF_DAY), endMin],
    [shift(startMin, -HALF_DAY), endMin],
    [startMin, shift(endMin, HALF_DAY)],
    [startMin, shift(endMin, -HALF_DAY)],
  ];

  const found: Slot[] = [];
  for (const [s, e] of attempts) {
    if (s === null || e === null || e <= s) continue;
    const slot = matchSlot(day, s, e);
    if (slot && !found.some((f) => f.startMin === slot.startMin)) found.push(slot);
  }
  // Ambiguous repairs are left for a human.
  return found.length === 1 ? found[0] : null;
}

/** "9:00 AM – 11:00 AM" */
export function formatSlot(slot: Slot): string {
  return `${minutesToLabel(slot.startMin)} – ${minutesToLabel(slot.endMin)}`;
}

/** The official timetable written out, for help text and error messages. */
export function describeOfficialSlots(day: DayCode | null): string {
  const slots = slotsForDay(day);
  if (slots.length === 0) return "no teaching";
  return slots.map(formatSlot).join(", ");
}
