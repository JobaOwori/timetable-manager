// Export the (possibly edited) timetable + issue reports to CSV, Excel, PDF.
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { CapacityRow, Clash, QualityIssue, Session, WorkloadRow } from "./types";
import { Summary } from "./analysis";

const DISPLAY_COLUMNS: [keyof Session, string][] = [
  ["programme", "Programme"],
  ["batchCode", "Batch"],
  ["unitCode", "Unit Code"],
  ["unitName", "Unit Name"],
  ["term", "Term"],
  ["dayRaw", "Day"],
  ["timeRaw", "Time"],
  ["room", "Room"],
  ["lecturerRaw", "Lecturer"],
  ["headCount", "Head Count"],
  ["capacityListed", "Capacity"],
];

function sessionsToAoA(sessions: Session[]): (string | number)[][] {
  const header = DISPLAY_COLUMNS.map(([, label]) => label);
  const rows = sessions.map((s) =>
    DISPLAY_COLUMNS.map(([key]) => {
      const v = s[key];
      return v === null || v === undefined ? "" : (v as string | number);
    }),
  );
  return [header, ...rows];
}

export function downloadBlob(data: BlobPart, filename: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportCsv(sessions: Session[], filename: string) {
  const ws = XLSX.utils.aoa_to_sheet(sessionsToAoA(sessions));
  const csv = XLSX.utils.sheet_to_csv(ws);
  downloadBlob(csv, filename, "text/csv;charset=utf-8");
}

function objArrayToSheet(rows: Record<string, unknown>[]): XLSX.WorkSheet {
  if (!rows.length) return XLSX.utils.aoa_to_sheet([["No data"]]);
  return XLSX.utils.json_to_sheet(rows);
}

export function exportExcel(
  sessions: Session[],
  clashes: Clash[],
  workload: WorkloadRow[],
  capacity: CapacityRow[],
  quality: QualityIssue[],
  filename: string,
) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sessionsToAoA(sessions)), "Timetable");
  XLSX.utils.book_append_sheet(
    wb,
    objArrayToSheet(clashes as unknown as Record<string, unknown>[]),
    "Clashes",
  );
  XLSX.utils.book_append_sheet(
    wb,
    objArrayToSheet(workload as unknown as Record<string, unknown>[]),
    "Lecturer Workload",
  );
  XLSX.utils.book_append_sheet(
    wb,
    objArrayToSheet(capacity as unknown as Record<string, unknown>[]),
    "Room Capacity",
  );
  XLSX.utils.book_append_sheet(
    wb,
    objArrayToSheet(quality as unknown as Record<string, unknown>[]),
    "Data Quality",
  );
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(
    out,
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}

export function exportPdf(
  sessions: Session[],
  summary: Summary,
  clashes: Clash[],
  workload: WorkloadRow[],
  capacity: CapacityRow[],
  quality: QualityIssue[],
  title: string,
  filename: string,
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
  const marginL = 28;
  doc.setFontSize(20);
  doc.text(title, marginL, 40);
  doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), marginL, 58);

  const summaryRows = Object.entries(summary).map(([k, v]) => [
    k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
    String(v),
  ]);
  autoTable(doc, {
    startY: 74,
    head: [["Metric", "Count"]],
    body: summaryRows,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [27, 41, 66] },
  });

  const tt = sessionsToAoA(sessions);
  doc.addPage();
  doc.setFontSize(14);
  doc.text("Timetable", marginL, 40);
  autoTable(doc, {
    startY: 54,
    head: [tt[0] as string[]],
    body: tt.slice(1) as (string | number)[][],
    styles: { fontSize: 6.5 },
    headStyles: { fillColor: [27, 41, 66] },
  });

  const section = (name: string, rows: Record<string, unknown>[]) => {
    doc.addPage();
    doc.setFontSize(14);
    doc.text(name, marginL, 40);
    if (!rows.length) {
      doc.setFontSize(10);
      doc.text("None.", marginL, 60);
      return;
    }
    const cols = Object.keys(rows[0]);
    autoTable(doc, {
      startY: 54,
      head: [cols],
      body: rows.map((r) => cols.map((c) => String(r[c] ?? ""))),
      styles: { fontSize: 6.5 },
      headStyles: { fillColor: [27, 41, 66] },
    });
  };
  section("Clashes", clashes as unknown as Record<string, unknown>[]);
  section("Lecturer Workload", workload as unknown as Record<string, unknown>[]);
  section(
    "Room Capacity Issues",
    capacity.filter((c) => c.capacityStatus !== "OK") as unknown as Record<string, unknown>[],
  );
  section("Data Quality Issues", quality as unknown as Record<string, unknown>[]);

  doc.save(filename);
}

export function exportGenericCsv(rows: Record<string, unknown>[], filename: string) {
  const ws = objArrayToSheet(rows);
  downloadBlob(XLSX.utils.sheet_to_csv(ws), filename, "text/csv;charset=utf-8");
}

export function exportGenericExcel(sheetName: string, rows: Record<string, unknown>[], filename: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, objArrayToSheet(rows), sheetName.slice(0, 31));
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(out, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
