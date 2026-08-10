"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightLeft, CheckCircle2, DoorOpen, User, Users, Clock, Wand2, Info, Loader2, ShieldAlert,
  Merge, Link2, GraduationCap,
} from "lucide-react";
import { useFilteredSessions, useAnalysis, useMergeableGroups } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { Card, EmptyState, SectionTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clash, DAY_NAME, Session } from "@/lib/types";
import { chipProps } from "@/lib/colors";
import { cn } from "@/lib/cn";
import { ResolutionPanel } from "@/components/resolution-panel";
import { FacultyTypeBadge } from "@/components/ui/faculty-badge";
import { ResolveResult } from "@/lib/resolve";
import { detectRuleViolations } from "@/lib/validate";
import { effectiveFacultyType } from "@/lib/facultyType";
import { MergeGroup, mergeableGroupsTouching } from "@/lib/merge";
import { toast } from "@/store/useToast";

type Filter = "all" | "lecturer" | "room" | "batch_code";

/** Announce the outcome of an auto-resolve run via a toast. */
function announceResolve(r: ResolveResult) {
  const undo = {
    action: { label: "Undo", onClick: () => useStore.getState().undo() },
    duration: 9000,
  };
  if (r.steps.length === 0 && r.unresolved.length === 0) {
    toast.info("Nothing to resolve — no conflicts here.");
  } else if (r.unresolved.length === 0) {
    toast.success(
      `Applied ${r.steps.length} change${r.steps.length === 1 ? "" : "s"} — all targeted conflicts cleared.`,
      "Conflicts resolved",
      r.steps.length > 0 ? undo : undefined,
    );
  } else {
    toast.warn(
      `Applied ${r.steps.length} change${r.steps.length === 1 ? "" : "s"}; ${r.unresolved.length} still need attention.`,
      "Partially resolved",
      r.steps.length > 0 ? undo : undefined,
    );
  }
}

