"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRightLeft, CheckCircle2, DoorOpen, User, Users, Clock,
} from "lucide-react";
import { useFilteredSessions, useAnalysis } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { Card, EmptyState, SectionTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clash, Session } from "@/lib/types";
import {
  transferCandidates, roomCandidates, rescheduleCandidates,
  UNASSIGN, TransferCandidate, RoomCandidate, RescheduleCandidate,
} from "@/lib/transfer";
import { fmtHours } from "@/lib/cn";

type Filter = "all" | "lecturer" | "room" | "batch_code";

export function ResolvePage() {
  // Detect conflicts over the FULL term, not the sidebar-filtered subset: a room or
  // cohort clash needs both colliding sessions present, and a sidebar filter could
  // remove the counterpart — hiding a real, unresolved double-booking. Resolve is
  // about clearing every conflict in the term, so it always sees the whole term.
  const { termSessions } = useFilteredSessions();
  const { clashes, summary } = useAnalysis(termSessions);
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => groupClashes(clashes), [clashes]);
  const shown = filter === "all" ? groups : groups.filter((g) => g.clashType === filter);

  const chip = (id: Filter, label: string, n: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      className={`rounded-full px-3 py-1 text-sm border transition ${
        filter === id ? "bg-brass border-brass text-white" : "border-rule text-muted hover:text-ink"
      }`}
    >
      {label} <span className="font-mono">{n}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">Resolve Conflicts</h1>
          <p className="text-sm text-muted mt-0.5 max-w-2xl">
            Each conflict below can be fixed in place — transfer a session to another lecturer
            (or room). Candidates are ranked by availability, teaching fit and remaining workload,
            so you never trade one clash for another.
          </p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {chip("all", "All", groups.length)}
        {chip("lecturer", "Lecturer", summary.lecturerClashes)}
        {chip("room", "Room", summary.roomClashes)}
        {chip("batch_code", "Cohort", summary.cohortClashes)}
      </div>

      {shown.length === 0 ? (
        <EmptyState>
          <CheckCircle2 className="inline mr-1.5 text-good" size={18} />
          No conflicts of this type in the current term. 🎉
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {shown.map((g) => (
            <ConflictCard key={g.key} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- grouping ----

interface ConflictGroup {
  key: string;
  clashType: Clash["clashType"];
  day: string;
  groupValue: string;
  rowIds: number[];
  clashes: Clash[];
}

function groupClashes(clashes: Clash[]): ConflictGroup[] {
  const map = new Map<string, ConflictGroup>();
  for (const c of clashes) {
    const key = `${c.clashType}||${c.day}||${c.groupValue}`;
    let g = map.get(key);
    if (!g) {
      g = { key, clashType: c.clashType, day: c.day, groupValue: c.groupValue, rowIds: [], clashes: [] };
      map.set(key, g);
    }
    g.clashes.push(c);
    for (const rid of [c.rowId1, c.rowId2]) if (!g.rowIds.includes(rid)) g.rowIds.push(rid);
  }
  const order = { lecturer: 0, room: 1, batch_code: 2 };
  return [...map.values()].sort(
    (a, b) => order[a.clashType] - order[b.clashType] || b.rowIds.length - a.rowIds.length,
  );
}

const TYPE_META = {
  lecturer: { icon: <User size={15} />, label: "Lecturer double-booking", tone: "danger" as const, noun: "Lecturer" },
  room: { icon: <DoorOpen size={15} />, label: "Room double-booking", tone: "warn" as const, noun: "Room" },
  batch_code: { icon: <Users size={15} />, label: "Cohort double-booking", tone: "info" as const, noun: "Cohort" },
};

function ConflictCard({ group }: { group: ConflictGroup }) {
  const sessions = useStore((s) => s.sessions);
  const meta = TYPE_META[group.clashType];
  const rows = group.rowIds
    .map((id) => sessions.find((s) => s.rowId === id))
    .filter((s): s is Session => !!s);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-2/40 border-b border-rule">
        <span className="text-brass">{meta.icon}</span>
        <span className="font-medium text-ink text-sm">{meta.label}</span>
        <Badge tone={meta.tone}>
          {meta.noun}: {group.groupValue}
        </Badge>
        <span className="text-xs text-muted flex items-center gap-1">
          <Clock size={12} /> {group.day}
        </span>
        <span className="ml-auto text-xs text-muted">{rows.length} sessions in conflict</span>
      </div>

      <div className="divide-y divide-rule/60">
        {rows.map((s) => (
          <SessionRow
            key={s.rowId}
            session={s}
            clashType={group.clashType}
            open={resolvingRow === s.rowId}
            onToggle={() => setResolvingRow(resolvingRow === s.rowId ? null : s.rowId)}
          />
        ))}
      </div>
    </Card>
  );
}

type Remedy = "transfer" | "room" | "reschedule";

function SessionRow({
  session, clashType, open, onToggle,
}: {
  session: Session;
  clashType: Clash["clashType"];
  open: boolean;
  onToggle: () => void;
}) {
  // Primary remedy per conflict type: lecturer clash -> transfer; room clash ->
  // move room; cohort clash -> reschedule (transferring a lecturer or room does
  // NOT free a double-booked student cohort). Reschedule is offered as an
  // alternative for the others too.
  const primary: Remedy = clashType === "room" ? "room" : clashType === "batch_code" ? "reschedule" : "transfer";
  const [remedy, setRemedy] = useState<Remedy>(primary);

  const remedies: { id: Remedy; label: string }[] = [
    ...(clashType === "lecturer" ? [{ id: "transfer" as Remedy, label: "Transfer lecturer" }] : []),
    ...(clashType === "room" ? [{ id: "room" as Remedy, label: "Move room" }] : []),
    { id: "reschedule" as Remedy, label: "Reschedule" },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <span className="font-mono text-xs text-muted w-8">#{session.rowId}</span>
        <div className="flex-1 min-w-0">
          <div className="text-ink truncate">
            <span className="font-medium">{session.unitCode}</span>
            <span className="text-muted"> {session.unitName}</span>
          </div>
          <div className="text-xs text-muted truncate">
            {session.programme} · {session.batchCode} · {session.timeRaw} · Rm {session.room ?? "—"} ·{" "}
            {session.lecturer ?? "TBA"}
          </div>
        </div>
        <Button
          size="sm"
          variant={open ? "primary" : "outline"}
          onClick={() => {
            setRemedy(primary);
            onToggle();
          }}
        >
          <ArrowRightLeft size={13} /> {open ? "Close" : "Fix"}
        </Button>
      </div>
      {open && (
        <div className="px-4 pb-4 animate-fade space-y-2">
          {remedies.length > 1 && (
            <div className="flex gap-1.5">
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
          )}
          {remedy === "room" && <RoomTransferPanel session={session} onDone={onToggle} />}
          {remedy === "transfer" && <LecturerTransferPanel session={session} onDone={onToggle} />}
          {remedy === "reschedule" && <ReschedulePanel session={session} onDone={onToggle} />}
        </div>
      )}
    </div>
  );
}

function LecturerTransferPanel({ session, onDone }: { session: Session; onDone: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const thresholds = useStore((s) => s.thresholds);
  const transfer = useStore((s) => s.transferLecturer);
  const [showAll, setShowAll] = useState(false);

  const candidates = useMemo(
    () =>
      transferCandidates(session, sessions, {
        roleRegistry, roleMaxHours, departmentRegistry, thresholds, includeUnavailable: showAll,
      }),
    [session, sessions, roleRegistry, roleMaxHours, departmentRegistry, thresholds, showAll],
  );

  const doTransfer = (lecturer: string) => {
    transfer(session.rowId, lecturer);
    onDone();
  };

  return (
    <div className="rounded-card border border-rule bg-parchment/40 p-3">
      <div className="flex items-center justify-between mb-2">
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
          No free lecturer available at this slot. Try “show unavailable”, unassign, or change the time/room.
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
  const statusTone = c.projectedStatus === "Overloaded" ? "danger" : c.projectedStatus === "Balanced" ? "good" : "warn";
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!c.available}
      className={`text-left rounded border p-2.5 transition ${
        c.available ? "border-rule bg-surface hover:border-brass hover:shadow-sm" : "border-rule/50 bg-surface/40 opacity-60 cursor-not-allowed"
      } ${c.recommended ? "ring-1 ring-brass" : ""}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-medium text-sm text-ink truncate flex-1">{c.lecturer}</span>
        {c.recommended && <Badge tone="brass">Best</Badge>}
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        <Badge tone="neutral">{c.role}</Badge>
        {c.teachesSameUnit && <Badge tone="good">same unit</Badge>}
        {!c.teachesSameUnit && c.sameDepartment && <Badge tone="info">same dept</Badge>}
      </div>
      <div className="text-[0.7rem] text-muted space-y-0.5">
        <div className="flex justify-between">
          <span>Now</span>
          <span className="font-mono">{fmtHours(c.currentHours)}/{c.maxHours}h</span>
        </div>
        <div className="flex justify-between">
          <span>After</span>
          <span className="font-mono">
            {fmtHours(c.projectedHours)}/{c.maxHours}h
          </span>
        </div>
        <div className="pt-0.5">
          <Badge tone={statusTone as "danger" | "good" | "warn"}>{c.projectedStatus}</Badge>
        </div>
        {!c.available && c.conflictReason && (
          <div className="flex items-center gap-1 text-danger pt-0.5">
            <AlertTriangle size={11} /> {c.conflictReason}
          </div>
        )}
      </div>
    </button>
  );
}

function RoomTransferPanel({ session, onDone }: { session: Session; onDone: () => void }) {
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
    onDone();
  };

  return (
    <div className="rounded-card border border-rule bg-parchment/40 p-3">
      <SectionTitle className="mb-2">
        Move <span className="font-mono">{session.unitCode}</span> (head count {session.headCount ?? "?"}) to a free room…
      </SectionTitle>
      {candidates.length === 0 ? (
        <p className="text-xs text-muted py-2">No free room available at this slot.</p>
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

function ReschedulePanel({ session, onDone }: { session: Session; onDone: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const reschedule = useStore((s) => s.reschedule);
  const candidates = useMemo(() => rescheduleCandidates(session, sessions), [session, sessions]);

  const pick = (c: RescheduleCandidate) => {
    reschedule(session.rowId, c.day, c.startMin, c.endMin);
    onDone();
  };

  return (
    <div className="rounded-card border border-rule bg-parchment/40 p-3">
      <SectionTitle className="mb-2">
        Reschedule <span className="font-mono">{session.unitCode}</span> to a free slot (no
        lecturer, room or cohort clash)…
      </SectionTitle>
      {candidates.length === 0 ? (
        <p className="text-xs text-muted py-2">
          No completely-free slot in this term. Try transferring the lecturer/room instead, or
          relax a constraint.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {candidates.slice(0, 30).map((c) => (
            <button
              key={`${c.day}-${c.startMin}-${c.endMin}`}
              type="button"
              onClick={() => pick(c)}
              className={`rounded border p-2 text-left transition bg-surface hover:border-brass hover:shadow-sm ${
                c.recommended ? "ring-1 ring-brass border-brass" : "border-rule"
              }`}
            >
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs font-semibold text-ink">{c.day}</span>
                {c.recommended && <Badge tone="brass">Best</Badge>}
              </div>
              <div className="text-[0.7rem] text-muted mt-0.5">
                {c.label.replace(`${c.day} `, "")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
