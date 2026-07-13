"use client";

import { useMemo, useState } from "react";
import { Users2, Plus, X, ArrowRightLeft, BookOpen } from "lucide-react";
import { useFilteredSessions, useTermSessions } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { facultyReport } from "@/lib/analysis";
import { detectDuplicateFaculty, distinctUnits } from "@/lib/faculty";
import { buildGrid } from "@/lib/grid";
import { workloadStatus, maxHoursForRole, DEFAULT_ROLE } from "@/lib/roles";
import { departmentFor } from "@/lib/departments";
import { Card, SectionTitle, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Select } from "@/components/ui/button";
import { DataTable, Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { GridView } from "@/components/ui/grid-view";
import { LecturerTransferPanel } from "@/components/resolution-panel";
import { FacultyAnalytics } from "@/components/faculty-charts";
import { fmtHours } from "@/lib/cn";
import type { FacultyReportRow } from "@/lib/analysis";

export function FacultyPage() {
  const { filtered } = useFilteredSessions();
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const thresholds = useStore((s) => s.thresholds);

  const report = useMemo(
    () => facultyReport(filtered, roleRegistry, roleMaxHours, departmentRegistry, thresholds),
    [filtered, roleRegistry, roleMaxHours, departmentRegistry, thresholds],
  );

  const columns: Column<FacultyReportRow>[] = [
    { key: "lecturer", header: "Lecturer", render: (r) => <span className="font-medium text-ink">{r.lecturer}</span> },
    { key: "role", header: "Role", render: (r) => <Badge tone="neutral">{r.role}</Badge> },
    { key: "departments", header: "Dept" },
    { key: "sessions", header: "Sessions", align: "right" },
    {
      key: "hours",
      header: "Hours / Max",
      align: "right",
      render: (r) => (
        <span className="font-mono whitespace-nowrap">
          {fmtHours(r.totalHours)}/{r.maxHours}
        </span>
      ),
    },
    {
      key: "remainingHours",
      header: "Left",
      align: "right",
      render: (r) => (
        <span className={`font-mono ${r.remainingHours < 0 ? "text-danger" : "text-muted"}`}>
          {fmtHours(r.remainingHours)}
        </span>
      ),
    },
    { key: "clashes", header: "Clashes", align: "right", render: (r) => (r.clashes ? <span className="text-danger font-mono">{r.clashes}</span> : <span className="text-muted">0</span>) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Faculty Workload</h1>
        <p className="text-sm text-muted">Role-based weekly limits · 🔴 Overloaded · 🟡 Close to Maximum · 🟢 Balanced</p>
      </div>

      <DuplicateBanner />
      <FacultyDrilldown />

      <Card className="p-4 overflow-hidden">
        <SectionTitle>Faculty Report</SectionTitle>
        <DataTable columns={columns} rows={report} rowKey={(r) => r.lecturer} empty="No lecturers." dense />
      </Card>

      <FacultyAnalytics />
    </div>
  );
}

function DuplicateBanner() {
  const sessions = useStore((s) => s.sessions);
  const dedupeFaculty = useStore((s) => s.dedupeFaculty);
  const [merged, setMerged] = useState<number | null>(null);
  const dups = useMemo(() => detectDuplicateFaculty(sessions), [sessions]);

  if (dups.length === 0) {
    return merged !== null ? (
      <Card className="p-3 border-good/40 bg-good/10 text-sm text-content flex items-center gap-2">
        <Users2 size={15} className="text-good" /> Merged {merged} duplicate faculty spelling(s). Records are now clean.
      </Card>
    ) : null;
  }

  return (
    <Card className="p-4 border-warn/40 bg-warn/10 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-content">
          <Users2 size={16} className="text-warn shrink-0" />
          <span>
            <span className="font-medium">{dups.length}</span> possible duplicate faculty record
            {dups.length > 1 ? "s" : ""} detected (same person, different spellings).
          </span>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => setMerged(dedupeFaculty())}
        >
          Merge all duplicates
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {dups.slice(0, 8).map((d) => (
          <Badge key={d.key} tone="warn">
            {d.variants.join(" = ")}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

function FacultyDrilldown() {
  const termSessions = useTermSessions();
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const thresholds = useStore((s) => s.thresholds);
  const lecturers = useMemo(
    () => [...new Set(termSessions.map((s) => s.lecturer).filter((x): x is string => !!x))].sort(),
    [termSessions],
  );
  const [pick, setPick] = useState("");
  const chosen = pick && lecturers.includes(pick) ? pick : lecturers[0] ?? "";
  const mine = useMemo(() => termSessions.filter((s) => s.lecturer === chosen), [termSessions, chosen]);

  const role = roleRegistry[chosen] ?? DEFAULT_ROLE;
  const maxH = maxHoursForRole(role, roleMaxHours);
  const totalH = mine.reduce((a, s) => a + (s.workloadHours ?? 0), 0);
  const { status, reason } = workloadStatus(totalH, maxH, thresholds.nearMaxPct, thresholds.farUnderPct);
  const pct = maxH > 0 ? Math.min(100, (totalH / maxH) * 100) : 0;
  const barColor = status === "Overloaded" ? "danger" : status === "Balanced" ? "good" : "warn";
  const depts = [...new Set(mine.map((s) => departmentFor(s.programme, departmentRegistry)).filter((x): x is string => !!x))];
  const grid = useMemo(() => buildGrid(mine, ["unitCode", "room"]), [mine]);

  if (!lecturers.length) return <EmptyState>No lecturers in this term.</EmptyState>;

  return (
    <Card className="p-4 space-y-4 overflow-hidden">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1">Inspect lecturer</label>
          <Select value={chosen} onChange={setPick} options={lecturers.map((l) => ({ value: l, label: l }))} className="w-full" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge tone="neutral">{role}</Badge>
          <Badge tone="neutral">{mine.length} sessions</Badge>
          <StatusBadge status={status} />
        </div>
      </div>

      {/* Workload card — fully self-contained, never overflows */}
      <div className="rounded-card border border-rule bg-surface-2/30 p-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-2xl font-semibold text-ink">{fmtHours(totalH)}</span>
            <span className="text-muted text-sm">/ {maxH}h weekly</span>
          </div>
          <div className="text-xs text-muted font-mono whitespace-nowrap">
            {totalH > maxH ? (
              <span className="text-danger">{fmtHours(totalH - maxH)}h over limit</span>
            ) : (
              <span>{fmtHours(maxH - totalH)}h remaining</span>
            )}
          </div>
        </div>
        <div className="mt-2 h-2.5 rounded-full bg-surface-2/70 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: `rgb(var(--${barColor}))` }}
          />
        </div>
        {reason && <p className="text-xs text-muted mt-1.5">{reason}</p>}
        {depts.length > 0 && <p className="text-xs text-muted mt-0.5">Department(s): {depts.join(", ")}</p>}
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-4 min-w-0">
        <div className="min-w-0">
          <SectionTitle>Weekly timetable</SectionTitle>
          <GridView grid={grid} />
        </div>
        <div className="min-w-0 space-y-4">
          <SubjectAssignments lecturer={chosen} sessions={mine} />
        </div>
      </div>

      <TransferHours lecturer={chosen} sessions={mine} />
    </Card>
  );
}

function SubjectAssignments({ lecturer, sessions }: { lecturer: string; sessions: { unitCode: string | null; unitName: string | null }[] }) {
  const allSessions = useStore((s) => s.sessions);
  const subjectAssignments = useStore((s) => s.subjectAssignments);
  const assignSubject = useStore((s) => s.assignSubject);
  const unassignSubject = useStore((s) => s.unassignSubject);
  const [add, setAdd] = useState("");

  const assigned = subjectAssignments[lecturer] ?? [];
  const units = useMemo(() => distinctUnits(allSessions), [allSessions]);
  const nameFor = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const u of units) m.set(u.code, u.name);
    return m;
  }, [units]);
  const addable = units.filter((u) => !assigned.includes(u.code));

  return (
    <div>
      <SectionTitle className="flex items-center gap-1.5">
        <BookOpen size={13} /> Assigned subjects
      </SectionTitle>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {assigned.length === 0 && <span className="text-xs text-muted">No subjects assigned yet.</span>}
        {assigned.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-full border border-rule bg-surface px-2 py-0.5 text-xs"
            title={nameFor.get(code) ?? ""}
          >
            <span className="font-mono text-ink">{code}</span>
            <button
              type="button"
              onClick={() => unassignSubject(lecturer, code)}
              className="text-muted hover:text-danger transition"
              aria-label={`Remove ${code}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Select
          value={add}
          onChange={setAdd}
          placeholder="Add a subject…"
          options={addable.map((u) => ({ value: u.code, label: u.name ? `${u.code} — ${u.name}` : u.code }))}
          className="flex-1 min-w-0 text-xs"
        />
        <Button
          size="sm"
          onClick={() => {
            if (add) {
              assignSubject(lecturer, add);
              setAdd("");
            }
          }}
          disabled={!add}
        >
          <Plus size={13} />
        </Button>
      </div>
      <p className="text-[0.68rem] text-muted mt-1.5">
        Currently teaching{" "}
        {[...new Set(sessions.map((s) => s.unitCode).filter(Boolean))].length} unit(s) this term.
      </p>
    </div>
  );
}

function TransferHours({ lecturer, sessions }: { lecturer: string; sessions: { rowId: number; unitCode: string | null; unitName: string | null; day: string | null; timeRaw: string | null; room: string | null }[] }) {
  const liveSessions = useStore((s) => s.sessions);
  const [openRow, setOpenRow] = useState<number | null>(null);

  const courses = useMemo(() => {
    // one row per (unit) with its sessions, for compact display
    const byUnit = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const k = s.unitCode ?? `#${s.rowId}`;
      const arr = byUnit.get(k) ?? [];
      arr.push(s);
      byUnit.set(k, arr);
    }
    return [...byUnit.entries()];
  }, [sessions]);

  const active = openRow !== null ? liveSessions.find((s) => s.rowId === openRow) ?? null : null;

  if (sessions.length === 0) return null;

  return (
    <div className="rounded-card border border-rule bg-surface-2/20 p-3">
      <SectionTitle className="flex items-center gap-1.5">
        <ArrowRightLeft size={13} /> Transfer hours to another lecturer
      </SectionTitle>
      <p className="text-xs text-muted mb-2">
        Rebalance workload by moving any of {lecturer}&apos;s sessions to a colleague — the assistant
        ranks who&apos;s free and won&apos;t become overloaded.
      </p>
      <div className="max-h-64 overflow-auto rounded border border-rule divide-y divide-rule/60">
        {courses.map(([unit, list]) =>
          list.map((s) => (
            <div key={s.rowId}>
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                <span className="font-mono text-ink shrink-0">{unit}</span>
                <span className="text-muted truncate flex-1 min-w-0">
                  {s.day} · {s.timeRaw} · Rm {s.room ?? "—"}
                </span>
                <Button size="sm" variant={openRow === s.rowId ? "primary" : "outline"} onClick={() => setOpenRow(openRow === s.rowId ? null : s.rowId)}>
                  {openRow === s.rowId ? "Close" : "Transfer"}
                </Button>
              </div>
              {openRow === s.rowId && active && (
                <div className="px-2.5 pb-2.5 animate-fade">
                  <LecturerTransferPanel session={active} onDone={() => setOpenRow(null)} />
                </div>
              )}
            </div>
          )),
        )}
      </div>
    </div>
  );
}
