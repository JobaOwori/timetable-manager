"use client";

import { create } from "zustand";
import {
  DayCode,
  DEFAULT_THRESHOLDS,
  DepartmentRegistry,
  RoleMaxHours,
  RoleRegistry,
  RoomRegistry,
  Session,
  Thresholds,
} from "@/lib/types";
import { ROLE_MAX_HOURS } from "@/lib/roles";
import { applyRoomChange, applyReschedule, applyTransfer } from "@/lib/transfer";
import { finalizeSession } from "@/lib/ingest";
import { applyFacultyMerge, facultyDedupMap, mergeLecturer } from "@/lib/faculty";
import { autoResolve, AutoResolveOptions, ResolveResult } from "@/lib/resolve";
import { IngestResult } from "@/lib/pipeline";
import { ingestFile } from "@/lib/ingest-client";
import { toast } from "@/store/useToast";

interface State {
  fileName: string | null;
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
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

  history: Snapshot[]; // undo stack (most recent last)

  loadArrayBuffer: (buf: ArrayBuffer, name: string) => Promise<void>;
  loadCsvText: (text: string, name: string) => Promise<void>;
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
  undo: () => void;
}

interface Snapshot {
  sessions: Session[];
  subjectAssignments: Record<string, string[]>;
  roleRegistry: RoleRegistry;
}

const HISTORY_MAX = 50;

/** Capture the current undoable slice and append it to the history (capped). */
function pushSnap(s: {
  history: Snapshot[];
  sessions: Session[];
  subjectAssignments: Record<string, string[]>;
  roleRegistry: RoleRegistry;
}): Snapshot[] {
  return [
    ...s.history,
    { sessions: s.sessions, subjectAssignments: s.subjectAssignments, roleRegistry: s.roleRegistry },
  ].slice(-HISTORY_MAX);
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

function applyResult(name: string, r: IngestResult) {
  return {
    fileName: name,
    loaded: true,
    loading: false,
    loadError: null,
    originalSessions: r.sessions,
    sessions: r.sessions,
    roomRegistry: r.roomRegistry,
    roleRegistry: r.roleRegistry,
    departmentRegistry: r.departmentRegistry,
    subjectAssignments: r.subjectAssignments,
    terms: r.terms,
    activeTerm: r.terms[0] ?? null,
    history: [] as Snapshot[],
    fPrograms: [] as string[], fLecturers: [] as string[], fRooms: [] as string[],
    fDays: [] as string[], fDepartments: [] as string[],
  };
}

export const useStore = create<State>((set, get) => ({
  fileName: null,
  loaded: false,
  loading: false,
  loadError: null,
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
  history: [],
  fPrograms: [],
  fLecturers: [],
  fRooms: [],
  fDays: [],
  fDepartments: [],

  loadArrayBuffer: async (buf, name) => {
    set({ loading: true, loadError: null, fileName: name });
    try {
      const r = await ingestFile("xlsx", buf);
      set(applyResult(name, r));
      toast.success(`Loaded ${r.sessions.length} sessions across ${r.terms.length} term${r.terms.length === 1 ? "" : "s"}.`, "Timetable loaded");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to read the file.";
      set({ loading: false, loadError: msg });
      toast.error(msg, "Couldn't read file");
    }
  },

  loadCsvText: async (text, name) => {
    set({ loading: true, loadError: null, fileName: name });
    try {
      const r = await ingestFile("csv", text);
      set(applyResult(name, r));
      toast.success(`Loaded ${r.sessions.length} sessions across ${r.terms.length} term${r.terms.length === 1 ? "" : "s"}.`, "Timetable loaded");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to read the file.";
      set({ loading: false, loadError: msg });
      toast.error(msg, "Couldn't read file");
    }
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
      return { history: pushSnap(s), subjectAssignments: { ...s.subjectAssignments, [lecturer]: [...cur, unitCode].sort() } };
    }),
  unassignSubject: (lecturer, unitCode) =>
    set((s) => {
      const cur = s.subjectAssignments[lecturer] ?? [];
      if (!cur.includes(unitCode)) return {};
      return { history: pushSnap(s), subjectAssignments: { ...s.subjectAssignments, [lecturer]: cur.filter((u) => u !== unitCode) } };
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
      return { history: pushSnap(s), sessions, roleRegistry, subjectAssignments };
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
      return { history: pushSnap(s), sessions, roleRegistry, subjectAssignments };
    });
    return count;
  },

  transferLecturer: (rowId, newLecturer) =>
    set((s) => ({ history: pushSnap(s), sessions: applyTransfer(s.sessions, rowId, newLecturer) })),
  changeRoom: (rowId, newRoom) =>
    set((s) => ({ history: pushSnap(s), sessions: applyRoomChange(s.sessions, rowId, newRoom) })),
  reschedule: (rowId, day, startMin, endMin) =>
    set((s) => ({ history: pushSnap(s), sessions: applyReschedule(s.sessions, rowId, day, startMin, endMin) })),
  autoResolve: (opts, run) => {
    const result = autoResolve(get().sessions, opts, run);
    set((s) => ({ history: pushSnap(s), sessions: result.sessions }));
    return result;
  },
  updateSession: (rowId, patch) =>
    set((s) => ({
      history: pushSnap(s),
      sessions: s.sessions.map((sess) =>
        sess.rowId === rowId ? finalizeSession({ ...sess, ...patch }) : sess,
      ),
    })),
  resetEdits: () =>
    set((s) => {
      if (s.history.length === 0 && s.sessions === s.originalSessions) return {};
      toast.info("Reverted all edits to the originally loaded timetable.", "Timetable reset", {
        action: { label: "Undo", onClick: () => useStore.getState().undo() },
        duration: 9000,
      });
      return { history: pushSnap(s), sessions: s.originalSessions.map((x) => ({ ...x })) };
    }),
  undo: () =>
    set((s) => {
      if (s.history.length === 0) return {};
      const prev = s.history[s.history.length - 1];
      return {
        history: s.history.slice(0, -1),
        sessions: prev.sessions,
        subjectAssignments: prev.subjectAssignments,
        roleRegistry: prev.roleRegistry,
      };
    }),
}));
