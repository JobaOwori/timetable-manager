"use client";

import { useMemo } from "react";
import { useFilteredSessions, useAnalysis } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { facultyReport, roomReport } from "@/lib/analysis";
import { fmtHours } from "@/lib/cn";
import { Card, SectionTitle, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FacultyReportRow, RoomReportRow } from "@/lib/analysis";
import type { WorkloadStatus } from "@/lib/types";

type Tone = "danger" | "warn" | "good" | "info" | "brass";

const STATUS_ORDER: WorkloadStatus[] = ["Unbalanced", "Balanced", "Flexible"];

function clamp(n: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, n));
}

function cappedPct(value: number, max: number) {
  if (max <= 0) return value > 0 ? 100 : 0;
  return clamp((value / max) * 100);
}

function statusTone(status: WorkloadStatus | string): Tone {
  if (status === "Unbalanced") return "danger";
  if (status === "Flexible") return "info";
  return "good";
}

function roomUtilTone(utilizationPct: number, underutilPct: number): Tone {
  if (utilizationPct > 100) return "danger";
  if (utilizationPct < underutilPct * 100) return "warn";
  return "good";
}

function barColor(tone: Tone) {
  return `rgb(var(--${tone}))`;
}

function firstDepartment(row: FacultyReportRow) {
  const first = row.departments.split(",")[0]?.trim();
  return first && first !== "—" ? first : "Unassigned";
}

