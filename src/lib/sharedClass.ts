// Combined / shared classes.
//
// Some programmes intentionally attend ONE physical class together (e.g. BBAIB
// "Taxation" and BBAIM "Introduction to Taxation" taught as a single combined
// class). Such rows share the same term, day, time, ROOM and LECTURER but list
// different programmes/cohorts/units. They must NOT be reported as room or
// lecturer double-bookings, and they must be counted as ONE class for workload
// and per-day limits.
//
// This is logically safe to auto-detect: a single lecturer physically cannot
// teach two *different* classes in the same room at the same time, so identical
// (term, day, time, room, lecturer) rows are, by definition, the same class.
import { DayCode, Session } from "./types";
import { formatTimeRange } from "./clean";

/**
 * Identity of the physical class a session belongs to. Two sessions with the
 * same non-null key are the SAME combined class. Returns null when the session
 * lacks a concrete room/lecturer/time (so it can't be part of a shared class).
 */
export function sharedClassKey(s: Session): string | null {
  if (s.term === null || s.day === null || s.startMin === null || s.endMin === null) return null;
  if (s.lecturer === null) return null;
  if (s.room === null || s.isVirtualRoom) return null;
  return `${s.term}||${s.day}||${s.startMin}||${s.endMin}||${s.room}||${s.lecturer}`;
}

/**
 * True when two cohorts are demonstrably different, so the sessions could be
 * distinct programmes intentionally taught together. Same (non-null) batchCode
 * means the SAME students — that is a genuine double-booking, never a combined
 * class. When cohorts can't be told apart (blank codes) we conservatively treat
 * them as NOT combined so real clashes are never hidden.
 */
function differentCohort(a: Session, b: Session): boolean {
  return a.batchCode !== null && b.batchCode !== null && a.batchCode !== b.batchCode;
}

/** True when a and b are two rows of the same combined class. */
export function sameSharedClass(a: Session, b: Session): boolean {
  const ka = sharedClassKey(a);
  return ka !== null && ka === sharedClassKey(b) && differentCohort(a, b);
}

/**
 * True when a placement (lecturer/room/exact-slot) would form the same combined
 * class as an existing session — used to suppress self-conflicts while validating.
 * Requires a different cohort so two units for the SAME students still clash.
 */
export function isCombinedPlacement(
  s: Session,
  p: {
    lecturer: string | null;
    room: string | null;
    isVirtualRoom: boolean;
    startMin: number | null;
    endMin: number | null;
    batchCode: string | null;
  },
): boolean {
  return (
    p.lecturer !== null &&
    p.room !== null &&
    p.batchCode !== null &&
    s.batchCode !== null &&
    s.batchCode !== p.batchCode &&
    !p.isVirtualRoom &&
    !s.isVirtualRoom &&
    s.lecturer === p.lecturer &&
    s.room === p.room &&
    s.startMin === p.startMin &&
    s.endMin === p.endMin
  );
}

export interface SharedClassGroup {
  key: string;
  term: string | null;
  day: DayCode | null;
  time: string;
  room: string | null;
  lecturer: string | null;
  rowIds: number[];
  programmes: string[];
  unitCodes: string[];
  headCount: number; // combined enrolment across the cohorts
}

/** All combined classes present (groups with 2+ member rows for DISTINCT cohorts). */
export function detectSharedClasses(sessions: Session[]): SharedClassGroup[] {
  const byKey = new Map<string, Session[]>();
  for (const s of sessions) {
    const k = sharedClassKey(s);
    if (!k) continue;
    const arr = byKey.get(k) ?? [];
    arr.push(s);
    byKey.set(k, arr);
  }
  const groups: SharedClassGroup[] = [];
  for (const [key, rows] of byKey) {
    // A true combined class serves 2+ different cohorts sharing one room/lecturer.
    const cohorts = new Set(rows.map((r) => r.batchCode).filter((x): x is string => !!x));
    if (cohorts.size < 2) continue;
    const f = rows[0];
    groups.push({
      key,
      term: f.term,
      day: f.day,
      time: formatTimeRange(f.startMin, f.endMin),
      room: f.room,
      lecturer: f.lecturer,
      rowIds: rows.map((r) => r.rowId),
      programmes: [...new Set(rows.map((r) => r.programme).filter((x): x is string => !!x))],
      unitCodes: [...new Set(rows.map((r) => r.unitCode).filter((x): x is string => !!x))],
      headCount: rows.reduce((a, r) => a + (r.headCount ?? 0), 0),
    });
  }
  return groups;
}

/** Set of rowIds that belong to a combined class (2+ distinct cohorts). */
export function combinedRowIds(sessions: Session[]): Set<number> {
  const out = new Set<number>();
  for (const g of detectSharedClasses(sessions)) for (const id of g.rowIds) out.add(id);
  return out;
}

/**
 * Collapse combined classes to a single representative row (the first member),
 * keeping every non-combined session as-is. Used when counting workload hours or
 * sessions-per-day so a shared class is counted once, not once per programme.
 */
export function dedupeSharedClasses(sessions: Session[]): Session[] {
  const combinedKeys = new Set(detectSharedClasses(sessions).map((g) => g.key));
  const seen = new Set<string>();
  const out: Session[] = [];
  for (const s of sessions) {
    const k = sharedClassKey(s);
    if (k && combinedKeys.has(k)) {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(s);
  }
  return out;
}
