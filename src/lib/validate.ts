// Comprehensive constraint validation. Single source of truth for the question
// "can this session live at this (day, time, room, lecturer)?" — used by the
// candidate generators (to rank/filter) and by the UI (to explain, in plain
// language, exactly why a proposed fix is or isn't allowed).
import {
  DayCode,
  FacultyTypeRegistry,
  RoleMaxHours,
  RoleRegistry,
  Session,
  Thresholds,
} from "./types";
import { DEFAULT_ROLE, maxHoursFor } from "./roles";
import {
  effectiveFacultyType,
  FRIDAY_BLOCK,
  SATURDAY_WINDOW,
  forbiddenOnSaturday,
  requiresSaturday,
  withinSaturdayWindow,
} from "./facultyType";
import { isCombinedPlacement, sharedClassKey } from "./sharedClass";
import { minutesToLabel } from "./clean";

export type ViolationKind =
  | "room"
  | "lecturer"
  | "cohort"
  | "workload"
  | "consecutive"
  | "capacity"
  | "max_per_day"
  | "faculty_rule"
  | "programme_rule"
  | "time_window";

export type Severity = "error" | "warning";

export interface Violation {
  kind: ViolationKind;
  severity: Severity;
  message: string;
  conflictRowId?: number;
}

/** A hypothetical placement of a session (any subset of fields may change). */
export interface Placement {
  day: DayCode | null;
  startMin: number | null;
  endMin: number | null;
  room: string | null;
  isVirtualRoom: boolean;
  lecturer: string | null;
  batchCode: string | null;
  programme: string | null;
  unitCode: string | null;
  unitName: string | null;
  term: string | null;
  headCount: number | null;
  workloadHours: number | null;
}

export interface ValidateOptions {
  roleRegistry?: RoleRegistry;
  roleMaxHours?: RoleMaxHours;
  facultyTypeRegistry?: FacultyTypeRegistry;
  roomRegistry?: Record<string, number>;
  thresholds?: Pick<
    Thresholds,
    | "capacityTolerance"
    | "maxConsecutiveHours"
    | "maxGapMinutes"
    | "maxSessionsPerDay"
    | "maxSessionsPerDayPartTime"
    | "saturdayStartMin"
    | "saturdayEndMin"
  >;
}

/** The configured Saturday teaching window, falling back to the 9 AM–4 PM default. */
function saturdayWindow(opts: ValidateOptions): { startMin: number; endMin: number } {
  return {
    startMin: opts.thresholds?.saturdayStartMin ?? SATURDAY_WINDOW.startMin,
    endMin: opts.thresholds?.saturdayEndMin ?? SATURDAY_WINDOW.endMin,
  };
}

const overlap = (
  aStart: number,
  aEnd: number,
  bStart: number | null,
  bEnd: number | null,
): boolean => bStart !== null && bEnd !== null && aStart < bEnd && bStart < aEnd;

/** Turn a Session into a Placement (its current position). */
export function placementOf(s: Session): Placement {
  return {
    day: s.day,
    startMin: s.startMin,
    endMin: s.endMin,
    room: s.room,
    isVirtualRoom: s.isVirtualRoom,
    lecturer: s.lecturer,
    batchCode: s.batchCode,
    programme: s.programme,
    unitCode: s.unitCode,
    unitName: s.unitName,
    term: s.term,
    headCount: s.headCount,
    workloadHours: s.workloadHours,
  };
}

/**
 * Validate a proposed placement of `movingRowId` at `p`. Returns every violation
 * (errors block; warnings are advisory, e.g. within capacity tolerance). All other
 * sessions are treated as fixed. Term isolation is always respected.
 */
