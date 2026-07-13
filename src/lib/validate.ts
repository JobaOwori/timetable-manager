// Comprehensive constraint validation. Single source of truth for the question
// "can this session live at this (day, time, room, lecturer)?" — used by the
// candidate generators (to rank/filter) and by the UI (to explain, in plain
// language, exactly why a proposed fix is or isn't allowed).
import {
  DayCode,
  RoleMaxHours,
  RoleRegistry,
  Session,
  Thresholds,
} from "./types";
import { DEFAULT_ROLE, maxHoursForRole } from "./roles";
import { minutesToLabel } from "./clean";

export type ViolationKind =
  | "room"
  | "lecturer"
  | "cohort"
  | "workload"
  | "consecutive"
  | "capacity";

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
  term: string | null;
  headCount: number | null;
  workloadHours: number | null;
}

export interface ValidateOptions {
  roleRegistry?: RoleRegistry;
  roleMaxHours?: RoleMaxHours;
  roomRegistry?: Record<string, number>;
  thresholds?: Pick<Thresholds, "capacityTolerance" | "maxConsecutiveHours" | "maxGapMinutes">;
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

  // Room double-booking (physical rooms only).
  if (p.room !== null && !p.isVirtualRoom) {
    const c = sameDay.find((s) => s.room === p.room && !s.isVirtualRoom && at(s));
    if (c)
      out.push({
        kind: "room",
        severity: "error",
        message: `Room ${p.room} is already occupied by ${label(c)} at this time.`,
        conflictRowId: c.rowId,
      });
  }

  // Lecturer double-booking.
  if (p.lecturer !== null) {
    const c = sameDay.find((s) => s.lecturer === p.lecturer && at(s));
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
    const maxHours = maxHoursForRole(role, opts.roleMaxHours);
    const existing = term
      .filter((s) => s.lecturer === p.lecturer)
      .reduce((a, s) => a + (s.workloadHours ?? 0), 0);
    const projected = existing + (p.workloadHours ?? 0);
    if (projected > maxHours)
      out.push({
        kind: "workload",
        severity: "error",
        message: `${p.lecturer} would reach ${round(projected)}h, over the ${maxHours}h weekly limit for ${role}.`,
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
