"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightLeft, CheckCircle2, DoorOpen, User, Users, Clock, Wand2, Info,
} from "lucide-react";
import { useFilteredSessions, useAnalysis } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { Card, EmptyState, SectionTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clash, Session } from "@/lib/types";
import { ResolutionPanel } from "@/components/resolution-panel";
import { ResolveResult } from "@/lib/resolve";

type Filter = "all" | "lecturer" | "room" | "batch_code";

function useResolveOpts() {
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const subjectAssignments = useStore((s) => s.subjectAssignments);
  const thresholds = useStore((s) => s.thresholds);
  const roomRegistry = useStore((s) => s.roomRegistry);
  return useMemo(
    () => ({
      roleRegistry, roleMaxHours, departmentRegistry, subjectAssignments, thresholds,
      roomRegistry, capacityTolerance: thresholds.capacityTolerance,
    }),
    [roleRegistry, roleMaxHours, departmentRegistry, subjectAssignments, thresholds, roomRegistry],
  );
}

export function ResolvePage() {
  // Detect conflicts over the FULL term, not the sidebar-filtered subset: a room or
  // cohort clash needs both colliding sessions present, and a sidebar filter could
  // remove the counterpart — hiding a real, unresolved double-booking.
  const { termSessions } = useFilteredSessions();
  const { clashes, summary } = useAnalysis(termSessions);
  const autoResolve = useStore((s) => s.autoResolve);
  const opts = useResolveOpts();
  const [filter, setFilter] = useState<Filter>("all");
  const [result, setResult] = useState<ResolveResult | null>(null);

  const groups = useMemo(() => groupClashes(clashes), [clashes]);
  const shown = filter === "all" ? groups : groups.filter((g) => g.clashType === filter);

  const resolveAll = () => {
    const types = filter === "all" ? undefined : ([filter] as ("lecturer" | "room" | "batch_code")[]);
    setResult(autoResolve(opts, { types }));
  };

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
            Fix each conflict in place — transfer to another lecturer, move room, or reschedule.
            Candidates are ranked so you never trade one clash for another. Or let the assistant
            resolve everything at once and tell you exactly what it couldn&apos;t fix.
          </p>
        </div>
        <Button variant="primary" onClick={resolveAll} disabled={groups.length === 0}>
          <Wand2 size={15} /> Auto-resolve {filter === "all" ? "all" : filter}
        </Button>
      </div>

      {result && <ResolveReport result={result} onDismiss={() => setResult(null)} />}

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

function ResolveReport({ result, onDismiss }: { result: ResolveResult; onDismiss: () => void }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <SectionTitle className="mb-0 border-0 pb-0">
          <Wand2 size={14} className="inline mr-1.5 text-brass" />
          Auto-resolve results
        </SectionTitle>
        <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="good">{result.steps.length} changes applied</Badge>
        {result.unresolved.length > 0 ? (
          <Badge tone="warn">{result.unresolved.length} still need attention</Badge>
        ) : (
          <Badge tone="good">All targeted conflicts cleared</Badge>
        )}
      </div>

      {result.steps.length > 0 && (
        <div className="max-h-40 overflow-auto rounded border border-rule divide-y divide-rule/60">
          {result.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
              <Badge tone={s.action === "transfer" ? "info" : s.action === "room" ? "warn" : "brass"}>
                {s.action}
              </Badge>
              <span className="font-mono text-ink">{s.unitCode ?? `#${s.rowId}`}</span>
              <span className="text-muted truncate">
                {s.from} <ArrowRightLeft size={10} className="inline mx-0.5" /> {s.to}
              </span>
            </div>
          ))}
        </div>
      )}

      {result.unresolved.length > 0 && (
        <div className="rounded border border-warn/30 bg-warn/10 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-content">
            <Info size={13} className="text-warn" /> Couldn&apos;t auto-resolve these — here&apos;s why:
          </div>
          {result.unresolved.map((u) => (
            <div key={u.rowId} className="text-xs text-content">
              <span className="font-mono text-ink">{u.unitCode ?? `#${u.rowId}`}</span>{" "}
              <span className="text-muted">— {u.reasons.join(" ")}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

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
  const autoResolve = useStore((s) => s.autoResolve);
  const opts = useResolveOpts();
  const meta = TYPE_META[group.clashType];
  const rows = group.rowIds
    .map((id) => sessions.find((s) => s.rowId === id))
    .filter((s): s is Session => !!s);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);

  const resolveGroup = () => {
    if (group.clashType === "lecturer") autoResolve(opts, { lecturer: group.groupValue, types: ["lecturer"] });
    else autoResolve(opts, { types: [group.clashType] });
  };

  if (rows.length < 2) return null; // group already cleared by a prior fix

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-2/40 border-b border-rule flex-wrap">
        <span className="text-brass">{meta.icon}</span>
        <span className="font-medium text-ink text-sm">{meta.label}</span>
        <Badge tone={meta.tone}>
          {meta.noun}: {group.groupValue}
        </Badge>
        <span className="text-xs text-muted flex items-center gap-1">
          <Clock size={12} /> {group.day}
        </span>
        <span className="text-xs text-muted">{rows.length} sessions in conflict</span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={resolveGroup}>
          <Wand2 size={12} /> Auto-fix this
        </Button>
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

function SessionRow({
  session, clashType, open, onToggle,
}: {
  session: Session;
  clashType: Clash["clashType"];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <span className="font-mono text-xs text-muted w-8 shrink-0">#{session.rowId}</span>
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
        <Button size="sm" variant={open ? "primary" : "outline"} onClick={onToggle}>
          <ArrowRightLeft size={13} /> {open ? "Close" : "Fix"}
        </Button>
      </div>
      {open && (
        <div className="px-4 pb-4 animate-fade">
          <ResolutionPanel session={session} clashType={clashType} onDone={onToggle} />
        </div>
      )}
    </div>
  );
}