export function validatePlacement(
  movingRowId: number,
  p: Placement,
  sessions: Session[],
  opts: ValidateOptions = {},
): Violation[] {
  const out: Violation[] = [];
  if (p.day === null || p.startMin === null || p.endMin === null) {
    out.push({ kind: "consecutive", severity: "error", message: "The session has no valid day/time to place." });
    return out;
  }
  const term = sessions.filter((s) => s.term === p.term && s.rowId !== movingRowId);
  const sameDay = term.filter((s) => s.day === p.day);
  const at = (s: Session) => overlap(p.startMin!, p.endMin!, s.startMin, s.endMin);

  // Room double-booking (physical rooms only). A row of the SAME combined class
  // (same lecturer, room and exact slot) is the same physical class, not a clash.
  if (p.room !== null && !p.isVirtualRoom) {
    const c = sameDay.find(
      (s) => s.room === p.room && !s.isVirtualRoom && at(s) && !isCombinedPlacement(s, p),
    );
    if (c)
      out.push({
        kind: "room",
        severity: "error",
        message: `Room ${p.room} is already occupied by ${label(c)} at this time.`,
        conflictRowId: c.rowId,
      });
  }

  // Lecturer double-booking (excluding rows of the same combined class).
  if (p.lecturer !== null) {
    const c = sameDay.find((s) => s.lecturer === p.lecturer && at(s) && !isCombinedPlacement(s, p));
    if (c)
      out.push({
        kind: "lecturer",
        severity: "error",
        message: `${p.lecturer} is already teaching ${label(c)} at this time.`,
        conflictRowId: c.rowId,
      });
  }

  // Cohort (student batch) double-booking.
  if (p.batchCode !== null) {
    const c = sameDay.find((s) => s.batchCode === p.batchCode && at(s));
    if (c)
      out.push({
        kind: "cohort",
        severity: "error",
        message: `Cohort ${p.batchCode} already has ${label(c)} at this time.`,
        conflictRowId: c.rowId,
      });
  }

  // Weekly workload cap for the (proposed) lecturer within the term.
  if (p.lecturer !== null && opts.roleMaxHours) {
    const role = opts.roleRegistry?.[p.lecturer] ?? DEFAULT_ROLE;
    const ft = effectiveFacultyType(p.lecturer, opts.roleRegistry, opts.facultyTypeRegistry);
    const maxHours = maxHoursFor(role, ft, opts.roleMaxHours);
    const existing = term
      .filter((s) => s.lecturer === p.lecturer)
      .reduce((a, s) => a + (s.workloadHours ?? 0), 0);
    const projected = existing + (p.workloadHours ?? 0);
    if (projected > maxHours)
      out.push({
        kind: "workload",
        severity: "error",
        message: `${p.lecturer} would reach ${round(projected)}h, over the ${maxHours}h weekly limit for ${
          ft === "PT" ? "Part-Time staff" : role
        }.`,
      });
  }

  // Consecutive-teaching-hours cap for the (proposed) lecturer on that day.
  if (p.lecturer !== null && opts.thresholds) {
    const maxRun = opts.thresholds.maxConsecutiveHours;
    const gap = opts.thresholds.maxGapMinutes;
    const run = consecutiveRunAround(
      sameDay.filter((s) => s.lecturer === p.lecturer),
      p.startMin,
      p.endMin,
      gap,
    );
    if (run > maxRun)
      out.push({
        kind: "consecutive",
        severity: "error",
        message: `${p.lecturer} would teach ${round(run)}h back-to-back on ${p.day}, over the ${maxRun}h consecutive limit.`,
      });
  }

  // Max sessions per lecturer per day (a combined/shared class counts once).
  // Part-time staff are paid per session, so they get a higher daily allowance.
  if (p.lecturer !== null) {
    const ft = effectiveFacultyType(p.lecturer, opts.roleRegistry, opts.facultyTypeRegistry);
    const maxPerDay =
      ft === "PT"
        ? opts.thresholds?.maxSessionsPerDayPartTime ?? 4
        : opts.thresholds?.maxSessionsPerDay ?? 3;
    const others = sameDay.filter((s) => s.lecturer === p.lecturer);
    const distinctKeys = new Set(others.map((s) => sharedClassKey(s) ?? `row-${s.rowId}`));
    // the moving session joins an existing combined class only if it matches one
    const joinsExisting = others.some((s) => isCombinedPlacement(s, p));
    const dayCount = distinctKeys.size + (joinsExisting ? 0 : 1);
    if (dayCount > maxPerDay)
      out.push({
        kind: "max_per_day",
        severity: "error",
        message: `${p.lecturer} would have ${dayCount} sessions on ${p.day} (max ${maxPerDay} per day for ${
          ft === "PT" ? "Part-Time" : "Full-Time"
        } staff).`,
      });
  }

  // Full-time lecturers cannot be scheduled in the Friday 4:00–6:00 PM slot.
  if (
    p.lecturer !== null &&
    p.day === FRIDAY_BLOCK.day &&
    effectiveFacultyType(p.lecturer, opts.roleRegistry, opts.facultyTypeRegistry) === "FT" &&
    overlap(p.startMin, p.endMin, FRIDAY_BLOCK.startMin, FRIDAY_BLOCK.endMin)
  ) {
    out.push({
      kind: "faculty_rule",
      severity: "error",
      message: `${p.lecturer} is Full-Time and can't be scheduled in the Friday 4:00–6:00 PM slot.`,
    });
  }

  // Programme-level day rules (by code prefix): Bachelor's/Diploma/HEC never on
  // Saturday; Master's/Doctoral only on Saturday.
  if (p.day === "SAT" && forbiddenOnSaturday(p.programme)) {
    out.push({
      kind: "programme_rule",
      severity: "error",
      message: `${p.programme ?? "This programme"} (weekday programme) can't be scheduled on Saturday.`,
    });
  }
  if (p.day !== "SAT" && requiresSaturday(p.programme)) {
    out.push({
      kind: "programme_rule",
      severity: "error",
      message: `${p.programme ?? "This programme"} (Master's/Doctoral) must be scheduled on Saturday.`,
    });
  }

  // Saturday teaching runs 9:00 AM – 4:00 PM; classes must finish by 4:00 PM.
  if (p.day === "SAT") {
    const win = saturdayWindow(opts);
    if (!withinSaturdayWindow(p.startMin, p.endMin, win)) {
      out.push({
        kind: "time_window",
        severity: "error",
        message: `Saturday classes run ${minutesToLabel(win.startMin)}–${minutesToLabel(
          win.endMin,
        )}; ${minutesToLabel(p.startMin)}–${minutesToLabel(p.endMin)} falls outside that window.`,
      });
    }
  }

  // Room capacity (warning within tolerance, error beyond).
  if (p.room !== null && !p.isVirtualRoom && p.headCount !== null && opts.roomRegistry) {
    const cap = opts.roomRegistry[p.room];
    const tol = opts.thresholds?.capacityTolerance ?? 0;
    if (cap !== undefined && p.headCount > cap) {
      const over = p.headCount - cap;
      out.push(
        p.headCount > cap + tol
          ? {
              kind: "capacity",
              severity: "error",
              message: `Room ${p.room} holds ${cap}; ${p.headCount} students is ${over} over capacity.`,
            }
          : {
              kind: "capacity",
              severity: "warning",
              message: `Room ${p.room} holds ${cap}; ${p.headCount} students is ${over} over (within tolerance).`,
            },
      );
    }
  }

  return out;
}

