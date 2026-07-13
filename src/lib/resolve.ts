// Auto-resolution: intelligently clear a lecturer's (or the whole term's)
// scheduling conflicts by rescheduling to a free slot or transferring to an
// available lecturer, and — crucially — explain in plain language when a
// conflict cannot be cleared automatically.
import { Session } from "./types";
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

/** Try to relocate one session out of a conflict. Returns a step or the reasons it failed. */
function relocate(
  working: Session[],
  session: Session,
  opts: AutoResolveOptions,
  kinds: { lecturer: boolean; room: boolean; cohort: boolean },
): { sessions: Session[]; step: ResolutionStep } | { reasons: string[] } {
  const reasons: string[] = [];

  // 1) Reschedule to a completely free slot (resolves any clash type, keeps staff/room).
  const rc = rescheduleCandidates(session, working);
  if (rc.length && rc[0].free) {
    const c = rc[0];
    return {
      sessions: applyReschedule(working, session.rowId, c.day, c.startMin, c.endMin),
      step: {
        rowId: session.rowId,
        unitCode: session.unitCode,
        action: "reschedule",
        from: `${session.day} ${session.timeRaw}`,
        to: c.label,
      },
    };
  }
  reasons.push("No completely free time slot is available for this class in this term.");

  // 2) For lecturer clashes, transfer to an available lecturer.
  if (kinds.lecturer && session.lecturer !== null) {
    const tc = transferCandidates(session, working, opts);
    const best = tc.find((c) => c.available && c.projectedStatus !== "Overloaded") ?? tc.find((c) => c.available);
    if (best) {
      return {
        sessions: applyTransfer(working, session.rowId, best.lecturer),
        step: {
          rowId: session.rowId,
          unitCode: session.unitCode,
          action: "transfer",
          from: session.lecturer,
          to: best.lecturer,
        },
      };
    }
    reasons.push("No other lecturer is free at this time without exceeding their weekly limit.");
  }

  // 3) For room clashes, move to a free room that fits.
  if (kinds.room && session.room !== null && !session.isVirtualRoom && opts.roomRegistry) {
    const rooms = roomCandidates(session, working, opts.roomRegistry, opts.capacityTolerance ?? 0);
    const best = rooms.find((r) => r.available && r.fits) ?? rooms.find((r) => r.available);
    if (best) {
      return {
        sessions: applyRoomChange(working, session.rowId, best.room),
        step: {
          rowId: session.rowId,
          unitCode: session.unitCode,
          action: "room",
          from: session.room,
          to: best.room,
        },
      };
    }
    reasons.push("No free room of adequate capacity is available at this time.");
  }

  if (kinds.cohort) {
    reasons.push("The student cohort is already booked elsewhere at every alternative slot tried.");
  }

  return { reasons };
}

interface RunOptions {
  lecturer?: string; // limit to conflicts involving this lecturer
  types?: ("lecturer" | "room" | "batch_code")[];
  maxIterations?: number;
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
  const types = run.types ?? ["lecturer", "room", "batch_code"];
  const kinds = {
    lecturer: types.includes("lecturer"),
    room: types.includes("room"),
    cohort: types.includes("batch_code"),
  };
  let working = sessions.map((s) => ({ ...s }));
  const steps: ResolutionStep[] = [];
  const stuck = new Set<number>(); // rowIds we've already failed to relocate
  const maxIter = run.maxIterations ?? 500;

  const relevant = () => {
    const cs = types.flatMap((t) => detectClashes(working, t));
    return run.lecturer
      ? cs.filter(
          (c) =>
            (c.clashType === "lecturer" && c.groupValue === run.lecturer) ||
            c.lecturer1 === run.lecturer ||
            c.lecturer2 === run.lecturer,
        )
      : cs;
  };

  for (let i = 0; i < maxIter; i++) {
    const clashes = relevant().filter((c) => !stuck.has(c.rowId1) || !stuck.has(c.rowId2));
    if (clashes.length === 0) break;
    const c = clashes[0];
    const a = working.find((s) => s.rowId === c.rowId1)!;
    const b = working.find((s) => s.rowId === c.rowId2)!;
    // Prefer to move a session we haven't marked stuck yet.
    const order = [pickMover(a, b), a.rowId === pickMover(a, b).rowId ? b : a].filter(
      (s, idx, arr) => arr.findIndex((x) => x.rowId === s.rowId) === idx,
    );
    let progressed = false;
    for (const mover of order) {
      if (stuck.has(mover.rowId)) continue;
      const res = relocate(working, mover, opts, kinds);
      if ("step" in res) {
        working = res.sessions;
        steps.push(res.step);
        progressed = true;
        break;
      } else {
        stuck.add(mover.rowId);
      }
    }
    if (!progressed) {
      // both sides stuck — leave the loop's stuck set to prevent re-tries
      stuck.add(c.rowId1);
      stuck.add(c.rowId2);
    }
  }

  // Build unresolved report for any remaining conflicting sessions.
  const remaining = relevant();
  const unresolvedMap = new Map<number, Unresolved>();
  for (const c of remaining) {
    for (const rowId of [c.rowId1, c.rowId2]) {
      const s = working.find((x) => x.rowId === rowId);
      if (!s) continue;
      const res = relocate(working, s, opts, kinds);
      const reasons = "reasons" in res ? res.reasons : ["Still in conflict after resolution."];
      unresolvedMap.set(rowId, { rowId, unitCode: s.unitCode, reasons });
    }
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
  if (!canReschedule) reasons.push("No free time slot to move this class to.");

  const canTransfer =
    session.lecturer !== null && transferCandidates(session, sessions, opts).some((c) => c.available);
  if (session.lecturer !== null && !canTransfer)
    reasons.push("No other lecturer is available at this time.");

  const canMoveRoom =
    session.room !== null && !session.isVirtualRoom && !!opts.roomRegistry &&
    roomCandidates(session, sessions, opts.roomRegistry, opts.capacityTolerance ?? 0).some((r) => r.available);
  if (session.room !== null && !session.isVirtualRoom && !canMoveRoom)
    reasons.push("No free room is available at this time.");

  return { canReschedule, canTransfer, canMoveRoom, reasons };
}
