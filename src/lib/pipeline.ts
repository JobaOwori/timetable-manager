// Pure ingest pipeline: file bytes / CSV text -> a fully prepared payload
// (normalized sessions, room registry, seeded role/department registries,
// subject assignments, term list, with duplicate faculty already merged).
//
// Kept free of React/DOM so it can run either on the main thread or inside a
// Web Worker (see src/workers/ingest.worker.ts) to avoid freezing the UI while
// parsing large workbooks.
import * as XLSX from "xlsx";
import {
  ColumnMapping,
  DepartmentRegistry,
  RoleRegistry,
  RoomRegistry,
  Session,
} from "./types";
import {
  ALL_FIELDS,
  autoMapColumns,
  buildSessions,
  dropBlankRows,
  guessRoomSheet,
  guessTimetableSheet,
  parseRoomRegistry,
  readCsv,
  readSheet,
  readWorkbook,
  sheetNames,
} from "./ingest";
import {
  applyFacultyMerge,
  facultyDedupMap,
  subjectAssignmentsFromSessions,
} from "./faculty";
import { seedFacultyTypes } from "./facultyType";
import { DEFAULT_PROGRAMME_DEPARTMENT } from "./departments";
import { DEFAULT_ROLE } from "./roles";

export interface IngestResult {
  sessions: Session[];
  roomRegistry: RoomRegistry;
  roleRegistry: RoleRegistry;
  departmentRegistry: DepartmentRegistry;
  subjectAssignments: Record<string, string[]>;
  facultyTypeRegistry: Record<string, "FT" | "PT">;
  terms: string[];
}

function seedRegistriesFromSessions(sessions: Session[]) {
  const roleRegistry: RoleRegistry = {};
  for (const l of new Set(sessions.map((s) => s.lecturer).filter((x): x is string => !!x))) {
    roleRegistry[l] = DEFAULT_ROLE;
  }
  const departmentRegistry: DepartmentRegistry = {};
  for (const p of new Set(sessions.map((s) => s.programme).filter((x): x is string => !!x))) {
    const key = p.toUpperCase();
    departmentRegistry[key] = DEFAULT_PROGRAMME_DEPARTMENT[key] ?? "";
  }
  return { roleRegistry, departmentRegistry };
}

function distinctTerms(sessions: Session[]): string[] {
  return [...new Set(sessions.map((s) => s.term).filter((t): t is string => !!t))].sort();
}

/** Merge duplicate faculty, then seed all registries + derived data. */
function finish(rawSessions: Session[], roomRegistry: RoomRegistry): IngestResult {
  const sessions = applyFacultyMerge(rawSessions, facultyDedupMap(rawSessions));
  const { roleRegistry, departmentRegistry } = seedRegistriesFromSessions(sessions);
  const subjectAssignments = subjectAssignmentsFromSessions(sessions);
  const facultyTypeRegistry = seedFacultyTypes(sessions);
  const terms = distinctTerms(sessions);
  return { sessions, roomRegistry, roleRegistry, departmentRegistry, subjectAssignments, facultyTypeRegistry, terms };
}

/** Parse an uploaded .xlsx/.xls ArrayBuffer into a prepared payload. */
export function ingestArrayBuffer(buf: ArrayBuffer): IngestResult {
  const wb = readWorkbook(buf);
  const names = sheetNames(wb);
  const ttSheet = guessTimetableSheet(names) ?? names[0];
  const table = readSheet(wb, ttSheet);
  const mapping: ColumnMapping = autoMapColumns(table.header);
  void ALL_FIELDS;
  const rows = dropBlankRows(table, mapping);
  const rawSessions = buildSessions(rows, mapping);
  const roomSheet = guessRoomSheet(names);
  const roomRegistry = roomSheet ? parseRoomRegistry(wb, roomSheet) : {};
  return finish(rawSessions, roomRegistry);
}

/** Parse uploaded CSV text into a prepared payload. */
export function ingestCsvText(text: string): IngestResult {
  const table = readCsv(text);
  const mapping = autoMapColumns(table.header);
  const rows = dropBlankRows(table, mapping);
  const rawSessions = buildSessions(rows, mapping);
  return finish(rawSessions, {});
}

// Re-export XLSX presence check for callers that only need parsing capability.
export const canParse = typeof XLSX !== "undefined";
