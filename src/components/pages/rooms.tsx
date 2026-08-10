"use client";

import { useMemo, useState } from "react";
import { useFilteredSessions, useTermSessions } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { roomReport, capacityAnalysis } from "@/lib/analysis";
import { buildGrid } from "@/lib/grid";
import { Card, SectionTitle, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/button";
import { DataTable, Column } from "@/components/ui/data-table";
import { GridView } from "@/components/ui/grid-view";
import type { RoomReportRow } from "@/lib/analysis";

export function RoomsPage() {
  const { filtered } = useFilteredSessions();
  const roomRegistry = useStore((s) => s.roomRegistry);
  const thresholds = useStore((s) => s.thresholds);

  const report = useMemo(
    () => roomReport(filtered, roomRegistry, thresholds.underutilPct, thresholds.capacityTolerance),
    [filtered, roomRegistry, thresholds],
  );

  const columns: Column<RoomReportRow>[] = [
    { key: "room", header: "Room", render: (r) => <span className="font-mono font-medium text-ink">{r.room}</span> },
    { key: "capacity", header: "Cap", align: "right", render: (r) => r.capacity ?? "—" },
    { key: "classes", header: "Classes", align: "right" },
    { key: "avgHeadCount", header: "Avg HC", align: "right", render: (r) => r.avgHeadCount ?? "—" },
    {
      key: "utilizationPct",
      header: "Util %",
      align: "right",
      render: (r) =>
        r.utilizationPct === null ? (
          "—"
        ) : (
          <span className={`font-mono ${r.utilizationPct > 100 ? "text-danger" : r.utilizationPct < thresholds.underutilPct * 100 ? "text-warn" : "text-good"}`}>
            {r.utilizationPct}%
          </span>
        ),
    },
    { key: "overCapacity", header: "Over", align: "right", render: (r) => (r.overCapacity ? <span className="text-danger font-mono">{r.overCapacity}</span> : "0") },
    { key: "doubleBookings", header: "Clashes", align: "right", render: (r) => (r.doubleBookings ? <span className="text-danger font-mono">{r.doubleBookings}</span> : "0") },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Rooms</h1>
        <p className="text-sm text-muted">Capacity utilization and double-bookings per room.</p>
      </div>

      <RoomDrilldown />

      <Card className="p-4">
        <SectionTitle>Room Report</SectionTitle>
        <DataTable columns={columns} rows={report} rowKey={(r) => r.room} empty="No rooms." dense />
      </Card>
    </div>
  );
}

function RoomDrilldown() {
  const termSessions = useTermSessions();
  const roomRegistry = useStore((s) => s.roomRegistry);
  const thresholds = useStore((s) => s.thresholds);
  const rooms = useMemo(
    () => [...new Set(termSessions.filter((s) => !s.isVirtualRoom).map((s) => s.room).filter((x): x is string => !!x))].sort(),
    [termSessions],
  );
  const [pick, setPick] = useState("");
  const chosen = pick && rooms.includes(pick) ? pick : rooms[0] ?? "";
  const mine = termSessions.filter((s) => s.room === chosen);
  const cap = roomRegistry[chosen] ?? null;
  const hcVals = mine.map((s) => s.headCount).filter((h): h is number => h !== null);
  const avgHc = hcVals.length ? hcVals.reduce((a, b) => a + b, 0) / hcVals.length : null;
  const util = cap && avgHc !== null ? Math.round((avgHc / cap) * 100) : null;
  const grid = useMemo(() => buildGrid(mine, ["unitCode", "unitName", "lecturer", "programme"]), [mine]);
  const capRows = useMemo(
    () => capacityAnalysis(mine, roomRegistry, thresholds.underutilPct, thresholds.capacityTolerance).filter((c) => c.capacityStatus !== "OK"),
    [mine, roomRegistry, thresholds],
  );

  if (!rooms.length) return <EmptyState>No rooms in this term.</EmptyState>;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1">Inspect room</label>
          <Select value={chosen} onChange={setPick} options={rooms.map((r) => ({ value: r, label: r }))} className="w-full" />
        </div>
        <div className="flex gap-2">
          <Badge tone="neutral">Cap {cap ?? "?"}</Badge>
          <Badge tone="neutral">{mine.length} sessions</Badge>
          {util !== null && <Badge tone={util > 100 ? "danger" : util < thresholds.underutilPct * 100 ? "warn" : "good"}>{util}% util</Badge>}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div>
          <SectionTitle>Weekly schedule</SectionTitle>
          <GridView grid={grid} />
        </div>
        <div>
          <SectionTitle>Capacity flags</SectionTitle>
          {capRows.length === 0 ? (
            <p className="text-xs text-muted">No capacity issues for this room.</p>
          ) : (
            <div className="space-y-1">
              {capRows.map((c) => (
                <div key={c.rowId} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-ink">{c.unitCode}</span>
                  <span className="text-muted flex-1 truncate">{c.day} · {c.headCount ?? "?"}/{c.trueCapacity ?? "?"}</span>
                  <Badge tone={c.capacityStatus === "Over Capacity" ? "danger" : c.capacityStatus === "Within Tolerance" ? "warn" : "info"}>
                    {c.capacityStatus}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
