// Ingestion: turn an uploaded CSV/XLSX file into canonical Session[]. Ports src/ingest.py.
import * as XLSX from "xlsx";
import {
  CanonicalField,
  ColumnMapping,
  RoomRegistry,
  Session,
} from "./types";
import {
  formatTimeRange,
  isBlank,
  normalizeCode,
  normalizeDay,
  normalizeLecturer,
  normalizeRoom,
  normalizeText,
  parseTimeRange,
  toNumber,
} from "./clean";

// Canonical field -> header aliases (normalized: lowercase, alnum only).
const COLUMN_ALIASES: Record<CanonicalField, string[]> = {
  programme: ["programm", "programme", "program"],
  semCode: ["semcode", "semestercode", "sem"],
  batchCode: ["batchcode", "batch", "cohort", "group", "class"],
  unitCode: ["unitcode", "coursecode", "code"],
  unitName: ["unitname", "coursename", "course", "unit", "unittitle", "coursetitle"],
  term: ["term"],
  day: ["wday", "day", "weekday", "dayofweek"],
  timeRaw: ["time", "timeslot", "period", "timeslotrange"],
  hours: ["hours", "duration", "credithours", "durationhours"],
  room: ["roomcode", "room", "roomno", "venue"],
  capacityListed: ["capacity", "roomcapacity", "seats"],
  lecturer: ["faculty", "lecturer", "instructor", "tutor", "staff", "username"],
  headCount: [
    "headcount", "enrollment", "enrolled", "classsize", "students",
    "noofstudents", "numberofstudents",
  ],
  notes: ["comment", "comments", "notes", "remark", "remarks"],
};

export const ALL_FIELDS = Object.keys(COLUMN_ALIASES) as CanonicalField[];
export const REQUIRED_FIELDS: CanonicalField[] = ["day", "timeRaw", "room", "lecturer"];

const FIELD_LABELS: Record<CanonicalField, string> = {
  programme: "Programme", semCode: "Semester", batchCode: "Batch", unitCode: "Unit Code",
  unitName: "Unit Name", term: "Term", day: "Day", timeRaw: "Time", hours: "Hours",
  room: "Room", capacityListed: "Capacity", lecturer: "Lecturer", headCount: "Head Count",
  notes: "Notes",
};
export const fieldLabel = (f: CanonicalField) => FIELD_LABELS[f];

