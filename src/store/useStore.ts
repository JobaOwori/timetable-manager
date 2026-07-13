"use client";

import { create } from "zustand";
import * as XLSX from "xlsx";
import {
  ColumnMapping,
  DayCode,
  DEFAULT_THRESHOLDS,
  DepartmentRegistry,
  RoleMaxHours,
  RoleRegistry,
  RoomRegistry,
  Session,
  Thresholds,
} from "@/lib/types";
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
} from "@/lib/ingest";
import { DEFAULT_PROGRAMME_DEPARTMENT } from "@/lib/departments";
import { DEFAULT_ROLE, ROLE_MAX_HOURS } from "@/lib/roles";
import { applyRoomChange, applyReschedule, applyTransfer } from "@/lib/transfer";
import { finalizeSession } from "@/lib/ingest";
import {
  applyFacultyMerge,
  facultyDedupMap,
  mergeLecturer,
  subjectAssignmentsFromSessions,
} from "@/lib/faculty";
import { autoResolve, AutoResolveOptions, ResolveResult } from "@/lib/resolve";

interface State {
  fileName: string | null;
  loaded: boolean;
  originalSessions: Session[];
  sessions: Session[]; // working copy
  roomRegistry: RoomRegistry;
  roleRegistry: RoleRegistry;
  roleMaxHours: RoleMaxHours;
  departmentRegistry: DepartmentRegistry;
  subjectAssignments: Record<string, string[]>; // lecturer -> unit codes
  thresholds: Thresholds;
  activeTerm: string | null;
  terms: string[];
  // filters
  fPrograms: string[];
  fLecturers: string[];
  fRooms: string[];
  fDays: string[];
  fDepartments: string[];

  loadArrayBuffer: (buf: ArrayBuffer, name: string) => void;
  loadCsvText: (text: string, name: string) => void;
  loadSampleFromUrl: (url: string) => Promise<void>;
  setActiveTerm: (t: string) => void;
  setRoomRegistry: (r: RoomRegistry) => void;
  setRole: (lecturer: string, role: string) => void;
  setRoleMaxHours: (r: RoleMaxHours) => void;
  setDepartment: (programme: string, dept: string) => void;
  setThreshold: <K extends keyof Thresholds>(k: K, v: Thresholds[K]) => void;
  setFilter: (key: "fPrograms" | "fLecturers" | "fRooms" | "fDays" | "fDepartments", v: string[]) => void;
  assignSubject: (lecturer: string, unitCode: string) => void;
  unassignSubject: (lecturer: string, unitCode: string) => void;
  mergeFaculty: (from: string, to: string) => void;
  dedupeFaculty: () => number;
  transferLecturer: (rowId: number, newLecturer: string) => void;
  changeRoom: (rowId: number, newRoom: string) => void;
  reschedule: (rowId: number, day: DayCode, startMin: number, endMin: number) => void;
  autoResolve: (opts: AutoResolveOptions, run?: Parameters<typeof autoResolve>[2]) => ResolveResult;
  updateSession: (rowId: number, patch: Partial<Session>) => void;
  resetEdits: () => void;
}

const PERSIST_KEY = "ttlite-config-v1";

interface Persisted {
  roleMaxHours?: RoleMaxHours;
  thresholds?: Thresholds;
}

