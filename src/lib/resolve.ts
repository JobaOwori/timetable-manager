// Auto-resolution: intelligently clear a lecturer's (or the whole term's)
// scheduling conflicts by rescheduling to a free slot or transferring to an
// available lecturer, and — crucially — explain in plain language when a
// conflict cannot be cleared automatically.
import { Clash, ClashType, Session } from "./types";
import { detectClashes } from "./analysis";
import {
  CandidateOptions,
  applyReschedule,
  applyTransfer,
  rescheduleCandidates,
  roomCandidates,
  applyRoomChange,
  transferCandidates,
} from "./transfer";

export interface ResolutionStep {
  rowId: number;
  unitCode: string | null;
  action: "reschedule" | "transfer" | "room";
  from: string;
  to: string;
}

export interface Unresolved {
  rowId: number;
  unitCode: string | null;
  reasons: string[];
}

export interface ResolveResult {
  sessions: Session[];
  steps: ResolutionStep[];
  unresolved: Unresolved[];
}

export interface AutoResolveOptions extends CandidateOptions {
  roomRegistry?: Record<string, number>;
  capacityTolerance?: number;
}

/** Which session of a clashing pair to relocate: prefer the later-starting one. */
function pickMover(a: Session, b: Session): Session {
  if ((a.startMin ?? 0) !== (b.startMin ?? 0)) return (a.startMin ?? 0) > (b.startMin ?? 0) ? a : b;
  return a.rowId > b.rowId ? a : b;
}

interface RunOptions {
  lecturer?: string; // limit to conflicts involving this lecturer
  types?: ("lecturer" | "room" | "batch_code")[];
  maxIterations?: number;
}

const DEFAULT_TYPES: ClashType[] = ["lecturer", "room", "batch_code"];

function requestedTypes(run: RunOptions): ClashType[] {
  return [...new Set(run.types ?? DEFAULT_TYPES)];
}

function clashInvolvesLecturer(clash: Clash, lecturer: string): boolean {
  return (
    (clash.clashType === "lecturer" && clash.groupValue === lecturer) ||
    clash.lecturer1 === lecturer ||
    clash.lecturer2 === lecturer
  );
}

function relevantClashes(sessions: Session[], types: ClashType[], lecturer?: string): Clash[] {
  const clashes = types.flatMap((t) => detectClashes(sessions, t));
  return lecturer ? clashes.filter((c) => clashInvolvesLecturer(c, lecturer)) : clashes;
}

function relevantClashCount(sessions: Session[], types: ClashType[], lecturer?: string): number {
  return relevantClashes(sessions, types, lecturer).length;
}

function clashTypesByRow(clashes: Clash[]): Map<number, Set<ClashType>> {
  const out = new Map<number, Set<ClashType>>();
  for (const clash of clashes) {
    for (const rowId of [clash.rowId1, clash.rowId2]) {
      const types = out.get(rowId) ?? new Set<ClashType>();
      types.add(clash.clashType);
      out.set(rowId, types);
    }
  }
  return out;
}

function orderedConflictingSessions(working: Session[], clashes: Clash[]): Session[] {
  const byId = new Map(working.map((s) => [s.rowId, s]));
  const seen = new Set<number>();
  const ordered: Session[] = [];
  const add = (session: Session | undefined) => {
    if (!session || seen.has(session.rowId)) return;
    seen.add(session.rowId);
    ordered.push(session);
  };

  for (const clash of clashes) {
    const a = byId.get(clash.rowId1);
    const b = byId.get(clash.rowId2);
    if (!a || !b) continue;
    const mover = pickMover(a, b);
    add(mover);
    add(mover.rowId === a.rowId ? b : a);
  }
  return ordered;
}

function placementLabel(session: Session): string {
  return `${session.day ?? "this day"} ${session.timeRaw ?? "this time"}`.trim();
}

function unitLabel(session: Session): string {
  return session.unitCode ?? "this class";
}

function tryMonotonicRemedies(
  working: Session[],
  session: Session,
  activeTypes: Set<ClashType>,
  opts: AutoResolveOptions,
  beforeCount: number,
  types: ClashType[],
  lecturer?: string,
): { sessions: Session[]; step: ResolutionStep } | null {
  const improves = (next: Session[]) => relevantClashCount(next, types, lecturer) < beforeCount;

  if (activeTypes.size > 0) {
    for (const candidate of rescheduleCandidates(session, working).filter((c) => c.free)) {
      const next = applyReschedule(working, session.rowId, candidate.day, candidate.startMin, candidate.endMin);
      if (improves(next)) {
        return {
          sessions: next,
          step: {
            rowId: session.rowId,
            unitCode: session.unitCode,
            action: "reschedule",
            from: placementLabel(session),
            to: candidate.label,
          },
        };
      }
    }
  }

  if (activeTypes.has("lecturer") && session.lecturer !== null) {
    const candidates = transferCandidates(session, working, opts);
    const ordered = [
      ...candidates.filter((c) => c.available && c.projectedStatus !== "Overloaded"),
      ...candidates.filter((c) => c.available && c.projectedStatus === "Overloaded"),
    ];
    for (const candidate of ordered) {
      const next = applyTransfer(working, session.rowId, candidate.lecturer);
      if (improves(next)) {
        return {
          sessions: next,
          step: {
            rowId: session.rowId,
            unitCode: session.unitCode,
            action: "transfer",
            from: session.lecturer,
            to: candidate.lecturer,
          },
        };
      }
    }
  }

  if (activeTypes.has("room") && session.room !== null && !session.isVirtualRoom && opts.roomRegistry) {
    const candidates = roomCandidates(session, working, opts.roomRegistry, opts.capacityTolerance ?? 0);
    const ordered = candidates.filter((c) => c.available && c.fits);
    for (const candidate of ordered) {
      const next = applyRoomChange(working, session.rowId, candidate.room);
      if (improves(next)) {
        return {
          sessions: next,
          step: {
            rowId: session.rowId,
            unitCode: session.unitCode,
            action: "room",
            from: session.room,
            to: candidate.room,
          },
        };
      }
    }
  }

  return null;
}

