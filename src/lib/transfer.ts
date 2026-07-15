// Lecturer transfer / conflict-resolution engine.
// Given a session (typically one involved in a lecturer clash or overload), rank
// alternative lecturers it could be reassigned to, and apply the reassignment
// immutably. This is the app's headline feature.
import {
  DayCode,
  DAY_ORDER,
  DepartmentRegistry,
  FacultyTypeRegistry,
  RoleMaxHours,
  RoleRegistry,
  Session,
  Thresholds,
  WorkloadStatus,
} from "./types";
import { DEFAULT_ROLE, maxHoursForRole } from "./roles";
import { facultyTypeOf, workloadStatus } from "./facultyType";
import { departmentFor } from "./departments";
import { finalizeSession } from "./ingest";
import { minutesToLabel } from "./clean";
import { Placement, ValidateOptions, placementOf, validatePlacement } from "./validate";

export const UNASSIGN = "\u2014 Unassign (TBA) \u2014";

export interface TransferCandidate {
  lecturer: string;
  role: string;
  facultyType: "FT" | "PT";
  currentHours: number;
  maxHours: number;
  remainingHours: number;
  projectedHours: number;
  projectedStatus: WorkloadStatus;
  available: boolean;
  conflictReason: string | null;
  teachesSameUnit: boolean;
  assignedSubject: boolean;
  sameDepartment: boolean;
  wouldOverload: boolean;
  score: number;
  recommended: boolean;
}

