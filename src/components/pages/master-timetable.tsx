"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Info, Link2, Merge, Users } from "lucide-react";
import { useFilteredSessions } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { allClashes } from "@/lib/analysis";
import { detectSharedClasses } from "@/lib/sharedClass";
import { buildClassIndex, classDetails, summarise, ClassDetails } from "@/lib/classDetails";
import { formatTimeRange } from "@/lib/clean";
import { departmentFor } from "@/lib/departments";
import { hueStyle } from "@/lib/colors";
import { DAY_ORDER, DayCode, Session, ClashType } from "@/lib/types";
import { Card, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ClassDetailsCard } from "@/components/ui/class-details";
import { ResolutionPanel } from "@/components/resolution-panel";

const TYPE_LABEL: Record<ClashType, string> = {
  lecturer: "Lecturer clash",
  room: "Room clash",
  batch_code: "Cohort clash",
};

/**
 * Complete term timetable: every scheduled session across all lecturers, rooms,
 * programmes and units, laid out on a Day × Time grid. Sessions that are part of
 * a REAL clash (same lecturer, room, or cohort overlapping — not merely parallel
 * classes) are flagged red; clicking one opens the resolution panel in place.
 */
export function MasterTimetable() {
  const { termSessions, filtered } = useFilteredSessions();
  const sessions = useStore((s) => s.sessions);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const [resolve, setResolve] = useState<{ rowId: number; type: ClashType } | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);

  // Real clashes computed over the whole term so a filtered-out counterpart still flags.
  const clashInfo = useMemo(() => {
    const map = new Map<number, Set<ClashType>>();
    for (const c of allClashes(termSessions)) {
      for (const rid of [c.rowId1, c.rowId2]) {
        const set = map.get(rid) ?? new Set<ClashType>();
        set.add(c.clashType);
        map.set(rid, set);
      }
    }
    return map;
  }, [termSessions]);

  // Rows that belong to an intentional combined/shared class (different cohorts
  // taught together in one room) — surfaced so users see they are NOT conflicts.
  const combined = useMemo(() => {
    const co = new Map<number, string[]>();
    for (const g of detectSharedClasses(termSessions)) {
      for (const id of g.rowIds) co.set(id, g.programmes);
    }
    return co;
  }, [termSessions]);

  // Full description of every class, so each entry can show course name,
  // programmes and cohorts without another lookup.
  const classIndex = useMemo(() => buildClassIndex(termSessions), [termSessions]);
  const detailsFor = useMemo(() => {
    const m = new Map<number, ClassDetails>();
    for (const s of termSessions) {
      m.set(s.rowId, classDetails(s, termSessions, departmentRegistry, classIndex));
    }
    return m;
  }, [termSessions, departmentRegistry, classIndex]);

  const { slots, days, buckets } = useMemo(() => {
    const valid = filtered.filter((s) => s.day !== null && s.startMin !== null && s.endMin !== null);
    const slotOrder: { slot: string; start: number }[] = [];
    const seen = new Set<string>();
    for (const s of valid) {
      const slot = formatTimeRange(s.startMin, s.endMin);
      if (!seen.has(slot)) {
        seen.add(slot);
        slotOrder.push({ slot, start: s.startMin! });
      }
    }
    slotOrder.sort((a, b) => a.start - b.start);
    const days = DAY_ORDER.filter((d) => valid.some((s) => s.day === d));
    const buckets = new Map<string, Session[]>();
    for (const s of valid) {
      const key = `${formatTimeRange(s.startMin, s.endMin)}||${s.day}`;
      const arr = buckets.get(key) ?? [];
      arr.push(s);
      buckets.set(key, arr);
    }
    // stable order within a cell: clashing first, then by unit code
    for (const arr of buckets.values()) {
      arr.sort((a, b) => {
        const ca = clashInfo.has(a.rowId) ? 0 : 1;
        const cb = clashInfo.has(b.rowId) ? 0 : 1;
        return ca - cb || (a.unitCode ?? "").localeCompare(b.unitCode ?? "");
      });
    }
    return { slots: slotOrder.map((s) => s.slot), days, buckets };
  }, [filtered, clashInfo]);

  const activeSession = resolve ? sessions.find((s) => s.rowId === resolve.rowId) ?? null : null;
  const inspectDetails = inspect !== null ? detailsFor.get(inspect) ?? null : null;
  const inspectClashes = inspect !== null ? clashInfo.get(inspect) : undefined;

  const totalClashing = clashInfo.size;

  if (slots.length === 0) return <EmptyState>No scheduled sessions match this view.</EmptyState>;

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted mb-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm border border-rule bg-surface" /> No conflict
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-danger/20 ring-1 ring-danger/50" /> In conflict
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-info/15 ring-1 ring-info/40" /> Combined class (shared, not a conflict)
        </span>
        <span className="flex items-center gap-1.5">
          <Info size={12} className="text-brass" /> Click any class for full details
        </span>
        <span className="ml-auto">
          {filtered.length} sessions · <span className="text-danger font-mono">{totalClashing}</span> flagged
        </span>
      </div>

      <Card className="overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface-2/80 border-b border-r border-rule px-2 py-2 text-left text-muted uppercase tracking-wide text-[0.6rem] w-24">
                Time
              </th>
              {days.map((d) => (
                <th key={d} className="border-b border-rule px-2 py-2 text-left text-muted uppercase tracking-wide text-[0.6rem] min-w-[160px]">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot} className="border-b border-rule/50 last:border-0 align-top">
                <td className="sticky left-0 z-10 bg-surface border-r border-rule px-2 py-1.5 font-mono text-[0.6rem] text-muted whitespace-nowrap">
                  {slot}
                </td>
                {days.map((d) => {
                  const cell = buckets.get(`${slot}||${d}`) ?? [];
                  return (
                    <td key={d} className="px-1.5 py-1.5">
                      <div className="flex flex-col gap-1">
                        {cell.map((s) => (
                          <SessionChip
                            key={s.rowId}
                            session={s}
                            details={detailsFor.get(s.rowId)}
                            department={departmentFor(s.programme, departmentRegistry)}
                            types={clashInfo.get(s.rowId)}
                            combinedWith={combined.get(s.rowId)}
                            onResolve={(type) => setResolve({ rowId: s.rowId, type })}
                            onInspect={() => setInspect(s.rowId)}
                          />
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal
        open={!!activeSession}
        onClose={() => setResolve(null)}
        title={
          activeSession ? (
            <span>
              Resolve {resolve && TYPE_LABEL[resolve.type]} —{" "}
              <span className="font-mono">{activeSession.unitCode}</span>{" "}
              <span className="text-muted font-normal">
                ({activeSession.day} {activeSession.timeRaw})
              </span>
            </span>
          ) : null
        }
      >
        {activeSession && resolve && (
          <ResolutionPanel session={activeSession} clashType={resolve.type} onDone={() => setResolve(null)} />
        )}
      </Modal>

      <Modal
        open={inspectDetails !== null}
        onClose={() => setInspect(null)}
        title={
          inspectDetails ? (
            <span>
              <span className="font-mono">{inspectDetails.unitCode}</span>{" "}
              <span className="text-muted font-normal">{inspectDetails.unitName}</span>
            </span>
          ) : null
        }
      >
        {inspectDetails && (
          <div className="space-y-3">
            <ClassDetailsCard details={inspectDetails} />
            {inspectClashes && inspectClashes.size > 0 && (
              <div className="flex items-center gap-2 rounded border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs">
                <AlertTriangle size={14} className="text-danger shrink-0" />
                <span className="flex-1 text-content">
                  In conflict: {[...inspectClashes].map((t) => TYPE_LABEL[t]).join(", ")}.
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    const rowId = inspectDetails.rowId;
                    setInspect(null);
                    setResolve({ rowId, type: [...inspectClashes][0] });
                  }}
                >
                  Resolve
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function SessionChip({
  session,
  details,
  department,
  types,
  combinedWith,
  onResolve,
  onInspect,
}: {
  session: Session;
  details: ClassDetails | undefined;
  department: string | null;
  types: Set<ClashType> | undefined;
  combinedWith?: string[];
  onResolve: (type: ClashType) => void;
  onInspect: () => void;
}) {
  const clashing = !!types && types.size > 0;
  const combined = !clashing && !!combinedWith && combinedWith.length > 0;
  const primaryType: ClashType = types?.has("lecturer")
    ? "lecturer"
    : types?.has("room")
      ? "room"
      : "batch_code";
  // Every chip carries its faculty's colour on the left edge.
  const stripe = department ? { ...hueStyle(department) } : undefined;
  const stripeClass = department ? "stripe-color" : "";

  const programmes = details?.programmes ?? (session.programme ? [session.programme] : []);
  const cohorts = details?.cohorts ?? (session.batchCode ? [session.batchCode] : []);
  const tone = clashing
    ? "border-danger/50 bg-danger/10 hover:bg-danger/20 hover:border-danger"
    : combined
      ? "border-info/40 bg-info/10 hover:border-info"
      : "border-rule/70 bg-surface hover:border-brass";

  return (
    <button
      type="button"
      style={stripe}
      onClick={onInspect}
      aria-label={`${session.unitCode ?? "Class"} ${session.unitName ?? ""} — ${
        session.lecturer ?? "TBA"
      }, room ${session.room ?? "none"}, ${programmes.join(", ")}`}
      title={`${session.unitCode ?? ""} ${session.unitName ?? ""}\n${session.lecturer ?? "TBA"} · Rm ${
        session.room ?? "—"
      } · ${details?.time ?? session.timeRaw ?? ""}\n${programmes.join(", ")}${
        cohorts.length ? `\nCohorts: ${cohorts.join(", ")}` : ""
      }\nClick for full details`}
      className={`w-full text-left rounded border px-1.5 py-1 leading-tight transition ${tone} ${stripeClass}`}
    >
      {/* Course code + status icons */}
      <div className="flex items-center gap-1 min-w-0">
        {clashing && <AlertTriangle size={10} className="text-danger shrink-0" />}
        {combined && <Link2 size={10} className="text-info shrink-0" />}
        {session.merged && <Merge size={10} className="text-good shrink-0" />}
        <span className="font-mono font-semibold text-ink truncate">{session.unitCode ?? "—"}</span>
      </div>

      {/* Course name — the detail that was missing */}
      <div className="text-[0.66rem] text-content leading-snug line-clamp-2">
        {session.unitName ?? "Untitled unit"}
      </div>

      {/* Lecturer · room */}
      <div className="text-[0.62rem] text-muted truncate mt-0.5">
        {session.lecturer ?? "TBA"} · Rm {session.room ?? "—"}
      </div>

      {/* Programme(s) and cohort(s) attending */}
      <div className="text-[0.6rem] text-muted/90 truncate flex items-center gap-1">
        {programmes.length > 1 && <Users size={9} className="shrink-0 text-info" />}
        <span className="truncate">{summarise(programmes)}</span>
      </div>
      {cohorts.length > 0 && (
        <div className="text-[0.58rem] text-muted/75 truncate font-mono">{summarise(cohorts)}</div>
      )}

      {(clashing || combined) && (
        <div className="mt-0.5 flex flex-wrap gap-0.5">
          {combined && <Badge tone="info">combined</Badge>}
          {[...(types ?? [])].map((t) => (
            <Badge key={t} tone={t === "lecturer" ? "danger" : t === "room" ? "warn" : "info"}>
              {t === "batch_code" ? "cohort" : t}
            </Badge>
          ))}
        </div>
      )}
      {clashing && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onResolve(primaryType);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onResolve(primaryType);
            }
          }}
          className="mt-1 inline-block rounded border border-danger/50 px-1.5 py-0.5 text-[0.6rem] text-danger hover:bg-danger hover:text-white transition cursor-pointer"
        >
          Resolve
        </span>
      )}
    </button>
  );
}