function unresolvedReasons(
  session: Session,
  sessions: Session[],
  opts: AutoResolveOptions,
  activeTypes: Set<ClashType>,
): string[] {
  const reasons: string[] = [];
  const freeSlots = rescheduleCandidates(session, sessions).filter((c) => c.free);

  if (freeSlots.length === 0) {
    if (activeTypes.has("batch_code")) {
      reasons.push(
        "The cohort is booked in every alternative slot, so this overlap can't be cleared automatically — split the class or adjust the timetable manually.",
      );
    } else {
      reasons.push(`No free time slot is available to move ${unitLabel(session)} to in this term.`);
    }
  } else {
    reasons.push(`Available time-slot moves for ${unitLabel(session)} do not reduce the selected clash count.`);
  }

  if (activeTypes.has("lecturer")) {
    if (session.lecturer === null) {
      reasons.push(`No lecturer transfer is possible because ${unitLabel(session)} has no assigned lecturer.`);
    } else {
      const candidates = transferCandidates(session, sessions, opts);
      if (!candidates.some((c) => c.available && c.projectedStatus !== "Overloaded")) {
        reasons.push(`No other lecturer is free at ${placementLabel(session)} without exceeding their weekly limit.`);
      } else {
        reasons.push(`Available lecturer transfers at ${placementLabel(session)} do not reduce the selected clash count.`);
      }
    }
  }

  if (activeTypes.has("room")) {
    if (session.room === null || session.isVirtualRoom) {
      reasons.push(`No room move is possible because ${unitLabel(session)} has no physical room assigned.`);
    } else if (!opts.roomRegistry) {
      reasons.push("No room registry is configured, so a replacement room cannot be chosen automatically.");
    } else {
      const candidates = roomCandidates(session, sessions, opts.roomRegistry, opts.capacityTolerance ?? 0);
      if (!candidates.some((c) => c.available && c.fits)) {
        reasons.push("No free room with enough capacity is available at this time.");
      } else {
        reasons.push("Available room moves do not reduce the selected clash count.");
      }
    }
  }

  return [...new Set(reasons)];
}

/**
 * Greedily resolve conflicts. Returns the new sessions, the ordered list of
 * changes made, and, for anything it could not fix, the exact reasons.
 */
export function autoResolve(
  sessions: Session[],
  opts: AutoResolveOptions,
  run: RunOptions = {},
): ResolveResult {
  const types = requestedTypes(run);
  let working = sessions.map((s) => ({ ...s }));
  const steps: ResolutionStep[] = [];
  const maxIter = run.maxIterations ?? 1000;

  for (let i = 0; i < maxIter; i++) {
    const clashes = relevantClashes(working, types, run.lecturer);
    if (clashes.length === 0) break;
    const beforeCount = clashes.length;
    const rowTypes = clashTypesByRow(clashes);
    let progressed = false;

    for (const session of orderedConflictingSessions(working, clashes)) {
      const activeTypes = rowTypes.get(session.rowId);
      if (!activeTypes) continue;
      const result = tryMonotonicRemedies(working, session, activeTypes, opts, beforeCount, types, run.lecturer);
      if (result) {
        working = result.sessions;
        steps.push(result.step);
        progressed = true;
        break;
      }
    }

    if (!progressed) break;
  }

  // Build unresolved report for any remaining conflicting sessions.
  const remaining = relevantClashes(working, types, run.lecturer);
  const rowTypes = clashTypesByRow(remaining);
  const byId = new Map(working.map((s) => [s.rowId, s]));
  const unresolvedMap = new Map<number, Unresolved>();
  for (const [rowId, activeTypes] of rowTypes) {
    const session = byId.get(rowId);
    if (!session) continue;
    unresolvedMap.set(rowId, {
      rowId,
      unitCode: session.unitCode,
      reasons: unresolvedReasons(session, working, opts, activeTypes),
    });
  }

  return { sessions: working, steps, unresolved: [...unresolvedMap.values()] };
}

/** Explain, for a single session in conflict, what can/can't be done and why. */
export function explainSession(
  session: Session,
  sessions: Session[],
  opts: AutoResolveOptions,
): { canReschedule: boolean; canTransfer: boolean; canMoveRoom: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const canReschedule = rescheduleCandidates(session, sessions).some((c) => c.free);
  if (!canReschedule) reasons.push(`No free time slot is available to move ${unitLabel(session)} to in this term.`);

  const canTransfer =
    session.lecturer !== null && transferCandidates(session, sessions, opts).some((c) => c.available);
  if (session.lecturer !== null && !canTransfer)
    reasons.push(`No other lecturer is free at ${placementLabel(session)} without exceeding their weekly limit.`);

  const canMoveRoom =
    session.room !== null && !session.isVirtualRoom && !!opts.roomRegistry &&
    roomCandidates(session, sessions, opts.roomRegistry, opts.capacityTolerance ?? 0).some((r) => r.available && r.fits);
  if (session.room !== null && !session.isVirtualRoom && !canMoveRoom)
    reasons.push("No free room with enough capacity is available at this time.");

  return { canReschedule, canTransfer, canMoveRoom, reasons };
}
