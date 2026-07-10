"use client";

import { create } from "zustand";
import * as XLSX from "xlsx";
import {
  ColumnMapping,
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
import { applyRoomChange, applyTransfer } from "@/lib/transfer";
import { finalizeSession } from "@/lib/ingest";

interface State {
  fileName: string | null;
  loaded: boolean;
  originalSessions: Session[];
  sessions: Session[]; // working copy
  roomRegistry: RoomRegistry;
  roleRegistry: RoleRegistry;
  roleMaxHours: RoleMaxHours;
  departmentRegistry: DepartmentRegistry;
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
  transferLecturer: (rowId: number, newLecturer: string) => void;
  changeRoom: (rowId: number, newRoom: string) => void;
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
    departmentRegistry[p] = DEFAULT_PROGRAMME_DEPARTMENT[p.toUpperCase()] ?? "";
  }
  return { roleRegistry, departmentRegistry };
}

function distinctTerms(sessions: Session[]): string[] {
  return [...new Set(sessions.map((s) => s.term).filter((t): t is string => !!t))].sort();
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
    const { sessions, roomRegistry } = ingestWorkbook(wb);
    const { roleRegistry, departmentRegistry } = seedRegistriesFromSessions(sessions);
    const terms = distinctTerms(sessions);
    set({
      fileName: name,
      loaded: true,
      originalSessions: sessions,
      sessions,
      roomRegistry,
      roleRegistry,
      departmentRegistry,
      terms,
      activeTerm: terms[0] ?? null,
      fPrograms: [], fLecturers: [], fRooms: [], fDays: [], fDepartments: [],
    });
  },

  loadCsvText: (text, name) => {
    const table = readCsv(text);
    const mapping = autoMapColumns(table.header);
    const rows = dropBlankRows(table, mapping);
    const sessions = buildSessions(rows, mapping);
    const { roleRegistry, departmentRegistry } = seedRegistriesFromSessions(sessions);
    const terms = distinctTerms(sessions);
    set({
      fileName: name, loaded: true, originalSessions: sessions, sessions,
      roomRegistry: {}, roleRegistry, departmentRegistry, terms,
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

  transferLecturer: (rowId, newLecturer) =>
    set((s) => ({ sessions: applyTransfer(s.sessions, rowId, newLecturer) })),
  changeRoom: (rowId, newRoom) =>
    set((s) => ({ sessions: applyRoomChange(s.sessions, rowId, newRoom) })),
  updateSession: (rowId, patch) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.rowId === rowId ? finalizeSession({ ...sess, ...patch }) : sess,
      ),
    })),
  resetEdits: () => set((s) => ({ sessions: s.originalSessions.map((x) => ({ ...x })) })),
}));
