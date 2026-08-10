"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useStore } from "@/store/useStore";
import { Session } from "@/lib/types";
import {
  transferCandidates, roomCandidates, reschedulePlans, rescheduleBlockers,
  UNASSIGN, TransferCandidate, RoomCandidate, ReschedulePlan,
} from "@/lib/transfer";
import { explainSession } from "@/lib/resolve";
import { toast } from "@/store/useToast";
import { Badge } from "@/components/ui/badge";
import { FacultyTypeBadge } from "@/components/ui/faculty-badge";

/** Toast options that add a quick "Undo" button and give the user longer to click it. */
const undoToast = {
  action: { label: "Undo", onClick: () => useStore.getState().undo() },
  duration: 9000,
};
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { fmtHours } from "@/lib/cn";

export type Remedy = "transfer" | "room" | "reschedule";
type ClashType = "lecturer" | "room" | "batch_code";

function useResolveOpts() {
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const subjectAssignments = useStore((s) => s.subjectAssignments);
  const facultyTypeRegistry = useStore((s) => s.facultyTypeRegistry);
  const thresholds = useStore((s) => s.thresholds);
  const roomRegistry = useStore((s) => s.roomRegistry);
  return {
    roleRegistry, roleMaxHours, departmentRegistry, subjectAssignments,
    facultyTypeRegistry, thresholds, roomRegistry,
  };
}

/**
 * Self-contained conflict-resolution UI for a single session. Offers the right
 * remedies for the clash type, ranks candidates, and explains — in plain
 * language — exactly why any remedy is unavailable. Reused by the Resolve page
 * and the Master Timetable's click-to-resolve panel.
 */
