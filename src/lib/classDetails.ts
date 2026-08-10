// What a timetable entry actually represents, ready for display.
//
// A single row in the sheet is one *listing*, not necessarily one class: several
// programmes routinely attend the same physical lecture, and duplicate rows may
// already have been merged into one session. `classDetails` resolves a session
// into the complete picture — course, lecturer, room, slot, and EVERY programme
// and cohort attending — so the timetable can show it at a glance without the
// user opening another page.
import { DayCode, Session } from "./types";
import { formatTimeRange } from "./clean";
import { detectSharedClasses } from "./sharedClass";
import { departmentFor } from "./departments";
import { DepartmentRegistry } from "./types";

export interface Attendee {
  programme: string | null;
  cohort: string | null;
  unitCode: string | null;
  unitName: string | null;
  headCount: number | null;
}

export interface ClassDetails {
  rowId: number;
  unitCode: string | null;
  unitName: string | null;
  /** Every unit code this class is listed under (merged/co-taught variants). */
  unitCodes: string[];
  unitNames: string[];
  lecturer: string | null;
  room: string | null;
  isVirtualRoom: boolean;
  term: string | null;
  day: DayCode | null;
  time: string;
  startMin: number | null;
  endMin: number | null;
  /** Programmes attending, de-duplicated and sorted. */
  programmes: string[];
  /** Cohorts / batch codes attending, de-duplicated and sorted. */
  cohorts: string[];
  /** Faculties/departments the attending programmes belong to. */
  departments: string[];
  attendees: Attendee[];
  headCount: number;
  /** True when more than one programme or cohort attends this class. */
  shared: boolean;
  notes: string | null;
}

const uniqSorted = (xs: (string | null | undefined)[]): string[] =>
  [...new Set(xs.filter((x): x is string => !!x))].sort();

/**
 * Index every session to the full set of rows that make up its physical class:
 * itself, any rows merged into it, and any co-scheduled rows detected as one
 * combined class. Built once per session list and reused for every entry.
 */
export function buildClassIndex(sessions: Session[]): Map<number, Session[]> {
  const byId = new Map(sessions.map((s) => [s.rowId, s]));
  const index = new Map<number, Session[]>();
  for (const s of sessions) index.set(s.rowId, [s]);

  for (const g of detectSharedClasses(sessions)) {
    const members = g.rowIds.map((id) => byId.get(id)).filter((x): x is Session => !!x);
    for (const m of members) index.set(m.rowId, members);
  }
  return index;
}

/** Resolve one session into everything the UI needs to describe its class. */
export function classDetails(
  session: Session,
  sessions: Session[],
  departmentRegistry?: DepartmentRegistry,
  index?: Map<number, Session[]>,
): ClassDetails {
  const members = index?.get(session.rowId) ?? [session];

  // Every programme/cohort attending: the co-scheduled rows plus anything that
  // was merged into any of them.
  const attendees: Attendee[] = [];
  const seen = new Set<string>();
  const push = (a: Attendee) => {
    const k = `${a.programme ?? ""}||${a.cohort ?? ""}||${a.unitCode ?? ""}`;
    if (seen.has(k)) return;
    seen.add(k);
    attendees.push(a);
  };

  for (const m of members) {
    push({
      programme: m.programme,
      cohort: m.batchCode,
      unitCode: m.unitCode,
      unitName: m.unitName,
      headCount: m.headCount,
    });
    const merged = m.merged;
    if (!merged) continue;
    const n = Math.max(
      merged.programmes.length,
      merged.batchCodes.length,
      merged.unitCodes.length,
    );
    for (let i = 0; i < n; i++) {
      push({
        programme: merged.programmes[i] ?? null,
        cohort: merged.batchCodes[i] ?? null,
        unitCode: merged.unitCodes[i] ?? null,
        unitName: merged.unitNames[i] ?? null,
        headCount: null,
      });
    }
  }

  const programmes = uniqSorted(attendees.map((a) => a.programme));
  const cohorts = uniqSorted(attendees.map((a) => a.cohort));
  const departments = uniqSorted(
    programmes.map((p) => departmentFor(p, departmentRegistry)),
  );

  // Enrolment: distinct cohorts add up; the same cohort listed twice does not.
  const byCohort = new Map<string, number>();
  let unlabelled = 0;
  for (const m of members) {
    const hc = m.headCount ?? 0;
    if (m.batchCode === null) unlabelled = Math.max(unlabelled, hc);
    else byCohort.set(m.batchCode, Math.max(byCohort.get(m.batchCode) ?? 0, hc));
  }

  return {
    rowId: session.rowId,
    unitCode: session.unitCode,
    unitName: session.unitName,
    unitCodes: uniqSorted(attendees.map((a) => a.unitCode)),
    unitNames: uniqSorted(attendees.map((a) => a.unitName)),
    lecturer: session.lecturer,
    room: session.room,
    isVirtualRoom: session.isVirtualRoom,
    term: session.term,
    day: session.day,
    time: formatTimeRange(session.startMin, session.endMin) || (session.timeRaw ?? ""),
    startMin: session.startMin,
    endMin: session.endMin,
    programmes,
    cohorts,
    departments,
    attendees,
    headCount: [...byCohort.values()].reduce((a, b) => a + b, 0) + unlabelled,
    shared: programmes.length > 1 || cohorts.length > 1,
    notes: session.notes,
  };
}

/** "BSCCS, BBAIB +2" — a compact programme list for a tight grid cell. */
export function summarise(list: string[], max = 2): string {
  if (list.length === 0) return "—";
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} +${list.length - max}`;
}

/** Every distinct cohort present, for the cohort timetable picker. */
export function distinctCohorts(sessions: Session[]): string[] {
  return uniqSorted(sessions.map((s) => s.batchCode));
}

/**
 * Sessions a cohort attends. A cohort is on a session when the row is listed
 * under it, or when its own duplicate row was merged into that session — so a
 * cohort timetable never loses a lecture to a merge.
 */
export function sessionsForCohort(sessions: Session[], cohort: string): Session[] {
  return sessions.filter(
    (s) => s.batchCode === cohort || (s.merged?.batchCodes.includes(cohort) ?? false),
  );
}
