"use client";

import { useMemo, useState } from "react";
import { useFilteredSessions, useTermSessions } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { facultyReport } from "@/lib/analysis";
import { buildGrid } from "@/lib/grid";
import { workloadStatus, maxHoursForRole, DEFAULT_ROLE } from "@/lib/roles";
import { departmentFor } from "@/lib/departments";
import { Card, SectionTitle, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/button";
import { DataTable, Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { GridView } from "@/components/ui/grid-view";
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
        <span className="font-mono">
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

      <FacultyDrilldown />

      <Card className="p-4">
        <SectionTitle>Faculty Report</SectionTitle>
        <DataTable columns={columns} rows={report} rowKey={(r) => r.lecturer} empty="No lecturers." dense />
      </Card>
    </div>
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
  const mine = termSessions.filter((s) => s.lecturer === chosen);

  const role = roleRegistry[chosen] ?? DEFAULT_ROLE;
  const maxH = maxHoursForRole(role, roleMaxHours);
  const totalH = mine.reduce((a, s) => a + (s.workloadHours ?? 0), 0);
  const { status, reason } = workloadStatus(totalH, maxH, thresholds.nearMaxPct, thresholds.farUnderPct);
  const depts = [...new Set(mine.map((s) => departmentFor(s.programme, departmentRegistry)).filter((x): x is string => !!x))];
  const grid = useMemo(() => buildGrid(mine, ["unitCode", "room"]), [mine]);

  const courses = useMemo(() => {
    const m = new Map<string, { name: string | null; n: number }>();
    for (const s of mine) {
      if (!s.unitCode) continue;
      const e = m.get(s.unitCode) ?? { name: s.unitName, n: 0 };
      e.n++;
      m.set(s.unitCode, e);
    }
    return [...m.entries()].map(([code, v]) => ({ code, ...v }));
  }, [mine]);

  if (!lecturers.length) return <EmptyState>No lecturers in this term.</EmptyState>;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1">Inspect lecturer</label>
          <Select value={chosen} onChange={setPick} options={lecturers.map((l) => ({ value: l, label: l }))} className="w-full" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge tone="neutral">{role}</Badge>
          <Badge tone="neutral">{mine.length} sessions</Badge>
          <Badge tone="neutral" className="font-mono">{fmtHours(totalH)}/{maxH}h</Badge>
          <StatusBadge status={status} />
        </div>
      </div>
      {reason && <p className="text-xs text-muted -mt-2">{reason}</p>}
      {depts.length > 0 && <p className="text-xs text-muted">Department(s): {depts.join(", ")}</p>}

      <div className="grid lg:grid-cols-[1fr_260px] gap-4">
        <div>
          <SectionTitle>Weekly timetable</SectionTitle>
          <GridView grid={grid} />
        </div>
        <div>
          <SectionTitle>Assigned courses</SectionTitle>
          <div className="space-y-1">
            {courses.map((c) => (
              <div key={c.code} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-ink">{c.code}</span>
                <span className="text-muted truncate flex-1" title={c.name ?? ""}>{c.name}</span>
                <span className="font-mono text-muted">{c.n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