function useResolveOpts() {
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const subjectAssignments = useStore((s) => s.subjectAssignments);
  const facultyTypeRegistry = useStore((s) => s.facultyTypeRegistry);
  const thresholds = useStore((s) => s.thresholds);
  const roomRegistry = useStore((s) => s.roomRegistry);
  return useMemo(
    () => ({
      roleRegistry, roleMaxHours, departmentRegistry, subjectAssignments, facultyTypeRegistry, thresholds,
      roomRegistry, capacityTolerance: thresholds.capacityTolerance,
    }),
    [roleRegistry, roleMaxHours, departmentRegistry, subjectAssignments, facultyTypeRegistry, thresholds, roomRegistry],
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
  const [resolving, setResolving] = useState(false);

  const groups = useMemo(() => groupClashes(clashes), [clashes]);
  const shown = filter === "all" ? groups : groups.filter((g) => g.clashType === filter);

  const resolveAll = () => {
    if (resolving) return;
    const types = filter === "all" ? undefined : ([filter] as ("lecturer" | "room" | "batch_code")[]);
    setResolving(true);
    requestAnimationFrame(() => setTimeout(() => {
      try {
        const r = autoResolve(opts, { types });
        setResult(r);
        announceResolve(r);
      } finally {
        setResolving(false);
      }
    }, 0));
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
        <Button variant="primary" onClick={resolveAll} disabled={groups.length === 0 || resolving}>
          {resolving ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Resolving…
            </>
          ) : (
            <>
              <Wand2 size={15} /> Auto-resolve {filter === "all" ? "all" : filter}
            </>
          )}
        </Button>
      </div>

      {result && <ResolveReport result={result} onDismiss={() => setResult(null)} />}

      <MergeSimilarCourses sessions={termSessions} />

      <PolicyViolations sessions={termSessions} opts={opts} />

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
  const unresolvedGroups = useMemo(() => groupUnresolved(result.unresolved), [result.unresolved]);

  return (
    <Card className="p-4 space-y-3 max-h-[calc(100vh-8rem)] overflow-y-auto">
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
        <div className="rounded border border-rule overflow-hidden">
          <div className="px-2.5 py-1.5 text-xs font-medium text-content bg-surface-2/40 border-b border-rule">
            Changes applied ({result.steps.length})
          </div>
          <div className="max-h-[26rem] overflow-auto divide-y divide-rule/60">
            {result.steps.map((s, i) => {
              const p = stepPhrase(s);
              return (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2 text-xs">
                  <Badge tone={p.tone}>{p.verb}</Badge>
                  <div className="min-w-0 flex-1 leading-relaxed">
                    <span className="font-mono font-semibold text-ink">{s.unitCode ?? `#${s.rowId}`}</span>{" "}
                    <span className="text-muted">
                      {p.subject} from <span className="text-content font-medium">{p.from}</span>
                      <ArrowRightLeft size={11} className="inline mx-1 text-brass align-[-1px]" />
                      <span className="text-content font-medium">{p.to}</span>.
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {result.unresolved.length > 0 && (
        <div className="rounded border border-warn/30 bg-warn/10 overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-content border-b border-warn/20">
            <Info size={13} className="text-warn" />
            Couldn&apos;t auto-resolve ({result.unresolved.length}) — here&apos;s why:
          </div>
          <div className="max-h-56 overflow-auto divide-y divide-warn/20">
            {unresolvedGroups.map((group) => {
              const visibleUnits = group.units.slice(0, 8);
              const hiddenUnitCount = group.units.length - visibleUnits.length;
              return (
                <div key={group.reason} className="px-2.5 py-2 text-xs text-content">
                  <span className="font-medium text-ink">{group.reason}</span>{" "}
                  <span className="text-muted">
                    — <span className="font-mono text-ink">{visibleUnits.join(", ")}</span>
                    {hiddenUnitCount > 0 && `, +${hiddenUnitCount} more`} ({group.total}{" "}
                    {group.total === 1 ? "class" : "classes"})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

interface UnresolvedReasonGroup {
  reason: string;
  units: string[];
  total: number;
}

/** Human-readable description of one applied change, with the right nouns/verb. */
function stepPhrase(s: ResolveResult["steps"][number]): {
  verb: string;
  subject: string;
  from: string;
  to: string;
  tone: "brass" | "info" | "warn";
} {
  if (s.action === "transfer") {
    return { verb: "Reassigned", subject: "lecturer", from: s.from, to: s.to, tone: "info" };
  }
  if (s.action === "room") {
    return { verb: "Moved room", subject: "venue", from: `room ${s.from}`, to: `room ${s.to}`, tone: "warn" };
  }
  return { verb: "Rescheduled", subject: "time slot", from: s.from, to: s.to, tone: "brass" };
}

function groupUnresolved(unresolved: ResolveResult["unresolved"]): UnresolvedReasonGroup[] {
  const groups = new Map<string, UnresolvedReasonGroup>();
  for (const u of unresolved) {
    const reason = u.reasons.length > 0 ? u.reasons.join(" ") : "No reason provided";
    let group = groups.get(reason);
    if (!group) {
      group = { reason, units: [], total: 0 };
      groups.set(reason, group);
    }
    const unit = u.unitCode ?? `#${u.rowId}`;
    if (!group.units.includes(unit)) group.units.push(unit);
    group.total += 1;
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason));
}

/** Announce the result of merging duplicate rows. */
function announceMerge(removed: number, merged: number) {
  if (merged === 0) {
    toast.info("No duplicate course rows left to merge.");
    return;
  }
  toast.success(
    `Merged ${merged} duplicate course group${merged === 1 ? "" : "s"} — ${removed} redundant row${
      removed === 1 ? "" : "s"
    } removed and their conflicts cleared.`,
    "Courses merged",
    { action: { label: "Undo", onClick: () => useStore.getState().undo() }, duration: 9000 },
  );
}

/**
 * "Merge similar courses": course units with the same or very similar names,
 * taught by the SAME lecturer in the SAME room at the SAME time are one
 * teaching session that the sheet listed more than once. Merging collapses each
 * group into a single session, so the conflicts they raise disappear for good.
 */
function MergeSimilarCourses({ sessions }: { sessions: Session[] }) {
  const groups = useMergeableGroups(sessions);
  const mergeSessions = useStore((s) => s.mergeSessions);
  const mergeAll = useStore((s) => s.mergeAllSimilarCourses);
  const [expanded, setExpanded] = useState(false);

  if (groups.length === 0) return null;

  const duplicateRows = groups.reduce((a, g) => a + g.rowIds.length - 1, 0);
  const shown = expanded ? groups : groups.slice(0, 4);

  return (
    <Card className="overflow-hidden border-info/40">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-info/10 border-b border-info/30 flex-wrap">
        <Link2 size={15} className="text-info" />
        <span className="font-medium text-ink text-sm">Similar courses that can be merged</span>
        <Badge tone="info">{groups.length}</Badge>
        <span className="text-xs text-muted">
          {duplicateRows} duplicate row{duplicateRows === 1 ? "" : "s"} — same lecturer, room and time
        </span>
        <Button
          size="sm"
          variant="primary"
          className="ml-auto"
          onClick={() => {
            const r = mergeAll();
            announceMerge(r.removed, r.merged);
          }}
        >
          <Merge size={13} /> Merge all similar courses
        </Button>
      </div>

      <div className="flex items-start gap-1.5 px-4 py-2 text-xs text-content bg-surface-2/20 border-b border-rule/60">
        <Info size={13} className="text-info mt-0.5 shrink-0" />
        <span>
          These rows describe ONE teaching session listed under slightly different unit names (e.g.
          “Research Methods” and “Business Research Methods”). Merging keeps a single session with the
          combined enrolment and removes the redundant rows — and with them, the conflicts they caused.
        </span>
      </div>

      <div className="divide-y divide-rule/60">
        {shown.map((g) => (
          <MergeGroupRow key={g.key} group={g} onMerge={() => announceMerge(mergeSessions(g.rowIds), 1)} />
        ))}
      </div>

      {groups.length > 4 && (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="w-full border-t border-rule/60 px-4 py-2 text-xs text-muted hover:text-ink transition"
        >
          {expanded ? "Show less" : `Show all ${groups.length} groups`}
        </button>
      )}
    </Card>
  );
}

function MergeGroupRow({ group, onMerge }: { group: MergeGroup; onMerge: () => void }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <div className="flex-1 min-w-0">
        <div className="text-ink truncate">
          <span className="font-mono font-medium">{group.unitCodes.join(" + ") || `#${group.rowIds.join(", #")}`}</span>
          <span className="text-muted"> · {group.unitNames.join("  ·  ")}</span>
        </div>
        <div className="text-xs text-muted mt-0.5">{group.reason}</div>
        <div className="text-[0.68rem] text-muted/90 mt-0.5">
          {group.day} · {group.time} · Rm {group.room ?? "—"} · {group.lecturer} ·{" "}
          {group.programmes.join(", ") || "—"} · combined head count {group.headCount}
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onMerge} title="Merge these rows into one session">
        <Merge size={13} /> Merge
      </Button>
    </div>
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
  lecturer: {
    icon: <User size={15} />,
    label: "Lecturer double-booking",
    tone: "danger" as const,
    noun: "Lecturer",
    explain: (who: string, day: string) =>
      `${who} is assigned two or more classes at the same time on ${day} — one person can't teach them all at once. Move a class to a free slot or hand it to a colleague.`,
  },
  room: {
    icon: <DoorOpen size={15} />,
    label: "Room double-booking",
    tone: "warn" as const,
    noun: "Room",
    explain: (who: string, day: string) =>
      `Room ${who} is booked by two or more classes at the same time on ${day} — a room only fits one class. Move a class to another free room or a different slot.`,
  },
  batch_code: {
    icon: <Users size={15} />,
    label: "Cohort double-booking",
    tone: "info" as const,
    noun: "Cohort",
    explain: (who: string, day: string) =>
      `Cohort ${who} has two or more classes scheduled at the same time on ${day} — the students can't attend both. Reschedule one class to a slot the cohort is free.`,
  },
};

function ConflictCard({ group }: { group: ConflictGroup }) {
  const sessions = useStore((s) => s.sessions);
  const autoResolve = useStore((s) => s.autoResolve);
  const mergeSessions = useStore((s) => s.mergeSessions);
  const opts = useResolveOpts();
  const meta = TYPE_META[group.clashType];
  const rows = group.rowIds
    .map((id) => sessions.find((s) => s.rowId === id))
    .filter((s): s is Session => !!s);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);
  const [resolvingGroup, setResolvingGroup] = useState(false);

  // Rows of this conflict that are actually ONE teaching session listed twice.
  const mergeable = useMemo(
    () => mergeableGroupsTouching(sessions, group.rowIds),
    [sessions, group.rowIds],
  );

  const resolveGroup = () => {
    if (resolvingGroup) return;
    setResolvingGroup(true);
    requestAnimationFrame(() => setTimeout(() => {
      try {
        const r =
          group.clashType === "lecturer"
            ? autoResolve(opts, { lecturer: group.groupValue, types: ["lecturer"] })
            : autoResolve(opts, { types: [group.clashType] });
        announceResolve(r);
      } finally {
        setResolvingGroup(false);
      }
    }, 0));
  };

  const mergeGroup = () => {
    let removed = 0;
    for (const g of mergeable) removed += mergeSessions(g.rowIds);
    announceMerge(removed, mergeable.length);
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
        <div className="ml-auto flex items-center gap-2">
          {mergeable.length > 0 && (
            <Button
              size="sm"
              variant="primary"
              onClick={mergeGroup}
              title={mergeable[0].reason}
            >
              <Merge size={12} /> Merge similar
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={resolveGroup} disabled={resolvingGroup}>
            {resolvingGroup ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Resolving…
              </>
            ) : (
              <>
                <Wand2 size={12} /> Auto-fix this
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-1.5 px-4 py-2 text-xs text-content bg-surface-2/20 border-b border-rule/60">
        <Info size={13} className="text-brass mt-0.5 shrink-0" />
        <span>{meta.explain(group.groupValue, group.day)}</span>
      </div>

      {mergeable.length > 0 && (
        <div className="flex items-start gap-1.5 px-4 py-2 text-xs text-content bg-info/10 border-b border-info/25">
          <Link2 size={13} className="text-info mt-0.5 shrink-0" />
          <span>
            <span className="font-medium text-ink">Not a real conflict?</span> {mergeable[0].reason}{" "}
            Merge to keep one session and clear this automatically.
          </span>
        </div>
      )}

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
  const facultyTypeRegistry = useStore((s) => s.facultyTypeRegistry);
  const roleRegistry = useStore((s) => s.roleRegistry);
  const ft = session.lecturer ? effectiveFacultyType(session.lecturer, roleRegistry, facultyTypeRegistry) : null;
  // Show every programme/cohort attending, including any merged into this row.
  const programmes = [
    ...new Set([session.programme, ...(session.merged?.programmes ?? [])].filter((x): x is string => !!x)),
  ].sort();
  const cohorts = [
    ...new Set([session.batchCode, ...(session.merged?.batchCodes ?? [])].filter((x): x is string => !!x)),
  ].sort();
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <span className="font-mono text-xs text-muted w-8 shrink-0">#{session.rowId}</span>
        <div className="flex-1 min-w-0">
          <div className="text-ink truncate">
            <span className="font-medium font-mono">{session.unitCode}</span>
            <span className="text-muted"> {session.unitName}</span>
          </div>
          <div className="text-xs text-muted truncate flex items-center gap-1.5">
            <span className="truncate">
              {programmes.join(", ") || "—"} · {cohorts.join(", ") || "—"} · {session.timeRaw} · Rm{" "}
              {session.room ?? "—"} · {session.lecturer ?? "TBA"}
            </span>
            {ft && <FacultyTypeBadge type={ft} />}
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

/**
 * Plain-English description of each policy rule: what it is called, why it
 * exists, and what a scheduler should do about it. No jargon or abbreviations —
 * this panel is read by registry staff, not just the person who wrote the rules.
 */
const RULE_META: Record<
  string,
  { label: string; tone: "danger" | "warn" | "info"; why: string; fix: string }
> = {
  max_per_day: {
    label: "Too many classes in one day",
    tone: "warn",
    why: "A lecturer may only teach a limited number of classes per day (3 for full-time staff, 4 for part-time, who are paid per session).",
    fix: "Move one of the day's classes to another day, or hand it to a colleague.",
  },
  faculty_rule: {
    label: "Full-time staff can't teach Friday 4–6 PM",
    tone: "danger",
    why: "The Friday 4:00–6:00 PM slot is reserved; full-time staff are not scheduled then.",
    fix: "Move the class to another slot, or reassign it to a part-time lecturer.",
  },
  programme_rule: {
    label: "Wrong teaching day for this programme",
    tone: "info",
    why: "Master's and Doctoral programmes teach on Saturdays only; Bachelor's, Diploma and Higher Education Certificate programmes teach Monday to Friday.",
    fix: "Move the class to a day the programme actually teaches on.",
  },
  time_window: {
    label: "Outside Saturday teaching hours",
    tone: "danger",
    why: "Saturday classes run from 9:00 AM to 4:00 PM and must finish by 4:00 PM.",
    fix: "Move the class to a Saturday slot that ends by 4:00 PM.",
  },
};

/**
 * Sessions that break an institutional POLICY (not a double-booking): the
 * per-day class cap, the full-time Friday-evening block, the programme's
 * teaching-day rule, and the Saturday teaching window.
 *
 * Each entry shows the whole lecture — course, lecturer, programmes, cohorts,
 * room and current slot — plus what the rule is and how to satisfy it, so the
 * scheduler can decide how to handle it without opening anything else.
 */
function PolicyViolations({
  sessions,
  opts,
}: {
  sessions: Session[];
  opts: ReturnType<typeof useResolveOpts>;
}) {
  const liveSessions = useStore((s) => s.sessions);
  const violations = useMemo(() => detectRuleViolations(sessions, opts), [sessions, opts]);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const byKind = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of violations) m.set(v.kind, (m.get(v.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [violations]);

  if (violations.length === 0) return null;
  const shown = kindFilter ? violations.filter((v) => v.kind === kindFilter) : violations;
  const active = openRow !== null ? liveSessions.find((s) => s.rowId === openRow) ?? null : null;

  return (
    <Card className="overflow-hidden border-warn/40">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-warn/10 border-b border-warn/30 flex-wrap">
        <ShieldAlert size={15} className="text-warn" />
        <span className="font-medium text-ink text-sm">Scheduling policy breaches</span>
        <Badge tone="warn">{violations.length}</Badge>
        <span className="ml-auto text-xs text-muted">
          These aren&apos;t double-bookings — each class breaks an institutional rule
        </span>
      </div>

      {/* Group counts double as filters, so a whole category can be worked through. */}
      {byKind.length > 1 && (
        <div className="flex gap-1.5 flex-wrap px-4 py-2 border-b border-rule/60 bg-surface-2/20">
          <button
            type="button"
            onClick={() => setKindFilter(null)}
            className={`rounded-full px-2.5 py-0.5 text-xs border transition ${
              kindFilter === null ? "bg-brass border-brass text-white" : "border-rule text-muted hover:text-ink"
            }`}
          >
            All <span className="font-mono">{violations.length}</span>
          </button>
          {byKind.map(([kind, n]) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKindFilter(kind === kindFilter ? null : kind)}
              className={`rounded-full px-2.5 py-0.5 text-xs border transition ${
                kindFilter === kind ? "bg-brass border-brass text-white" : "border-rule text-muted hover:text-ink"
              }`}
            >
              {RULE_META[kind]?.label ?? kind} <span className="font-mono">{n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="divide-y divide-rule/60 max-h-[36rem] overflow-auto">
        {shown.map((v) => {
          const meta = RULE_META[v.kind];
          const open = openRow === v.rowId;
          return (
            <div key={`${v.rowId}-${v.kind}`}>
              <div className="px-4 py-3 space-y-1.5">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* What the rule is */}
                    <Badge tone={meta.tone}>{meta.label}</Badge>

                    {/* Which lecture — course code and full name */}
                    <div className="text-sm text-ink">
                      <span className="font-mono font-semibold">{v.unitCode ?? `#${v.rowId}`}</span>{" "}
                      <span className="text-content">{v.unitName ?? "Untitled unit"}</span>
                    </div>

                    {/* Who and where — everything needed to judge the fix */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <GraduationCap size={11} className="text-brass" />
                        {v.lecturer ?? "Unassigned (TBA)"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} className="text-brass" />
                        {v.day ? DAY_NAME[v.day] : "—"} · {v.time ?? "—"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <DoorOpen size={11} className="text-brass" />
                        Room {v.room ?? "—"}
                      </span>
                      {v.headCount !== null && (
                        <span className="inline-flex items-center gap-1">
                          <Users size={11} className="text-brass" />
                          {v.headCount} students
                        </span>
                      )}
                    </div>

                    {/* Which programmes and cohorts are affected */}
                    {(v.programmes.length > 0 || v.cohorts.length > 0) && (
                      <div className="flex flex-wrap items-center gap-1">
                        {v.programmes.map((p) => {
                          const { style, className } = chipProps(p);
                          return (
                            <span
                              key={p}
                              style={style}
                              className={cn(
                                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.68rem] font-medium",
                                className,
                              )}
                            >
                              {p}
                            </span>
                          );
                        })}
                        {v.cohorts.map((c) => (
                          <span
                            key={c}
                            className="inline-flex items-center rounded-full border border-rule px-1.5 py-0.5 text-[0.66rem] font-mono text-muted"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant={open ? "primary" : "outline"}
                    ariaLabel={`${open ? "Close" : "Fix"} ${v.unitCode ?? `#${v.rowId}`}: ${meta.label}`}
                    onClick={() => setOpenRow(open ? null : v.rowId)}
                  >
                    <ArrowRightLeft size={13} /> {open ? "Close" : "Fix"}
                  </Button>
                </div>

                {/* Why it's flagged, and what to do about it */}
                <div className="rounded border border-rule/70 bg-surface-2/30 px-2.5 py-2 text-xs space-y-1">
                  <div className="flex items-start gap-1.5">
                    <Info size={12} className="text-brass mt-0.5 shrink-0" />
                    <span className="text-content">
                      <span className="font-medium text-ink">Problem: </span>
                      {v.message}
                    </span>
                  </div>
                  <div className="pl-[18px] text-muted">
                    <span className="font-medium">The rule: </span>
                    {meta.why}
                  </div>
                  <div className="pl-[18px] text-muted">
                    <span className="font-medium">How to handle it: </span>
                    {meta.fix}
                  </div>
                </div>
              </div>

              {open && active && (
                <div className="px-4 pb-4 animate-fade">
                  <ResolutionPanel session={active} onDone={() => setOpenRow(null)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