function loadPersisted(): Persisted {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function persist(p: Persisted) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function seedRegistriesFromSessions(sessions: Session[]) {
  const roleRegistry: RoleRegistry = {};
  for (const l of new Set(sessions.map((s) => s.lecturer).filter((x): x is string => !!x))) {
    roleRegistry[l] = DEFAULT_ROLE;
  }
  const departmentRegistry: DepartmentRegistry = {};
  for (const p of new Set(sessions.map((s) => s.programme).filter((x): x is string => !!x))) {
    // Key canonically by uppercase so it matches departmentFor()/setDepartment(),
    // which both look up by programme.toUpperCase().
    const key = p.toUpperCase();
    departmentRegistry[key] = DEFAULT_PROGRAMME_DEPARTMENT[key] ?? "";
  }
  return { roleRegistry, departmentRegistry };
}

function distinctTerms(sessions: Session[]): string[] {
  return [...new Set(sessions.map((s) => s.term).filter((t): t is string => !!t))].sort();
}

/** Shared post-ingest pipeline: merge duplicate faculty, then seed all registries. */
function prepare(rawSessions: Session[]) {
  const sessions = applyFacultyMerge(rawSessions, facultyDedupMap(rawSessions));
  const { roleRegistry, departmentRegistry } = seedRegistriesFromSessions(sessions);
  const subjectAssignments = subjectAssignmentsFromSessions(sessions);
  const terms = distinctTerms(sessions);
  return { sessions, roleRegistry, departmentRegistry, subjectAssignments, terms };
}

function ingestWorkbook(wb: XLSX.WorkBook): { sessions: Session[]; roomRegistry: RoomRegistry } {
  const names = sheetNames(wb);
  const ttSheet = guessTimetableSheet(names) ?? names[0];
  const table = readSheet(wb, ttSheet);
  const mapping: ColumnMapping = autoMapColumns(table.header);
  // ensure all fields considered even if not mapped
  void ALL_FIELDS;
  const rows = dropBlankRows(table, mapping);
  const sessions = buildSessions(rows, mapping);
  const roomSheet = guessRoomSheet(names);
  const roomRegistry = roomSheet ? parseRoomRegistry(wb, roomSheet) : {};
  return { sessions, roomRegistry };
}

export const useStore = create<State>((set, get) => ({
  fileName: null,
  loaded: false,
  originalSessions: [],
  sessions: [],
  roomRegistry: {},
  roleRegistry: {},
  roleMaxHours: loadPersisted().roleMaxHours ?? { ...ROLE_MAX_HOURS },
  departmentRegistry: {},
  subjectAssignments: {},
  thresholds: loadPersisted().thresholds ?? { ...DEFAULT_THRESHOLDS },
  activeTerm: null,
  terms: [],
  fPrograms: [],
  fLecturers: [],
  fRooms: [],
  fDays: [],
  fDepartments: [],

  loadArrayBuffer: (buf, name) => {
    const wb = readWorkbook(buf);
    const { sessions: raw, roomRegistry } = ingestWorkbook(wb);
    const { sessions, roleRegistry, departmentRegistry, subjectAssignments, terms } = prepare(raw);
    set({
      fileName: name,
      loaded: true,
      originalSessions: sessions,
      sessions,
      roomRegistry,
      roleRegistry,
      departmentRegistry,
      subjectAssignments,
      terms,
      activeTerm: terms[0] ?? null,
      fPrograms: [], fLecturers: [], fRooms: [], fDays: [], fDepartments: [],
    });
  },

  loadCsvText: (text, name) => {
    const table = readCsv(text);
    const mapping = autoMapColumns(table.header);
    const rows = dropBlankRows(table, mapping);
    const raw = buildSessions(rows, mapping);
    const { sessions, roleRegistry, departmentRegistry, subjectAssignments, terms } = prepare(raw);
    set({
      fileName: name, loaded: true, originalSessions: sessions, sessions,
      roomRegistry: {}, roleRegistry, departmentRegistry, subjectAssignments, terms,
      activeTerm: terms[0] ?? null,
      fPrograms: [], fLecturers: [], fRooms: [], fDays: [], fDepartments: [],
    });
  },

  loadSampleFromUrl: async (url) => {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    get().loadArrayBuffer(buf, "sample_timetable.xlsx");
  },

  setActiveTerm: (t) => set({ activeTerm: t, fPrograms: [], fLecturers: [], fRooms: [], fDays: [], fDepartments: [] }),
  setRoomRegistry: (r) => set({ roomRegistry: r }),
  setRole: (lecturer, role) =>
    set((s) => ({ roleRegistry: { ...s.roleRegistry, [lecturer]: role } })),
  setRoleMaxHours: (r) => {
    persist({ ...loadPersisted(), roleMaxHours: r });
    set({ roleMaxHours: r });
  },
  setDepartment: (programme, dept) =>
    set((s) => ({ departmentRegistry: { ...s.departmentRegistry, [programme.toUpperCase()]: dept } })),
  setThreshold: (k, v) =>
    set((s) => {
      const thresholds = { ...s.thresholds, [k]: v };
      persist({ ...loadPersisted(), thresholds });
      return { thresholds };
    }),
  setFilter: (key, v) => set({ [key]: v } as Pick<State, typeof key>),

  assignSubject: (lecturer, unitCode) =>
    set((s) => {
      const cur = s.subjectAssignments[lecturer] ?? [];
      if (cur.includes(unitCode)) return {};
      return { subjectAssignments: { ...s.subjectAssignments, [lecturer]: [...cur, unitCode].sort() } };
    }),
  unassignSubject: (lecturer, unitCode) =>
    set((s) => {
      const cur = s.subjectAssignments[lecturer] ?? [];
      return { subjectAssignments: { ...s.subjectAssignments, [lecturer]: cur.filter((u) => u !== unitCode) } };
    }),
  mergeFaculty: (from, to) =>
    set((s) => {
      const sessions = mergeLecturer(s.sessions, from, to);
      const roleRegistry = { ...s.roleRegistry };
      if (roleRegistry[from] && !roleRegistry[to]) roleRegistry[to] = roleRegistry[from];
      delete roleRegistry[from];
      const subjectAssignments = { ...s.subjectAssignments };
      const merged = [...new Set([...(subjectAssignments[to] ?? []), ...(subjectAssignments[from] ?? [])])].sort();
      if (merged.length) subjectAssignments[to] = merged;
      delete subjectAssignments[from];
      return { sessions, roleRegistry, subjectAssignments };
    }),
  dedupeFaculty: () => {
    const map = facultyDedupMap(get().sessions);
    const count = Object.keys(map).length;
    if (count === 0) return 0;
    set((s) => {
      const sessions = applyFacultyMerge(s.sessions, map);
      const roleRegistry = { ...s.roleRegistry };
      const subjectAssignments = { ...s.subjectAssignments };
      for (const [from, to] of Object.entries(map)) {
        if (roleRegistry[from] && !roleRegistry[to]) roleRegistry[to] = roleRegistry[from];
        delete roleRegistry[from];
        const merged = [...new Set([...(subjectAssignments[to] ?? []), ...(subjectAssignments[from] ?? [])])].sort();
        if (merged.length) subjectAssignments[to] = merged;
        delete subjectAssignments[from];
      }
      return { sessions, roleRegistry, subjectAssignments };
    });
    return count;
  },

  transferLecturer: (rowId, newLecturer) =>
    set((s) => ({ sessions: applyTransfer(s.sessions, rowId, newLecturer) })),
  changeRoom: (rowId, newRoom) =>
    set((s) => ({ sessions: applyRoomChange(s.sessions, rowId, newRoom) })),
  reschedule: (rowId, day, startMin, endMin) =>
    set((s) => ({ sessions: applyReschedule(s.sessions, rowId, day, startMin, endMin) })),
  autoResolve: (opts, run) => {
    const result = autoResolve(get().sessions, opts, run);
    set({ sessions: result.sessions });
    return result;
  },
  updateSession: (rowId, patch) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.rowId === rowId ? finalizeSession({ ...sess, ...patch }) : sess,
      ),
    })),
  resetEdits: () => set((s) => ({ sessions: s.originalSessions.map((x) => ({ ...x })) })),
}));
