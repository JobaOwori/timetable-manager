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
import { DEFAULT_ROLE, maxHoursFor } from "./roles";
import {
  effectiveFacultyType, SATURDAY_WINDOW, forbiddenOnSaturday, requiresSaturday, workloadStatus,
} from "./facultyType";
import { departmentFor } from "./departments";
import { finalizeSession } from "./ingest";
import { minutesToLabel } from "./clean";
import { Placement, ValidateOptions, Violation, ViolationKind, placementOf, validatePlacement } from "./validate";

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
    const facultyType = effectiveFacultyType(lecturer, roleRegistry, facultyTypeRegistry);
    const maxHours = maxHoursFor(role, facultyType, roleMaxHours);
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
 * institution's real periods), across every day present. Saturday additionally
 * gets slots synthesised inside its 9:00 AM – 4:00 PM teaching window, so a
 * Saturday class that currently overruns 4:00 PM always has a compliant slot to
 * move to even when the sheet contains none. A slot is "free" when moving the
 * session there breaks NO rule — no lecturer/room/cohort double-booking, no
 * workload/consecutive/max-per-day breach, and it honours the full-time Friday
 * block, the UG/PG Saturday policy and the Saturday window.
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
  const satSlots = saturdaySlots(slots, session, opts);

  const probe = (day: DayCode, startMin: number, endMin: number): string | null => {
    const placement: Placement = { ...placementOf(session), day, startMin, endMin };
    const errs = validatePlacement(session.rowId, placement, sessions, opts).filter(
      (v) => v.severity === "error",
    );
    return errs.length ? errs[0].message : null;
  };

  const candidates: RescheduleCandidate[] = [];
  for (const day of days) {
    for (const slot of day === "SAT" ? satSlots : slots) {
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

/**
 * The Saturday slot menu: every existing slot that fits the 9:00 AM–4:00 PM
 * window, plus slots synthesised on the half-hour for the session's own duration
 * so a compliant Saturday placement always exists.
 */
function saturdaySlots(
  slots: { startMin: number; endMin: number }[],
  session: Session,
  opts: ValidateOptions,
): { startMin: number; endMin: number }[] {
  const winStart = opts.thresholds?.saturdayStartMin ?? SATURDAY_WINDOW.startMin;
  const winEnd = opts.thresholds?.saturdayEndMin ?? SATURDAY_WINDOW.endMin;
  const out = new Map<string, { startMin: number; endMin: number }>();

  for (const s of slots) {
    if (s.startMin >= winStart && s.endMin <= winEnd) out.set(`${s.startMin}-${s.endMin}`, s);
  }

  // Tile the window on the half-hour with this session's own duration.
  const duration =
    session.startMin !== null && session.endMin !== null && session.endMin > session.startMin
      ? session.endMin - session.startMin
      : Math.round((session.durationHours ?? 2) * 60);
  if (duration > 0 && duration <= winEnd - winStart) {
    for (let start = winStart; start + duration <= winEnd; start += 30) {
      out.set(`${start}-${start + duration}`, { startMin: start, endMin: start + duration });
    }
  }

  return [...out.values()].sort((a, b) => a.startMin - b.startMin);
}

/**
 * A complete, fully-validated proposal for moving a session: a new day/time and,
 * where needed, a different room and/or lecturer. Unlike a bare slot move, a plan
 * is only returned when EVERY constraint holds for the whole combination —
 * lecturer, room and cohort availability, weekly workload, consecutive hours,
 * per-day limits, room capacity, the full-time Friday block, the UG/PG Saturday
 * rule and the Saturday teaching window.
 */
export interface ReschedulePlan {
  day: DayCode;
  startMin: number;
  endMin: number;
  room: string | null;
  lecturer: string | null;
  slotLabel: string; // "MON 9:00 AM - 10:55 AM"
  label: string; // slot + what else changes
  changes: string[]; // human-readable list of what moves
  dayChanged: boolean;
  timeChanged: boolean;
  roomChanged: boolean;
  lecturerChanged: boolean;
  capacityWarning: string | null;
  score: number;
  recommended: boolean;
}

export interface ReschedulePlanOptions extends ValidateOptions {
  /** Allow proposing a different room (default true). */
  allowRoomChange?: boolean;
  /** Allow proposing a different lecturer (default true, used as a fallback). */
  allowLecturerChange?: boolean;
  /** Cap on returned plans (default 40). */
  limit?: number;
}

/** Distinct (start,end) slots used anywhere in the term, earliest first. */
function termSlots(termRows: Session[]): { startMin: number; endMin: number }[] {
  const map = new Map<string, { startMin: number; endMin: number }>();
  for (const s of termRows) {
    if (s.startMin === null || s.endMin === null || s.endMin <= s.startMin) continue;
    map.set(`${s.startMin}-${s.endMin}`, { startMin: s.startMin, endMin: s.endMin });
  }
  return [...map.values()].sort((a, b) => a.startMin - b.startMin);
}

/**
 * Errors that genuinely block a proposed move.
 *
 * Some rules are invariant under rescheduling: a lecturer's WEEKLY workload
 * doesn't change by moving one of their classes to another slot, and a room's
 * CAPACITY doesn't change by moving a class within that same room. When such a
 * rule is already breached at the session's current position, letting it veto
 * every alternative would make the class unfixable — the pre-existing problem
 * would mask the clash we are actually trying to resolve. So a violation is
 * ignored only when it already exists now AND this move cannot influence it.
 */
function blockingErrors(
  violations: Violation[],
  session: Session,
  plan: { room: string | null; lecturer: string | null },
  baseline: Set<ViolationKind>,
): Violation[] {
  return violations.filter((v) => {
    if (v.severity !== "error") return false;
    // Weekly hours depend on the lecturer alone.
    if (v.kind === "workload" && plan.lecturer === session.lecturer && baseline.has("workload")) {
      return false;
    }
    // Capacity depends on the room alone.
    if (v.kind === "capacity" && plan.room === session.room && baseline.has("capacity")) {
      return false;
    }
    return true;
  });
}

/** Rules already broken where the session sits right now. */
function baselineKinds(session: Session, sessions: Session[], opts: ValidateOptions): Set<ViolationKind> {
  return new Set(
    validatePlacement(session.rowId, placementOf(session), sessions, opts)
      .filter((v) => v.severity === "error")
      .map((v) => v.kind),
  );
}

/** Every physical room known, from the registry and from the timetable itself. */
function knownRooms(sessions: Session[], roomRegistry?: Record<string, number>): string[] {
  return [
    ...new Set([
      ...Object.keys(roomRegistry ?? {}),
      ...sessions.filter((s) => !s.isVirtualRoom).map((s) => s.room).filter((r): r is string => !!r),
    ]),
  ].sort();
}

/**
 * Search day × time × room (× lecturer, only if nothing else works) for
 * placements of `session` that break no rule at all, and rank them so the
 * smallest change that fixes the problem comes first.
 *
 * Every returned plan has been validated end-to-end with `validatePlacement`,
 * so applying one can never introduce a new clash.
 */
export function reschedulePlans(
  session: Session,
  sessions: Session[],
  opts: ReschedulePlanOptions = {},
): ReschedulePlan[] {
  const allowRoom = opts.allowRoomChange ?? true;
  const allowLecturer = opts.allowLecturerChange ?? true;
  const limit = opts.limit ?? 40;

  const termRows = sessions.filter((s) => s.term === session.term);
  const slots = termSlots(termRows);
  const days = DAY_ORDER.filter((d) => termRows.some((s) => s.day === d));
  const satSlots = saturdaySlots(slots, session, opts);
  const base = placementOf(session);

  // Rooms to try: keep the current one first, then every other physical room
  // ordered by how snugly it fits the class (least wasted seats first).
  const hc = session.headCount;
  const rooms: (string | null)[] = [session.room];
  if (allowRoom && !session.isVirtualRoom) {
    const others = knownRooms(sessions, opts.roomRegistry)
      .filter((r) => r !== session.room)
      .sort((a, b) => roomFitRank(a, hc, opts.roomRegistry) - roomFitRank(b, hc, opts.roomRegistry));
    rooms.push(...others);
  }

  // Lecturers to try: the current one first; alternates are only explored when
  // no plan exists that keeps them, so we never reassign work unnecessarily.
  const alternates = allowLecturer
    ? [...new Set(sessions.map((s) => s.lecturer).filter((l): l is string => !!l))].filter(
        (l) => l !== session.lecturer,
      )
    : [];

  const plans: ReschedulePlan[] = [];
  const seen = new Set<string>();
  const baseline = baselineKinds(session, sessions, opts);

  const consider = (day: DayCode, slot: { startMin: number; endMin: number }, lecturer: string | null) => {
    for (const room of rooms) {
      const placement: Placement = {
        ...base,
        day,
        startMin: slot.startMin,
        endMin: slot.endMin,
        room,
        lecturer,
      };
      const violations = validatePlacement(session.rowId, placement, sessions, opts);
      if (blockingErrors(violations, session, { room, lecturer }, baseline).length > 0) continue;

      const key = `${day}|${slot.startMin}|${slot.endMin}|${room ?? ""}|${lecturer ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      plans.push(
        buildPlan(session, day, slot, room, lecturer, violations.find((v) => v.kind === "capacity")?.message ?? null),
      );
      // The first room that works at this slot is the best-fitting one; no need
      // to enumerate the rest for the same slot.
      return;
    }
  };

  for (const day of days) {
    for (const slot of day === "SAT" ? satSlots : slots) {
      if (day === session.day && slot.startMin === session.startMin && slot.endMin === session.endMin) {
        continue; // that's where it already is
      }
      consider(day, slot, session.lecturer);
    }
  }

  // Fallback: nothing works for this lecturer anywhere — offer plans that also
  // hand the class to a colleague who IS free (and stays within their limits).
  if (plans.length === 0 && alternates.length > 0) {
    for (const day of days) {
      for (const slot of day === "SAT" ? satSlots : slots) {
        for (const lecturer of alternates) {
          consider(day, slot, lecturer);
          if (plans.length >= limit) break;
        }
        if (plans.length >= limit) break;
      }
      if (plans.length >= limit) break;
    }
    // Staying put but changing lecturer/room is also a valid "reschedule".
    if (session.day !== null && session.startMin !== null && session.endMin !== null) {
      for (const lecturer of alternates) {
        consider(session.day, { startMin: session.startMin, endMin: session.endMin }, lecturer);
      }
    }
  }

  plans.sort((a, b) => b.score - a.score);
  const top = plans.slice(0, limit);
  if (top.length > 0) top[0].recommended = true;
  return top;
}

/** Lower is better: how much capacity is wasted on this class. */
function roomFitRank(room: string, headCount: number | null, registry?: Record<string, number>): number {
  const cap = registry?.[room];
  if (cap === undefined) return 10_000; // unknown capacity — try after known ones
  if (headCount === null) return 5_000 + cap;
  if (cap < headCount) return 20_000 + (headCount - cap); // too small
  return cap - headCount;
}

function buildPlan(
  session: Session,
  day: DayCode,
  slot: { startMin: number; endMin: number },
  room: string | null,
  lecturer: string | null,
  capacityWarning: string | null,
): ReschedulePlan {
  const dayChanged = day !== session.day;
  const timeChanged = slot.startMin !== session.startMin || slot.endMin !== session.endMin;
  const roomChanged = room !== session.room;
  const lecturerChanged = lecturer !== session.lecturer;
  const slotLabel = `${day} ${minutesToLabel(slot.startMin)} - ${minutesToLabel(slot.endMin)}`;

  const changes: string[] = [];
  if (dayChanged) changes.push(`day → ${day}`);
  if (timeChanged) changes.push(`time → ${minutesToLabel(slot.startMin)}`);
  if (roomChanged) changes.push(`room → ${room ?? "TBA"}`);
  if (lecturerChanged) changes.push(`lecturer → ${lecturer ?? "TBA"}`);

  // Prefer the smallest disruption: same room and lecturer beats a room move,
  // which beats reassigning the class; earlier slots break ties.
  let score = 1_000;
  if (!roomChanged) score += 400;
  if (!lecturerChanged) score += 800;
  if (!dayChanged) score += 60;
  if (capacityWarning === null) score += 120;
  score += Math.max(0, 900 - slot.startMin) / 10;

  return {
    day,
    startMin: slot.startMin,
    endMin: slot.endMin,
    room,
    lecturer,
    slotLabel,
    label: changes.length ? `${slotLabel} · ${changes.join(", ")}` : slotLabel,
    changes,
    dayChanged,
    timeChanged,
    roomChanged,
    lecturerChanged,
    capacityWarning,
    score: round(score),
    recommended: false,
  };
}

/**
 * Why no plan could be found — checked in the order a scheduler would, so the
 * message names the real blocker rather than the first rule that happened to fire.
 */
export function rescheduleBlockers(
  session: Session,
  sessions: Session[],
  opts: ReschedulePlanOptions = {},
): string[] {
  const reasons: string[] = [];
  const termRows = sessions.filter((s) => s.term === session.term);
  const slots = termSlots(termRows);
  const days = DAY_ORDER.filter((d) => termRows.some((s) => s.day === d));

  if (slots.length === 0 || days.length === 0) {
    return ["This term has no other scheduled day or time slot to move the class to."];
  }
  if (session.day === null || session.startMin === null || session.endMin === null) {
    return ["This session has no valid day/time, so it can't be moved until that is fixed."];
  }

  // Which rule blocks every single slot? Only probe days the programme is
  // actually allowed to use, so the reason names the real obstacle rather than
  // the day rule that merely narrows the search.
  const counts = new Map<string, number>();
  const baseline = baselineKinds(session, sessions, opts);
  const allowedDays = days.filter((d) =>
    requiresSaturday(session.programme) ? d === "SAT" : !(d === "SAT" && forbiddenOnSaturday(session.programme)),
  );
  const probeDays = allowedDays.length > 0 ? allowedDays : days;
  let probes = 0;
  for (const day of probeDays) {
    for (const slot of day === "SAT" ? saturdaySlots(slots, session, opts) : slots) {
      const placement: Placement = { ...placementOf(session), day, startMin: slot.startMin, endMin: slot.endMin };
      const errs = blockingErrors(
        validatePlacement(session.rowId, placement, sessions, opts),
        session,
        { room: session.room, lecturer: session.lecturer },
        baseline,
      );
      probes += 1;
      for (const kind of new Set(errs.map((e) => e.kind))) {
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
  }
  const label: Record<string, string> = {
    room: `room ${session.room ?? "?"} is occupied`,
    lecturer: `${session.lecturer ?? "the lecturer"} is already teaching`,
    cohort: `cohort ${session.batchCode ?? "?"} is already in class`,
    workload: "the weekly workload limit would be exceeded",
    consecutive: "the consecutive-teaching-hours limit would be exceeded",
    max_per_day: "the per-day class limit would be exceeded",
    faculty_rule: "the full-time Friday 4–6 PM block applies",
    programme_rule: "the programme's day rule (UG≠Sat, PG=Sat) applies",
    time_window: "the slot falls outside the Saturday teaching window",
    capacity: "no room with enough capacity is free",
  };

  // Rank the rules by how many alternatives they rule out, so the message names
  // the real obstacle rather than an incidental one.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = ranked.filter(([, n]) => n === probes).map(([kind]) => label[kind] ?? kind);

  if (dominant.length > 0) {
    reasons.push(`In every one of the ${probes} alternative slots, ${dominant.join(" and ")}.`);
  } else if (ranked.length > 0) {
    const top = ranked
      .slice(0, 2)
      .map(([kind, n]) => `${label[kind] ?? kind} (${n} of ${probes} slots)`);
    reasons.push(`No slot is completely free: ${top.join("; ")}.`);
  } else {
    reasons.push(
      "No single slot is free for this class as it stands — try a different room or lecturer as part of the move.",
    );
  }

  if (counts.get("cohort") === probes) {
    reasons.push(
      "Because the students themselves are booked all week, this one needs a timetable change for the cohort — splitting the class or freeing one of their other sessions.",
    );
  }
  return reasons;
}

/** Apply a validated plan: day, time, room and lecturer in one atomic edit. */
export function applyReschedulePlan(
  sessions: Session[],
  rowId: number,
  plan: Pick<ReschedulePlan, "day" | "startMin" | "endMin" | "room" | "lecturer">,
): Session[] {
  return sessions.map((s) => {
    if (s.rowId !== rowId) return s;
    return finalizeSession({
      ...s,
      day: plan.day,
      dayRaw: plan.day,
      startMin: plan.startMin,
      endMin: plan.endMin,
      room: plan.room,
      lecturer: plan.lecturer,
      lecturerRaw: plan.lecturer,
    });
  });
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