/** Longest back-to-back teaching run (hours) that would include [start,end). */
function consecutiveRunAround(
  daySessions: { startMin: number | null; endMin: number | null }[],
  start: number,
  end: number,
  maxGapMinutes: number,
): number {
  const blocks = [
    ...daySessions
      .filter((s) => s.startMin !== null && s.endMin !== null)
      .map((s) => ({ start: s.startMin!, end: s.endMin! })),
    { start, end },
  ].sort((a, b) => a.start - b.start);
  let bestRun = 0;
  let runStart = blocks[0].start;
  let runEnd = blocks[0].end;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].start - runEnd <= maxGapMinutes) {
      runEnd = Math.max(runEnd, blocks[i].end);
    } else {
      bestRun = Math.max(bestRun, runEnd - runStart);
      runStart = blocks[i].start;
      runEnd = blocks[i].end;
    }
  }
  bestRun = Math.max(bestRun, runEnd - runStart);
  return bestRun / 60;
}

const label = (s: Session): string =>
  [s.unitCode, s.batchCode ? `(${s.batchCode})` : null].filter(Boolean).join(" ") ||
  `a class at ${minutesToLabel(s.startMin)}`;

function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export const hasError = (v: Violation[]): boolean => v.some((x) => x.severity === "error");

/** Rule kinds beyond simple double-booking (the institution's policies). */
const RULE_KINDS: ViolationKind[] = ["max_per_day", "faculty_rule", "programme_rule", "time_window"];

export interface RuleViolation {
  rowId: number;
  unitCode: string | null;
  programme: string | null;
  lecturer: string | null;
  day: DayCode | null;
  time: string | null;
  kind: ViolationKind;
  message: string;
}

/**
 * Scan the current timetable for sessions that break a scheduling POLICY (max
 * sessions/day, full-time Friday-evening block, or the UG/PG Saturday rules) —
 * as opposed to plain double-bookings. Used to surface & fix policy breaches.
 */
export function detectRuleViolations(sessions: Session[], opts: ValidateOptions = {}): RuleViolation[] {
  const out: RuleViolation[] = [];
  const seenMaxPerDay = new Set<string>();
  for (const s of sessions) {
    if (s.day === null || s.startMin === null || s.endMin === null) continue;
    const viols = validatePlacement(s.rowId, placementOf(s), sessions, opts).filter((v) =>
      RULE_KINDS.includes(v.kind),
    );
    for (const v of viols) {
      // Collapse the per-day cap to one entry per (lecturer, day).
      if (v.kind === "max_per_day") {
        const key = `${s.lecturer}||${s.day}`;
        if (seenMaxPerDay.has(key)) continue;
        seenMaxPerDay.add(key);
      }
      out.push({
        rowId: s.rowId,
        unitCode: s.unitCode,
        programme: s.programme,
        lecturer: s.lecturer,
        day: s.day,
        time: s.timeRaw,
        kind: v.kind,
        message: v.message,
      });
    }
  }
  return out;
}

