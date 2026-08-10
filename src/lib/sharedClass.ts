// Combined / shared classes.
//
// Some programmes intentionally attend ONE physical class together — either the
// same lecturer teaching several cohorts (e.g. BBAIB "Taxation" and BBAIM
// "Introduction to Taxation"), or the same SUBJECT taught to several cohorts in
// one room even when the sheet lists it under slightly different names or a
// co-lecturer (e.g. "Financial Accounting" and "Fundamentals of Financial
// Accounting"). These must NOT be reported as room or lecturer double-bookings,
// and must be counted as ONE class for workload and per-day limits.
//
// A combined class is always anchored on a shared ROOM at the same exact slot,
// which is what makes auto-detection safe: a room physically holds one class at
// a time, so two co-scheduled rows in the same room are the same class when they
// share the lecturer (one session) OR the subject family (equivalent units).
// Two rows in DIFFERENT rooms are never merged — a person/room can't be in two
// places — so genuine double-bookings are always preserved.
import { DayCode, Session } from "./types";
import { formatTimeRange } from "./clean";
import { sameSubjectFamily, similarSubject, subjectFamilyKey } from "./subjectGroup";

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

/**
 * True when two rows describe the same or a closely-related course unit: the
 * same unit code, the same subject family, or near-identical titles (e.g.
 * "Research Methods" vs "Business Research Methods"). Only ever consulted once
 * room, lecturer and the exact time slot already match.
 */
export function sameOrRelatedUnit(
  a: { unitCode: string | null; unitName: string | null },
  b: { unitCode: string | null; unitName: string | null },
): boolean {
  if (a.unitCode !== null && a.unitCode === b.unitCode) return true;
  return similarSubject(a.unitName, b.unitName);
}

/**
 * True when a and b are two rows of the same combined class: same term and exact
 * slot, sharing one physical room, and either
 *  - the same lecturer teaching the same or a closely-related unit (one physical
 *    session the sheet happens to list twice under different titles), or
 *  - DIFFERENT cohorts sharing that room with the same lecturer or an equivalent
 *    subject (several programmes intentionally taught together).
 */
export function isCombinedPair(a: Session, b: Session): boolean {
  if (a.term !== b.term) return false;
  if (a.day === null || a.day !== b.day) return false;
  if (a.startMin === null || a.endMin === null) return false;
  if (a.startMin !== b.startMin || a.endMin !== b.endMin) return false;
  // A combined class shares one physical room at that slot.
  const sameRoom =
    a.room !== null && !a.isVirtualRoom && !b.isVirtualRoom && a.room === b.room;
  if (!sameRoom) return false;

  const sameLecturer = a.lecturer !== null && a.lecturer === b.lecturer;
  // One lecturer, one room, one slot, one (or a near-identical) unit — the same
  // physical teaching session however the cohorts happen to be labelled.
  if (sameLecturer && sameOrRelatedUnit(a, b)) return true;

  if (!differentCohort(a, b)) return false;
  // Same lecturer → literally one session; otherwise require an equivalent subject.
  if (sameLecturer) return true;
  return sameSubjectFamily(a.unitName, b.unitName);
}

/** Backwards-compatible alias. */
export const sameSharedClass = isCombinedPair;

/**
 * True when a placement (room/lecturer/subject at an exact slot) would form the
 * same combined class as an existing session — used to suppress self-conflicts
 * while validating. Requires a different cohort and a shared physical room so
 * two units for the SAME students, or a lecturer/room double-booking across
 * different rooms, still clash.
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
    unitCode?: string | null;
    unitName: string | null;
  },
): boolean {
  if (p.startMin === null || p.endMin === null) return false;
  if (s.startMin !== p.startMin || s.endMin !== p.endMin) return false;
  const sameRoom =
    p.room !== null && !p.isVirtualRoom && !s.isVirtualRoom && s.room === p.room;
  if (!sameRoom) return false;
  const sameLecturer = p.lecturer !== null && s.lecturer === p.lecturer;
  if (sameLecturer && sameOrRelatedUnit(s, { unitCode: p.unitCode ?? null, unitName: p.unitName }))
    return true;
  if (p.batchCode === null || s.batchCode === null || s.batchCode === p.batchCode) return false;
  if (sameLecturer) return true;
  return sameSubjectFamily(s.unitName, p.unitName);
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
  unitNames: string[];
  headCount: number; // combined enrolment across the cohorts
}

/** All combined classes present (groups of 2+ rows that are one physical class). */
export function detectSharedClasses(sessions: Session[]): SharedClassGroup[] {
  // Only rows sharing a term, day and exact slot can be the same physical class.
  const bySlot = new Map<string, Session[]>();
  for (const s of sessions) {
    if (s.term === null || s.day === null || s.startMin === null || s.endMin === null) continue;
    const k = `${s.term}||${s.day}||${s.startMin}||${s.endMin}`;
    const arr = bySlot.get(k);
    if (arr) arr.push(s);
    else bySlot.set(k, [s]);
  }

  const groups: SharedClassGroup[] = [];
  for (const rows of bySlot.values()) {
    if (rows.length < 2) continue;
    // Union rows that form a combined pair (transitively, so 3+ cohorts merge).
    const parent = rows.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (isCombinedPair(rows[i], rows[j])) parent[find(i)] = find(j);
      }
    }
    const comps = new Map<number, Session[]>();
    rows.forEach((s, i) => {
      const r = find(i);
      const arr = comps.get(r);
      if (arr) arr.push(s);
      else comps.set(r, [s]);
    });
    for (const members of comps.values()) {
      if (members.length < 2) continue;
      const f = members[0];
      const cohorts = new Set(members.map((r) => r.batchCode).filter((x): x is string => !!x));
      groups.push({
        key: `${f.term}||${f.day}||${f.startMin}||${f.endMin}||${f.room ?? ""}||${
          subjectFamilyKey(f.unitName) ?? f.lecturer ?? f.rowId
        }`,
        term: f.term,
        day: f.day,
        time: formatTimeRange(f.startMin, f.endMin),
        room: f.room,
        lecturer: f.lecturer,
        rowIds: members.map((r) => r.rowId),
        programmes: [...new Set(members.map((r) => r.programme).filter((x): x is string => !!x))],
        unitCodes: [...new Set(members.map((r) => r.unitCode).filter((x): x is string => !!x))],
        unitNames: [...new Set(members.map((r) => r.unitName).filter((x): x is string => !!x))],
        // Distinct cohorts add up; repeated rows for one cohort do not.
        headCount: cohorts.size >= 2
          ? members.reduce((a, r) => a + (r.headCount ?? 0), 0)
          : Math.max(...members.map((r) => r.headCount ?? 0)),
      });
    }
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
  const drop = new Set<number>();
  for (const g of detectSharedClasses(sessions)) {
    for (const id of g.rowIds.slice(1)) drop.add(id);
  }
  return sessions.filter((s) => !drop.has(s.rowId));
}
