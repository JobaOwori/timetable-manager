"use client";

import { useMemo, useState } from "react";
import { Download, FileText, Table2 } from "lucide-react";
import { useFilteredSessions, useTermSessions, useAnalysis } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import {
  facultyReport, roomReport, programmeReport,
} from "@/lib/analysis";
import {
  exportCsv, exportExcel, exportPdf, exportGenericCsv, exportGenericExcel,
} from "@/lib/export";
import { Card, SectionTitle, EmptyState } from "@/components/ui/card";
import { Button, Select } from "@/components/ui/button";
import { DataTable, Column } from "@/components/ui/data-table";
import { QualityIssue } from "@/lib/types";
import { toast } from "@/store/useToast";

type Report = "faculty" | "room" | "programme";

export function DataPage() {
  const { filtered } = useFilteredSessions();
  const termSessions = useTermSessions();
  const activeTerm = useStore((s) => s.activeTerm);
  const fileName = useStore((s) => s.fileName);
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const roomRegistry = useStore((s) => s.roomRegistry);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const thresholds = useStore((s) => s.thresholds);
  const { clashes, workload, capacity, quality, summary } = useAnalysis(filtered);

  const base = `${(fileName ?? "timetable").replace(/\.[^.]+$/, "").replace(/\s+/g, "_")}_term${activeTerm}`;

  const qCols: Column<QualityIssue>[] = [
    { key: "rowId", header: "#", align: "right", render: (r) => <span className="font-mono text-muted">{r.rowId}</span> },
    { key: "programme", header: "Prog" },
    { key: "unitCode", header: "Unit" },
    { key: "day", header: "Day" },
    { key: "time", header: "Time" },
    { key: "issues", header: "Issues", render: (r) => <span className="text-content">{r.issues}</span> },
  ];

  const [report, setReport] = useState<Report>("faculty");
  const reportData = useMemo(() => {
    if (report === "faculty")
      return facultyReport(termSessions, roleRegistry, roleMaxHours, departmentRegistry, thresholds) as unknown as Record<string, unknown>[];
    if (report === "room")
      return roomReport(termSessions, roomRegistry, thresholds.underutilPct, thresholds.capacityTolerance) as unknown as Record<string, unknown>[];
    return programmeReport(termSessions, departmentRegistry, roomRegistry) as unknown as Record<string, unknown>[];
  }, [report, termSessions, roleRegistry, roleMaxHours, roomRegistry, departmentRegistry, thresholds]);

  const reportCols: Column<Record<string, unknown>>[] = reportData.length
    ? Object.keys(reportData[0]).map((k) => ({
        key: k,
        header: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
        render: (r) => String(r[k] ?? "—"),
      }))
    : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Data &amp; Export</h1>
        <p className="text-sm text-muted">Data-quality issues, reports, and downloads for Term {activeTerm}.</p>
      </div>

      <Card className="p-4">
        <SectionTitle>Export</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => { exportCsv(termSessions, `${base}.csv`); toast.success(`Downloaded ${base}.csv`, "Export ready"); }}>
            <Table2 size={15} /> Timetable CSV
          </Button>
          <Button onClick={() => { exportExcel(termSessions, clashes, workload, capacity, quality, `${base}.xlsx`); toast.success(`Downloaded ${base}.xlsx`, "Export ready"); }}>
            <Download size={15} /> Excel workbook
          </Button>
          <Button onClick={() => { exportPdf(termSessions, summary, clashes, workload, capacity, quality, `Timetable Manager — Term ${activeTerm}`, `${base}.pdf`); toast.success(`Downloaded ${base}.pdf`, "Export ready"); }}>
            <FileText size={15} /> PDF report
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <SectionTitle className="mb-0 border-0 pb-0">Reports</SectionTitle>
          <div className="flex items-center gap-2">
            <Select
              value={report}
              onChange={(v) => setReport(v as Report)}
              options={[
                { value: "faculty", label: "Faculty report" },
                { value: "room", label: "Room report" },
                { value: "programme", label: "Programme report" },
              ]}
            />
            <Button size="sm" onClick={() => { exportGenericCsv(reportData, `${base}_${report}.csv`); toast.success(`Downloaded ${base}_${report}.csv`, "Export ready"); }}>CSV</Button>
            <Button size="sm" onClick={() => { exportGenericExcel(`${report} report`, reportData, `${base}_${report}.xlsx`); toast.success(`Downloaded ${base}_${report}.xlsx`, "Export ready"); }}>Excel</Button>
          </div>
        </div>
        <DataTable columns={reportCols} rows={reportData} rowKey={(_, i) => i} empty="No data." dense />
      </Card>

      <Card className="p-4">
        <SectionTitle>Data Quality ({quality.length})</SectionTitle>
        {quality.length === 0 ? (
          <EmptyState>No data-quality issues. 🎉</EmptyState>
        ) : (
          <DataTable columns={qCols} rows={quality} rowKey={(r) => r.rowId} empty="None." dense />
        )}
      </Card>
    </div>
  );
}