function overlaps(a: Session, b: Session): boolean {
  if (a.term !== b.term || a.day !== b.day) return false;
  if (a.startMin === null || a.endMin === null || b.startMin === null || b.endMin === null) return false;
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** Sum of workload hours for a lecturer within the session's term. */
function lecturerHoursInTerm(sessions: Session[], lecturer: string, term: string | null): number {
  return sessions
    .filter((s) => s.lecturer === lecturer && s.term === term)
    .reduce((acc, s) => acc + (s.workloadHours ?? 0), 0);
}

export interface CandidateOptions {
  roleRegistry: RoleRegistry;
  roleMaxHours: RoleMaxHours;
  departmentRegistry: DepartmentRegistry;
  facultyTypeRegistry?: FacultyTypeRegistry;
  roomRegistry?: Record<string, number>;
  thresholds: Thresholds;
  subjectAssignments?: Record<string, string[]>;
  includeUnavailable?: boolean;
}

/** Build ValidateOptions from CandidateOptions (all the rule inputs). */
function toValidateOpts(opts: CandidateOptions): ValidateOptions {
  return {
    roleRegistry: opts.roleRegistry,
    roleMaxHours: opts.roleMaxHours,
    facultyTypeRegistry: opts.facultyTypeRegistry,
    roomRegistry: opts.roomRegistry,
    thresholds: opts.thresholds,
  };
}

/**
 * Rank candidate lecturers for taking over `session`. The current lecturer is
 * excluded. By default only time-available candidates are returned; pass
 * includeUnavailable to also surface conflicting ones (shown but not recommended).
 */
export function transferCandidates(
  session: Session,
  sessions: Session[],
  opts: CandidateOptions,
): TransferCandidate[] {
  const { roleRegistry, roleMaxHours, departmentRegistry, facultyTypeRegistry, subjectAssignments } = opts;
  const sessionHours = session.workloadHours ?? 0;
  const sessionDept = departmentFor(session.programme, departmentRegistry);
  const vopts = toValidateOpts(opts);

  const allLecturers = [
    ...new Set(sessions.map((s) => s.lecturer).filter((l): l is string => !!l)),
  ].filter((l) => l !== session.lecturer);

  const candidates: TransferCandidate[] = allLecturers.map((lecturer) => {
    const role = roleRegistry[lecturer] ?? DEFAULT_ROLE;
    const maxHours = maxHoursForRole(role, roleMaxHours);
    const facultyType = facultyTypeOf(lecturer, facultyTypeRegistry);
    const currentHours = lecturerHoursInTerm(sessions, lecturer, session.term);
    const projectedHours = currentHours + sessionHours;
    const { status: projectedStatus } = workloadStatus(projectedHours, maxHours, facultyType);
    const wouldOverload = facultyType === "FT" && projectedHours > maxHours;

    // Availability: reassign to this lecturer at the SAME slot and validate every
    // rule (double-booking, workload cap, consecutive, max/day, FT Friday block…).
    const placement: Placement = { ...placementOf(session), lecturer };
    const errs = validatePlacement(session.rowId, placement, sessions, vopts).filter(
      (v) => v.severity === "error",
    );
    const available = errs.length === 0;
    const conflictReason = errs[0]?.message ?? null;

    const assignedSubject =
      session.unitCode !== null && (subjectAssignments?.[lecturer]?.includes(session.unitCode) ?? false);
    const teachesSameUnit = sessions.some(
      (s) => s.lecturer === lecturer && s.unitCode !== null && s.unitCode === session.unitCode,
    );
    const sameDepartment =
      sessionDept !== null &&
      sessions.some(
        (s) =>
          s.lecturer === lecturer &&
          departmentFor(s.programme, departmentRegistry) === sessionDept,
      );

    // Composite score (higher is better). Availability dominates; then capability
    // (assigned subject > same unit > same dept); then workload fit.
    let score = 0;
    if (available) score += 1000;
    if (assignedSubject) score += 400;
    else if (teachesSameUnit) score += 300;
    else if (sameDepartment) score += 120;
    if (wouldOverload) score -= 500;
    else if (projectedStatus === "Balanced") score += 60;
    if (facultyType === "FT") score += Math.max(0, maxHours - projectedHours) * 4; // headroom to target

    return {
      lecturer,
      role,
      facultyType,
      currentHours: round(currentHours),
      maxHours,
      remainingHours: round(maxHours - currentHours),
      projectedHours: round(projectedHours),
      projectedStatus,
      available,
      conflictReason,
      teachesSameUnit,
      assignedSubject,
      sameDepartment,
      wouldOverload,
      score: round(score),
      recommended: false,
    };
  });

  const filtered = opts.includeUnavailable ? candidates : candidates.filter((c) => c.available);
  filtered.sort((a, b) => b.score - a.score);
  // Mark the single best available, non-overloading candidate as recommended.
  const best = filtered.find((c) => c.available && !c.wouldOverload);
  if (best) best.recommended = true;
  return filtered;
}

/** Immutably reassign a session's lecturer (UNASSIGN sentinel -> TBA/null). */
export function applyTransfer(
  sessions: Session[],
  rowId: number,
  newLecturer: string,
): Session[] {
  return sessions.map((s) => {
    if (s.rowId !== rowId) return s;
    const lecturerRaw = newLecturer === UNASSIGN ? null : newLecturer;
    return finalizeSession({ ...s, lecturer: lecturerRaw, lecturerRaw });
  });
}

// ---- Room reassignment (for resolving ROOM clashes) --------------------------

export interface RoomCandidate {
  room: string;
  capacity: number | null;
  available: boolean;
  fits: boolean; // capacity vs head count
  conflictReason: string | null;
  score: number;
  recommended: boolean;
}

export function roomCandidates(
  session: Session,
  sessions: Session[],
  roomRegistry: Record<string, number>,
  tolerance: number,
): RoomCandidate[] {
  const rooms = [
    ...new Set([
      ...Object.keys(roomRegistry),
      ...sessions.filter((s) => !s.isVirtualRoom).map((s) => s.room).filter((r): r is string => !!r),
    ]),
  ].filter((r) => r !== session.room);

  const hc = session.headCount;
  const candidates: RoomCandidate[] = rooms.map((room) => {
    const capacity = roomRegistry[room] ?? null;
    const conflicting = sessions.find(
      (s) => s.room === room && !s.isVirtualRoom && s.rowId !== session.rowId && overlaps(s, session),
    );
    const available = !conflicting;
    const fits = hc === null || capacity === null || hc <= capacity + tolerance;
    let score = 0;
    if (available) score += 1000;
    if (fits) score += 200;
    // prefer the tightest room that still fits (less waste)
    if (capacity !== null && hc !== null && capacity >= hc) score += Math.max(0, 100 - (capacity - hc));
    return {
      room,
      capacity,
      available,
      fits,
      conflictReason: conflicting ? `Occupied by ${conflicting.unitCode ?? "a class"} at this time` : null,
      score: round(score),
      recommended: false,
    };
  });
  const filtered = candidates.filter((c) => c.available);
  filtered.sort((a, b) => b.score - a.score);
  const best = filtered.find((c) => c.available && c.fits);
  if (best) best.recommended = true;
  return filtered;
}

export function applyRoomChange(sessions: Session[], rowId: number, newRoom: string): Session[] {
  return sessions.map((s) => (s.rowId === rowId ? finalizeSession({ ...s, room: newRoom }) : s));
}

// ---- Rescheduling (the correct remedy for COHORT clashes, and an alternative
//      for lecturer/room clashes: move the session to a free day+time slot) ----

export interface RescheduleCandidate {
  day: DayCode;
  startMin: number;
  endMin: number;
  label: string;
  free: boolean;
  blockedBy: string | null; // e.g. "Lecturer busy", "Room occupied", "Cohort busy"
  sameDay: boolean;
  score: number;
  recommended: boolean;
}

/**
 * Suggest free (day, time-slot) placements for `session`. Candidate slots are the
 * distinct time slots that already exist in the term's data (so we reuse the
 * institution's real periods), across every day present. A slot is "free" when
 * moving the session there breaks NO rule — no lecturer/room/cohort double-booking,
 * no workload/consecutive/max-per-day breach, and it honours the full-time Friday
 * block and the UG/PG Saturday policy.
 */
export function rescheduleCandidates(
  session: Session,
  sessions: Session[],
  opts: ValidateOptions & { includeBlocked?: boolean } = {},
): RescheduleCandidate[] {
  const termRows = sessions.filter((s) => s.term === session.term);
  // distinct slots (start,end) present in the term
  const slotMap = new Map<string, { startMin: number; endMin: number }>();
  for (const s of termRows) {
    if (s.startMin === null || s.endMin === null) continue;
    slotMap.set(`${s.startMin}-${s.endMin}`, { startMin: s.startMin, endMin: s.endMin });
  }
  const slots = [...slotMap.values()].sort((a, b) => a.startMin - b.startMin);
  const days = DAY_ORDER.filter((d) => termRows.some((s) => s.day === d));

  const probe = (day: DayCode, startMin: number, endMin: number): string | null => {
    const placement: Placement = { ...placementOf(session), day, startMin, endMin };
    const errs = validatePlacement(session.rowId, placement, sessions, opts).filter(
      (v) => v.severity === "error",
    );
    return errs.length ? errs[0].message : null;
  };

  const candidates: RescheduleCandidate[] = [];
  for (const day of days) {
    for (const slot of slots) {
      // skip the current placement
      if (day === session.day && slot.startMin === session.startMin && slot.endMin === session.endMin) continue;
      const blockedBy = probe(day, slot.startMin, slot.endMin);
      const free = blockedBy === null;
      const sameDay = day === session.day;
      let score = 0;
      if (free) score += 1000;
      if (sameDay) score += 40;
      score += 1000 - slot.startMin / 10; // mild preference for earlier slots
      candidates.push({
        day,
        startMin: slot.startMin,
        endMin: slot.endMin,
        label: `${day} ${minutesToLabel(slot.startMin)} - ${minutesToLabel(slot.endMin)}`,
        free,
        blockedBy,
        sameDay,
        score: round(score),
        recommended: false,
      });
    }
  }

  const list = opts?.includeBlocked ? candidates : candidates.filter((c) => c.free);
  list.sort((a, b) => b.score - a.score);
  const best = list.find((c) => c.free);
  if (best) best.recommended = true;
  return list;
}

export function applyReschedule(
  sessions: Session[],
  rowId: number,
  day: DayCode,
  startMin: number,
  endMin: number,
): Session[] {
  return sessions.map((s) =>
    s.rowId === rowId ? finalizeSession({ ...s, day, dayRaw: day, startMin, endMin }) : s,
  );
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