export function FacultyAnalytics() {
  const { filtered } = useFilteredSessions();
  const { workload, capacity, summary, clashes } = useAnalysis(filtered);
  const roomRegistry = useStore((s) => s.roomRegistry);
  const thresholds = useStore((s) => s.thresholds);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const activeTerm = useStore((s) => s.activeTerm);
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const facultyTypeRegistry = useStore((s) => s.facultyTypeRegistry);

  const rooms = useMemo(
    () => roomReport(filtered, roomRegistry, thresholds.underutilPct, thresholds.capacityTolerance),
    [filtered, roomRegistry, thresholds],
  );

  const faculty = useMemo(
    () => facultyReport(filtered, roleRegistry, roleMaxHours, departmentRegistry, facultyTypeRegistry),
    [filtered, roleRegistry, roleMaxHours, departmentRegistry, facultyTypeRegistry],
  );

  const weeklyWorkload = useMemo(
    () => [...workload].sort((a, b) => b.totalHours - a.totalHours).slice(0, 20),
    [workload],
  );

  const utilization = useMemo(
    () =>
      workload
        .map((w) => ({
          ...w,
          utilizationPct: w.maxHours > 0 ? (w.totalHours / w.maxHours) * 100 : null,
        }))
        .sort((a, b) => (b.utilizationPct ?? -1) - (a.utilizationPct ?? -1))
        .slice(0, 20),
    [workload],
  );

  const distribution = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        status,
        count: workload.filter((w) => w.status === status).length,
        tone: statusTone(status),
      })),
    [workload],
  );

  const departmentHours = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of faculty) {
      const dept = firstDepartment(row);
      m.set(dept, (m.get(dept) ?? 0) + row.totalHours);
    }
    return [...m.entries()]
      .map(([department, hours]) => ({ department, hours }))
      .sort((a, b) => b.hours - a.hours);
  }, [faculty]);

  const loadBalance = useMemo(() => {
    const fullTime = workload.filter((w) => w.facultyType === "FT");
    const unbalanced = fullTime.filter((w) => w.status === "Unbalanced").length;
    const balanced = fullTime.filter((w) => w.status === "Balanced").length;
    const partTime = workload.filter((w) => w.facultyType === "PT").length;
    return { unbalanced, balanced, partTime, max: Math.max(1, unbalanced, balanced, partTime) };
  }, [workload]);

  const roomUtilization = useMemo(
    () =>
      rooms
        .filter((r): r is RoomReportRow & { utilizationPct: number } => r.utilizationPct !== null)
        .sort((a, b) => b.utilizationPct - a.utilizationPct)
        .slice(0, 20),
    [rooms],
  );

  const health = useMemo(() => {
    const totalSessions = Math.max(1, summary.totalSessions);
    const facultyCount = Math.max(1, workload.length);
    const capacityRows = Math.max(1, capacity.length);
    // Health starts at 100 and subtracts normalized penalties for operational risk:
    // clashes (25), full-time workload imbalance (20), room capacity pressure (20),
    // data quality (15), consecutive-teaching strain (10), and duplicate schedule groups (10).
    const penalty =
      (clashes.length / totalSessions) * 25 +
      (summary.unbalancedLecturers / facultyCount) * 20 +
      ((summary.overCapacitySessions + summary.withinToleranceSessions * 0.5) / capacityRows) * 20 +
      (summary.dataQualityIssues / totalSessions) * 15 +
      (summary.consecutiveViolations / facultyCount) * 10 +
      (summary.duplicateScheduleGroups / totalSessions) * 10;
    const score = Math.round(clamp(100 - penalty));
    const label = score >= 85 ? "Excellent" : score >= 60 ? "Fair" : "Needs work";
    const tone: Tone = score >= 85 ? "good" : score >= 60 ? "warn" : "danger";
    return { score, label, tone };
  }, [capacity.length, clashes.length, summary, workload.length]);

  if (filtered.length === 0) return <EmptyState>No faculty data for this term.</EmptyState>;

  const totalFaculty = Math.max(1, workload.length);
  const maxDepartmentHours = Math.max(1, ...departmentHours.map((d) => d.hours));

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-semibold text-ink">Faculty Analytics</h2>
          <p className="text-sm text-muted">Filtered workload, room, and conflict signals for the active term.</p>
        </div>
        <Badge tone="brass">{activeTerm ?? "No active term"}</Badge>
      </div>

      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-5">
        <Card className="p-4 min-w-0 overflow-hidden">
          <SectionTitle>Timetable health</SectionTitle>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="font-mono text-5xl font-semibold leading-none" style={{ color: barColor(health.tone) }}>
              {health.score}
            </div>
            <div className="min-w-[180px] flex-1">
              <div className="flex items-center justify-between gap-2 mb-1">
                <Badge tone={health.tone}>{health.label}</Badge>
                <span className="text-xs text-muted">{summary.totalSessions} sessions</span>
              </div>
              <div className="h-3.5 rounded bg-surface-2/50 overflow-hidden">
                <div className="h-full rounded" style={{ width: `${health.score}%`, background: barColor(health.tone) }} />
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            Penalizes clashes, full-time workload imbalance, room pressure, data issues, long consecutive blocks, and duplicate groups.
          </p>
          <p className="mt-1 text-xs text-muted">
            {summary.unbalancedLecturers} unbalanced full-time · {summary.partTimeLecturers} part-time flexible
          </p>
        </Card>

        <Card className="p-4 min-w-0 overflow-hidden">
          <SectionTitle>Conflict statistics</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-3 gap-2">
            {[
              { label: "Room", value: summary.roomClashes, tone: summary.roomClashes ? "danger" : "good" },
              { label: "Lecturer", value: summary.lecturerClashes, tone: summary.lecturerClashes ? "danger" : "good" },
              { label: "Cohort", value: summary.cohortClashes, tone: summary.cohortClashes ? "danger" : "good" },
              { label: "Consecutive", value: summary.consecutiveViolations, tone: summary.consecutiveViolations ? "warn" : "good" },
              { label: "Duplicates", value: summary.duplicateScheduleGroups, tone: summary.duplicateScheduleGroups ? "warn" : "good" },
            ].map((item) => (
              <div key={item.label} className="rounded-card border border-rule bg-surface-2/40 px-3 py-2 min-w-0">
                <div className="text-[0.65rem] uppercase tracking-wide text-muted truncate">{item.label}</div>
                <div className="font-mono text-2xl font-semibold" style={{ color: barColor(item.tone as Tone) }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card className="p-4 min-w-0 overflow-hidden">
          <SectionTitle>Weekly workload by lecturer</SectionTitle>
          {weeklyWorkload.length === 0 ? (
            <p className="text-sm text-muted">No lecturer workload data.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-auto pr-1">
              {weeklyWorkload.map((w) => {
                const tone = statusTone(w.status);
                return (
                  <div key={`${w.lecturer}-${w.term}`} className="flex items-center gap-2 text-xs min-w-0">
                    <span className="w-32 shrink-0 truncate text-content" title={w.lecturer}>{w.lecturer}</span>
                    <div className="flex-1 h-3.5 rounded bg-surface-2/50 overflow-hidden min-w-0">
                      <div className="h-full rounded" style={{ width: `${cappedPct(w.totalHours, w.maxHours)}%`, background: barColor(tone) }} />
                    </div>
                    <span className="w-16 shrink-0 text-right font-mono text-muted">{fmtHours(w.totalHours)}/{w.maxHours}h</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-4 min-w-0 overflow-hidden">
          <SectionTitle>Utilization</SectionTitle>
          {utilization.length === 0 ? (
            <p className="text-sm text-muted">No utilization data.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-auto pr-1">
              {utilization.map((w) => {
                const pct = w.utilizationPct;
                const tone = pct === null ? "info" : statusTone(w.status);
                return (
                  <div key={`${w.lecturer}-${w.term}`} className="flex items-center gap-2 text-xs min-w-0">
                    <span className="w-32 shrink-0 truncate text-content" title={w.lecturer}>{w.lecturer}</span>
                    <div className="flex-1 h-3.5 rounded bg-surface-2/50 overflow-hidden min-w-0">
                      <div className="h-full rounded" style={{ width: `${pct === null ? 0 : clamp(pct)}%`, background: barColor(tone) }} />
                    </div>
                    <span className="w-14 shrink-0 text-right font-mono text-muted">{pct === null ? "—" : `${Math.round(pct)}%`}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-4 min-w-0 overflow-hidden">
          <SectionTitle>Workload distribution</SectionTitle>
          <div className="h-5 rounded bg-surface-2/50 overflow-hidden flex">
            {distribution.map((d) => (
              <div
                key={d.status}
                title={`${d.status}: ${d.count}`}
                style={{ width: `${(d.count / totalFaculty) * 100}%`, background: barColor(d.tone) }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {distribution.map((d) => (
              <Badge key={d.status} tone={d.tone}>{d.status}: {d.count}</Badge>
            ))}
          </div>
        </Card>

        <Card className="p-4 min-w-0 overflow-hidden">
          <SectionTitle>Workload balance (Full-Time)</SectionTitle>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { label: "Unbalanced FT", value: loadBalance.unbalanced, tone: "danger" as Tone },
              { label: "Balanced FT", value: loadBalance.balanced, tone: "good" as Tone },
              { label: "Part-Time Flexible", value: loadBalance.partTime, tone: "info" as Tone },
            ].map((item) => (
              <div key={item.label} className="rounded-card border border-rule bg-surface-2/40 p-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted truncate">{item.label}</span>
                  <span className="font-mono text-2xl font-semibold text-ink">{item.value}</span>
                </div>
                <div className="mt-2 h-3.5 rounded bg-surface-2/50 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${(item.value / loadBalance.max) * 100}%`, background: barColor(item.tone) }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Full-Time lecturers are balanced only when their hours match their weekly target; Part-Time lecturers stay flexible.</p>
        </Card>

        <Card className="p-4 min-w-0 overflow-hidden">
          <SectionTitle>Teaching hours by department</SectionTitle>
          {departmentHours.length === 0 ? (
            <p className="text-sm text-muted">No department workload data.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-auto pr-1">
              {departmentHours.map((d) => (
                <div key={d.department} className="flex items-center gap-2 text-xs min-w-0">
                  <span className="w-24 shrink-0 truncate text-content" title={d.department}>{d.department}</span>
                  <div className="flex-1 h-3.5 rounded bg-surface-2/50 overflow-hidden min-w-0">
                    <div className="h-full rounded bg-brass" style={{ width: `${(d.hours / maxDepartmentHours) * 100}%` }} />
                  </div>
                  <span className="w-12 shrink-0 text-right font-mono text-muted">{fmtHours(d.hours)}h</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-muted">For multi-department lecturers, hours are attributed to the first listed department.</p>
        </Card>

        <Card className="p-4 min-w-0 overflow-hidden">
          <SectionTitle>Room utilization</SectionTitle>
          {roomUtilization.length === 0 ? (
            <p className="text-sm text-muted">No room utilization data.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-auto pr-1">
              {roomUtilization.map((r) => {
                const tone = roomUtilTone(r.utilizationPct, thresholds.underutilPct);
                return (
                  <div key={r.room} className="flex items-center gap-2 text-xs min-w-0">
                    <span className="w-20 shrink-0 truncate text-content font-mono" title={r.room}>{r.room}</span>
                    <div className="flex-1 h-3.5 rounded bg-surface-2/50 overflow-hidden min-w-0">
                      <div className="h-full rounded" style={{ width: `${clamp(r.utilizationPct)}%`, background: barColor(tone) }} />
                    </div>
                    <span className="w-14 shrink-0 text-right font-mono text-muted">{r.utilizationPct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
