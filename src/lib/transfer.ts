// Lecturer transfer / conflict-resolution engine.
// Given a session (typically one involved in a lecturer clash or overload), rank
// alternative lecturers it could be reassigned to, and apply the reassignment
// immutably. This is the app's headline feature.
import {
  DepartmentRegistry,
  RoleMaxHours,
  RoleRegistry,
  Session,
  Thresholds,
  WorkloadStatus,
} from "./types";
import { DEFAULT_ROLE, maxHoursForRole, workloadStatus } from "./roles";
import { departmentFor } from "./departments";
import { finalizeSession } from "./ingest";

export const UNASSIGN = "\u2014 Unassign (TBA) \u2014";

export interface TransferCandidate {
  lecturer: string;
  role: string;
  currentHours: number;
  maxHours: number;
  remainingHours: number;
  projectedHours: number;
  projectedStatus: WorkloadStatus;
  available: boolean;
  conflictReason: string | null;
  teachesSameUnit: boolean;
  sameDepartment: boolean;
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
  thresholds: Pick<Thresholds, "nearMaxPct" | "farUnderPct">;
  includeUnavailable?: boolean;
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
  const { roleRegistry, roleMaxHours, departmentRegistry, thresholds } = opts;
  const sessionHours = session.workloadHours ?? 0;
  const sessionDept = departmentFor(session.programme, departmentRegistry);

  const allLecturers = [
    ...new Set(sessions.map((s) => s.lecturer).filter((l): l is string => !!l)),
  ].filter((l) => l !== session.lecturer);

  const candidates: TransferCandidate[] = allLecturers.map((lecturer) => {
    const role = roleRegistry[lecturer] ?? DEFAULT_ROLE;
    const maxHours = maxHoursForRole(role, roleMaxHours);
    const currentHours = lecturerHoursInTerm(sessions, lecturer, session.term);
    const projectedHours = currentHours + sessionHours;
    const { status: projectedStatus } = workloadStatus(
      projectedHours, maxHours, thresholds.nearMaxPct, thresholds.farUnderPct,
    );

    // Availability: no other session for this lecturer overlapping the slot.
    const conflicting = sessions.find(
      (s) => s.lecturer === lecturer && s.rowId !== session.rowId && overlaps(s, session),
    );
    const available = !conflicting;
    const conflictReason = conflicting
      ? `Already teaching ${conflicting.unitCode ?? "a class"} at this time`
      : null;

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
    // (same unit > same dept); then workload headroom; overload is penalized.
    let score = 0;
    if (available) score += 1000;
    if (teachesSameUnit) score += 300;
    else if (sameDepartment) score += 120;
    if (projectedStatus === "Overloaded") score -= 500;
    else if (projectedStatus === "Balanced") score += 60;
    score += Math.max(0, maxHours - projectedHours) * 4; // reward remaining headroom

    return {
      lecturer,
      role,
      currentHours: round(currentHours),
      maxHours,
      remainingHours: round(maxHours - currentHours),
      projectedHours: round(projectedHours),
      projectedStatus,
      available,
      conflictReason,
      teachesSameUnit,
      sameDepartment,
      score: round(score),
      recommended: false,
    };
  });

  const filtered = opts.includeUnavailable ? candidates : candidates.filter((c) => c.available);
  filtered.sort((a, b) => b.score - a.score);
  // Mark the single best available, non-overloading candidate as recommended.
  const best = filtered.find((c) => c.available && c.projectedStatus !== "Overloaded");
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

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
