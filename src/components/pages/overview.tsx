"use client";

import { useFilteredSessions, useAnalysis } from "@/store/selectors";
import { StatCard } from "@/components/ui/stat-card";
import { Card, SectionTitle } from "@/components/ui/card";
import { WorkloadStatus } from "@/lib/types";
import { STATUS_TONE } from "@/lib/roles";

export function OverviewPage({ onNavigate }: { onNavigate: (t: "resolve" | "faculty" | "rooms" | "data") => void }) {
  const { filtered } = useFilteredSessions();
  const { workload, summary, capacity } = useAnalysis(filtered);

  const tone = (n: number, warn = false): "good" | "warn" | "danger" =>
    n === 0 ? "good" : warn ? "warn" : "danger";

  const roomCounts = (() => {
    const m = new Map<string, number>();
    for (const s of filtered) if (s.room && !s.isVirtualRoom) m.set(s.room, (m.get(s.room) ?? 0) + 1);
    return [...m.entries()].map(([room, n]) => ({ room, n })).sort((a, b) => b.n - a.n).slice(0, 16);
  })();
  const maxRoom = Math.max(1, ...roomCounts.map((r) => r.n));

  const topWorkload = workload.slice(0, 16);
  const maxWl = Math.max(1, ...topWorkload.map((w) => w.totalHours));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Sessions" value={summary.totalSessions} tone="neutral" />
        <StatCard label="Room Clashes" value={summary.roomClashes} tone={tone(summary.roomClashes)} onClick={() => onNavigate("resolve")} />
        <StatCard label="Lecturer Clashes" value={summary.lecturerClashes} tone={tone(summary.lecturerClashes)} onClick={() => onNavigate("resolve")} />
        <StatCard label="Cohort Clashes" value={summary.cohortClashes} tone={tone(summary.cohortClashes)} onClick={() => onNavigate("resolve")} />
        <StatCard label="Unbalanced FT" value={summary.unbalancedLecturers} tone={tone(summary.unbalancedLecturers)} onClick={() => onNavigate("faculty")} />
        <StatCard label="Part-Time" value={summary.partTimeLecturers} tone="info" onClick={() => onNavigate("faculty")} />
        <StatCard label="Over Capacity" value={summary.overCapacitySessions} tone={tone(summary.overCapacitySessions)} onClick={() => onNavigate("rooms")} />
        <StatCard label="Data Issues" value={summary.dataQualityIssues} tone={tone(summary.dataQualityIssues, true)} onClick={() => onNavigate("data")} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card className="p-4">
          <SectionTitle>Lecturer Workload</SectionTitle>
          {topWorkload.length === 0 ? (
            <p className="text-sm text-muted">No lecturer data.</p>
          ) : (
            <div className="space-y-1.5">
              {topWorkload.map((w) => (
                <div key={w.lecturer} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate text-content" title={w.lecturer}>{w.lecturer}</span>
                  <div className="flex-1 h-3.5 rounded bg-surface-2/50 overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${(w.totalHours / maxWl) * 100}%`,
                        background: `rgb(var(--${STATUS_TONE[w.status as WorkloadStatus] === "red" ? "danger" : STATUS_TONE[w.status as WorkloadStatus] === "amber" ? "warn" : "good"}))`,
                      }}
                    />
                  </div>
                  <span className="w-14 text-right font-mono text-muted">{w.totalHours}/{w.maxHours}h</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle>Busiest Rooms</SectionTitle>
          {roomCounts.length === 0 ? (
            <p className="text-sm text-muted">No room data.</p>
          ) : (
            <div className="space-y-1.5">
              {roomCounts.map((r) => (
                <div key={r.room} className="flex items-center gap-2 text-xs">
                  <span className="w-14 truncate text-content font-mono">{r.room}</span>
                  <div className="flex-1 h-3.5 rounded bg-surface-2/50 overflow-hidden">
                    <div className="h-full rounded bg-info" style={{ width: `${(r.n / maxRoom) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono text-muted">{r.n}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle>Capacity Health</SectionTitle>
        <div className="flex flex-wrap gap-2 text-xs">
          {(["Over Capacity", "Within Tolerance", "Underutilized", "OK", "Unknown Capacity", "No Headcount Data"] as const).map((st) => {
            const n = capacity.filter((c) => c.capacityStatus === st).length;
            return (
              <div key={st} className="rounded border border-rule bg-surface-2/40 px-3 py-1.5">
                <span className="text-muted">{st}: </span>
                <span className="font-mono font-semibold text-ink">{n}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