function normHeader(h: unknown): string {
  return String(h).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function autoMapColumns(columns: string[]): ColumnMapping {
  const normalized = new Map<string, string>();
  for (const c of columns) normalized.set(normHeader(c), c);
  const mapping: ColumnMapping = {};
  for (const field of ALL_FIELDS) {
    for (const alias of COLUMN_ALIASES[field]) {
      const key = normHeader(alias);
      if (normalized.has(key)) {
        mapping[field] = normalized.get(key)!;
        break;
      }
    }
  }
  return mapping;
}

export interface SheetTable {
  header: string[];
  rows: Record<string, unknown>[];
}

export function readWorkbook(data: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(data, { type: "array" });
}

export function sheetNames(wb: XLSX.WorkBook): string[] {
  return wb.SheetNames;
}

export function readSheet(wb: XLSX.WorkBook, name: string): SheetTable {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  const header = rows.length ? Object.keys(rows[0]) : [];
  // Also capture header even for empty-ish first row by reading with header:1
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  const hdr = (matrix[0] as unknown[])?.map((h) => String(h ?? "")) ?? header;
  return { header: hdr.filter(Boolean), rows };
}

export function readCsv(text: string): SheetTable {
  const wb = XLSX.read(text, { type: "string" });
  return readSheet(wb, wb.SheetNames[0]);
}

export function guessTimetableSheet(names: string[]): string | null {
  for (const name of names) {
    const n = name.trim().toLowerCase();
    if (n.includes("time table") || n.includes("timetable") || n.includes("schedule")) return name;
  }
  return null;
}

export function guessRoomSheet(names: string[]): string | null {
  for (const name of names) {
    const n = name.trim().toLowerCase();
    if (n.includes("room") && (n.includes("capacit") || n.includes("seating"))) return name;
  }
  return null;
}

const SECTION_RE = /FLOOR|BLOCK/i;
const SKIP_LABELS = new Set(["TOTAL", "CLASSROOMSEATINGCAPACITIES"]);

/** Parse a (possibly floor-grouped) room-capacity sheet into { room: capacity }. */
export function parseRoomRegistry(wb: XLSX.WorkBook, sheetName: string): RoomRegistry {
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  const registry: RoomRegistry = {};
  let isBlock = false;
  for (const row of matrix) {
    if (!row || row.length === 0) continue;
    const first = row[0];
    const capRaw = row.length > 1 ? row[1] : null;
    const label = normalizeText(first);
    if (label === null) continue;
    const labelKey = label.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (SKIP_LABELS.has(labelKey) || labelKey.includes("QUANTITY")) continue;
    if (SECTION_RE.test(label)) {
      isBlock = label.toUpperCase().includes("BLOCK");
      continue;
    }
    let code = normalizeCode(first);
    if (code === null) continue;
    if (isBlock && !code.startsWith("B")) code = "B" + code;
    const cap = toNumber(capRaw);
    if (cap !== null) registry[code] = cap;
  }
  return registry;
}

/** Drop rows that are entirely blank across every mapped field. */
export function dropBlankRows(table: SheetTable, mapping: ColumnMapping): Record<string, unknown>[] {
  const mappedCols = (Object.values(mapping) as string[]).filter((c) => table.header.includes(c));
  if (mappedCols.length === 0) return table.rows;
  return table.rows.filter((r) => mappedCols.some((c) => !isBlank(r[c])));
}

/** Apply the mapping + normalize every field into canonical Session[]. */
export function buildSessions(rows: Record<string, unknown>[], mapping: ColumnMapping): Session[] {
  const mappedCols = new Set(Object.values(mapping) as string[]);
  const sessions: Session[] = [];

  rows.forEach((row, i) => {
    const get = (f: CanonicalField): unknown => {
      const src = mapping[f];
      return src !== undefined ? row[src] : null;
    };

    const parsed = parseTimeRange(get("timeRaw"));
    const hoursListed = toNumber(get("hours"));
    const computedDuration =
      parsed.startMin !== null && parsed.endMin !== null && parsed.endMin > parsed.startMin
        ? (parsed.endMin - parsed.startMin) / 60
        : null;
    const { room, isVirtual } = normalizeRoom(get("room"));

    // Fold stray/unnamed columns into notes so admin annotations aren't lost.
    const extraNotes: string[] = [];
    const baseNote = normalizeText(get("notes"));
    if (baseNote) extraNotes.push(baseNote);
    for (const key of Object.keys(row)) {
      if (!mappedCols.has(key)) {
        const v = normalizeText(row[key]);
        if (v) extraNotes.push(v);
      }
    }

    sessions.push({
      rowId: i + 1,
      programme: normalizeText(get("programme")),
      semCode: normalizeCode(get("semCode"), false),
      batchCode: normalizeText(get("batchCode")),
      unitCode: normalizeText(get("unitCode")),
      unitName: normalizeText(get("unitName")),
      term: normalizeCode(get("term"), false),
      day: normalizeDay(get("day")),
      dayRaw: normalizeText(get("day")),
      timeRaw: normalizeText(get("timeRaw")),
      startMin: parsed.startMin,
      endMin: parsed.endMin,
      timeError: parsed.error,
      hoursListed,
      durationHours: computedDuration ?? hoursListed,
      workloadHours: hoursListed ?? computedDuration,
      room,
      isVirtualRoom: isVirtual,
      capacityListed: toNumber(get("capacityListed")),
      lecturer: normalizeLecturer(get("lecturer")),
      lecturerRaw: normalizeText(get("lecturer")),
      headCount: toNumber(get("headCount")),
      notes: extraNotes.length ? extraNotes.join("; ") : null,
    });
  });

  return sessions;
}

/** Recompute derived fields after a direct edit (used by the editor + transfer). */
export function finalizeSession(s: Session): Session {
  const startMin = s.startMin;
  const endMin = s.endMin;
  let timeError = s.timeError;
  if (startMin === null || endMin === null) timeError = "missing";
  else if (endMin <= startMin) timeError = "end_before_start";
  else timeError = null;
  const computed = startMin !== null && endMin !== null && endMin > startMin ? (endMin - startMin) / 60 : null;
  const { room, isVirtual } = normalizeRoom(s.room);
  return {
    ...s,
    timeRaw: formatTimeRange(startMin, endMin) || s.timeRaw,
    timeError,
    room,
    isVirtualRoom: isVirtual,
    lecturer: normalizeLecturer(s.lecturerRaw ?? s.lecturer),
    durationHours: computed ?? s.hoursListed,
    workloadHours: s.hoursListed ?? computed,
  };
}