export function ResolutionPanel({
  session,
  clashType,
  onDone,
}: {
  session: Session;
  clashType?: ClashType;
  onDone: () => void;
}) {
  const sessions = useStore((s) => s.sessions);
  const opts = useResolveOpts();

  const explain = useMemo(
    () =>
      explainSession(session, sessions, {
        roleRegistry: opts.roleRegistry,
        roleMaxHours: opts.roleMaxHours,
        departmentRegistry: opts.departmentRegistry,
        subjectAssignments: opts.subjectAssignments,
        thresholds: opts.thresholds,
        roomRegistry: opts.roomRegistry,
        capacityTolerance: opts.thresholds.capacityTolerance,
      }),
    [session, sessions, opts],
  );

  const primary: Remedy =
    clashType === "room" ? "room" : clashType === "batch_code" ? "reschedule" : "transfer";
  const [remedy, setRemedy] = useState<Remedy>(primary);

  const canRoom = session.room !== null && !session.isVirtualRoom;
  const remedies: { id: Remedy; label: string; enabled: boolean }[] = (
    [
      { id: "transfer", label: "Transfer lecturer", enabled: session.lecturer !== null },
      { id: "room", label: "Move room", enabled: canRoom },
      { id: "reschedule", label: "Reschedule", enabled: true },
    ] as { id: Remedy; label: string; enabled: boolean }[]
  ).filter((r) => r.enabled);

  return (
    <div className="space-y-2.5">
      {explain.reasons.length > 0 && (
        <div className="flex items-start gap-1.5 rounded border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-xs text-content">
          <Info size={13} className="text-warn mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">Constraints in play: </span>
            {explain.reasons.join(" ")}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {remedies.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRemedy(r.id)}
            className={`rounded px-2.5 py-1 text-xs border transition ${
              remedy === r.id ? "bg-ink text-parchment border-ink" : "border-rule text-muted hover:text-ink"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {remedy === "room" && <RoomTransferPanel session={session} onDone={onDone} />}
      {remedy === "transfer" && <LecturerTransferPanel session={session} onDone={onDone} />}
      {remedy === "reschedule" && <ReschedulePanel session={session} onDone={onDone} />}
    </div>
  );
}

export function LecturerTransferPanel({ session, onDone }: { session: Session; onDone: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const opts = useResolveOpts();
  const transfer = useStore((s) => s.transferLecturer);
  const [showAll, setShowAll] = useState(false);

  const candidates = useMemo(
    () =>
      transferCandidates(session, sessions, {
        roleRegistry: opts.roleRegistry,
        roleMaxHours: opts.roleMaxHours,
        departmentRegistry: opts.departmentRegistry,
        subjectAssignments: opts.subjectAssignments,
        facultyTypeRegistry: opts.facultyTypeRegistry,
        roomRegistry: opts.roomRegistry,
        thresholds: opts.thresholds,
        includeUnavailable: showAll,
      }),
    [session, sessions, opts, showAll],
  );

  const doTransfer = (lecturer: string) => {
    transfer(session.rowId, lecturer);
    toast.success(
      lecturer === UNASSIGN
        ? `${session.unitCode ?? "Session"} set to TBA (unassigned).`
        : `${session.unitCode ?? "Session"} reassigned to ${lecturer}.`,
      "Lecturer transferred",
      undoToast,
    );
    onDone();
  };

  return (
    <div className="rounded-card border border-rule bg-surface-2 p-3">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <SectionTitle className="mb-0 border-0 pb-0">
          Transfer <span className="font-mono">{session.unitCode}</span> to…
        </SectionTitle>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted flex items-center gap-1">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            show unavailable
          </label>
          <Button size="sm" variant="danger" onClick={() => doTransfer(UNASSIGN)}>
            Unassign (TBA)
          </Button>
        </div>
      </div>
      {candidates.length === 0 ? (
        <p className="text-xs text-muted py-2">
          No lecturer is free at this slot without breaking a rule. Try “show unavailable”, unassign,
          or reschedule the class instead.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {candidates.slice(0, showAll ? 60 : 12).map((c) => (
            <CandidateChip key={c.lecturer} c={c} onPick={() => doTransfer(c.lecturer)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateChip({ c, onPick }: { c: TransferCandidate; onPick: () => void }) {
  const statusTone = c.wouldOverload ? "danger" : c.projectedStatus === "Balanced" ? "good" : c.projectedStatus === "Flexible" ? "info" : "warn";
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!c.available}
      className={`text-left rounded border p-2.5 transition min-w-0 ${
        c.available ? "border-rule bg-surface hover:border-brass hover:shadow-sm" : "border-rule/50 bg-surface/40 opacity-60 cursor-not-allowed"
      } ${c.recommended ? "ring-1 ring-brass" : ""}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-medium text-sm text-ink truncate flex-1 min-w-0">{c.lecturer}</span>
        {c.recommended && <Badge tone="brass">Best</Badge>}
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        <Badge tone="neutral">{c.role}</Badge>
        <FacultyTypeBadge type={c.facultyType} />
        {c.assignedSubject && <Badge tone="good">assigned</Badge>}
        {!c.assignedSubject && c.teachesSameUnit && <Badge tone="good">same unit</Badge>}
        {!c.assignedSubject && !c.teachesSameUnit && c.sameDepartment && <Badge tone="info">same dept</Badge>}
      </div>
      <div className="text-[0.7rem] text-muted space-y-0.5">
        <div className="flex justify-between gap-2">
          <span>Now</span>
          <span className="font-mono">{fmtHours(c.currentHours)}/{c.maxHours}h</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>After</span>
          <span className="font-mono">{fmtHours(c.projectedHours)}/{c.maxHours}h</span>
        </div>
        <div className="pt-0.5">
          <Badge tone={statusTone as "danger" | "good" | "warn" | "info"}>{c.projectedStatus}</Badge>
        </div>
        {c.conflictReason && (
          <div className="flex items-start gap-1 text-danger pt-0.5">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" /> <span>{c.conflictReason}</span>
          </div>
        )}
      </div>
    </button>
  );
}

export function RoomTransferPanel({ session, onDone }: { session: Session; onDone: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const roomRegistry = useStore((s) => s.roomRegistry);
  const thresholds = useStore((s) => s.thresholds);
  const changeRoom = useStore((s) => s.changeRoom);

  const candidates = useMemo(
    () => roomCandidates(session, sessions, roomRegistry, thresholds.capacityTolerance),
    [session, sessions, roomRegistry, thresholds.capacityTolerance],
  );

  const pick = (room: string) => {
    changeRoom(session.rowId, room);
    toast.success(`${session.unitCode ?? "Session"} moved to room ${room}.`, "Room changed", undoToast);
    onDone();
  };

  return (
    <div className="rounded-card border border-rule bg-surface-2 p-3">
      <SectionTitle className="mb-2">
        Move <span className="font-mono">{session.unitCode}</span> (head count {session.headCount ?? "?"}) to a free room…
      </SectionTitle>
      {candidates.length === 0 ? (
        <p className="text-xs text-muted py-2">
          No room is free at this time. Reschedule the class or move the class it collides with.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {candidates.slice(0, 24).map((c) => (
            <RoomChip key={c.room} c={c} onPick={() => pick(c.room)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RoomChip({ c, onPick }: { c: RoomCandidate; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`rounded border p-2 min-w-[92px] text-left transition bg-surface hover:border-brass hover:shadow-sm ${
        c.recommended ? "ring-1 ring-brass border-brass" : "border-rule"
      }`}
    >
      <div className="flex items-center gap-1">
        <span className="font-mono font-semibold text-ink text-sm">{c.room}</span>
        {c.recommended && <Badge tone="brass">Best</Badge>}
      </div>
      <div className="text-[0.7rem] text-muted mt-0.5">
        cap {c.capacity ?? "?"} {c.fits ? "" : "· tight"}
      </div>
    </button>
  );
}

export function ReschedulePanel({ session, onDone }: { session: Session; onDone: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const applyPlan = useStore((s) => s.applyPlan);
  const opts = useResolveOpts();
  const [allowRoomChange, setAllowRoomChange] = useState(true);
  const [allowLecturerChange, setAllowLecturerChange] = useState(true);

  // Honour every configured rule (Saturday window, per-day caps, role limits,
  // faculty types, room capacity) so only genuinely compliant plans are offered.
  const validateOpts = useMemo(
    () => ({
      roleRegistry: opts.roleRegistry,
      roleMaxHours: opts.roleMaxHours,
      facultyTypeRegistry: opts.facultyTypeRegistry,
      roomRegistry: opts.roomRegistry,
      thresholds: opts.thresholds,
    }),
    [opts],
  );

  const plans = useMemo(
    () => reschedulePlans(session, sessions, { ...validateOpts, allowRoomChange, allowLecturerChange }),
    [session, sessions, validateOpts, allowRoomChange, allowLecturerChange],
  );

  const blockers = useMemo(
    () => (plans.length === 0 ? rescheduleBlockers(session, sessions, validateOpts) : []),
    [plans.length, session, sessions, validateOpts],
  );

  const pick = (p: ReschedulePlan) => {
    applyPlan(session.rowId, p);
    toast.success(
      `${session.unitCode ?? "Session"} moved to ${p.slotLabel}${
        p.changes.length ? ` (${p.changes.join(", ")})` : ""
      }.`,
      "Rescheduled",
      undoToast,
    );
    onDone();
  };

  return (
    <div className="rounded-card border border-rule bg-surface-2 p-3">
      <SectionTitle className="mb-2">
        Reschedule <span className="font-mono">{session.unitCode}</span> — every option below is
        checked against all lecturers, rooms, slots and rules
      </SectionTitle>

      <div className="flex flex-wrap items-center gap-3 mb-2.5 text-xs text-muted">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={allowRoomChange}
            onChange={(e) => setAllowRoomChange(e.target.checked)}
            className="accent-brass"
          />
          Allow a different room
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={allowLecturerChange}
            onChange={(e) => setAllowLecturerChange(e.target.checked)}
            className="accent-brass"
          />
          Allow a different lecturer (only if nothing else fits)
        </label>
        <span className="ml-auto font-mono">
          {plans.length} valid option{plans.length === 1 ? "" : "s"}
        </span>
      </div>

      {plans.length === 0 ? (
        <div className="rounded border border-warn/30 bg-warn/10 px-2.5 py-2 text-xs text-content space-y-1">
          <div className="flex items-start gap-1.5">
            <Info size={13} className="text-warn mt-0.5 shrink-0" />
            <div>
              <span className="font-medium">No conflict-free slot exists for this class.</span>{" "}
              {blockers.join(" ")}
            </div>
          </div>
          {(!allowRoomChange || !allowLecturerChange) && (
            <p className="pl-5 text-muted">
              Tick the boxes above to let the assistant also move the room or hand the class to a
              free colleague.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {plans.map((p) => (
            <button
              key={`${p.day}-${p.startMin}-${p.endMin}-${p.room ?? ""}-${p.lecturer ?? ""}`}
              type="button"
              onClick={() => pick(p)}
              aria-label={p.label}
              title={`${p.label}${p.capacityWarning ? ` — ${p.capacityWarning}` : ""}`}
              className={`rounded border p-2 text-left transition bg-surface hover:border-brass hover:shadow-sm ${
                p.recommended ? "ring-1 ring-brass border-brass" : "border-rule"
              }`}
            >
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs font-semibold text-ink">{p.day}</span>
                {p.recommended && <Badge tone="brass">Best</Badge>}
                {!p.roomChanged && !p.lecturerChanged && <Badge tone="good">same room</Badge>}
              </div>
              <div className="text-[0.7rem] text-muted mt-0.5">
                {p.slotLabel.replace(`${p.day} `, "")}
              </div>
              {p.changes.length > 0 && (
                <div className="text-[0.66rem] text-brass mt-0.5">{p.changes.join(" · ")}</div>
              )}
              {p.capacityWarning && (
                <div className="text-[0.62rem] text-warn mt-0.5">tight fit</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
