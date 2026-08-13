"use client";

import { create } from "zustand";
import {
  DayCode,
  DEFAULT_THRESHOLDS,
  DepartmentRegistry,
  FacultyType,
  FacultyTypeRegistry,
  RoleMaxHours,
  RoleRegistry,
  RoomRegistry,
  Session,
  Thresholds,
} from "@/lib/types";
import { ROLE_MAX_HOURS, withRoleDefaults, canBePartTime, DEFAULT_ROLE } from "@/lib/roles";
import { applyRoomChange, applyReschedule, applyReschedulePlan, applyTransfer, ReschedulePlan } from "@/lib/transfer";
import { finalizeSession } from "@/lib/ingest";
import { applyFacultyMerge, facultyDedupMap, mergeLecturer } from "@/lib/faculty";
import { applyMerge, mergeAllSimilar } from "@/lib/merge";
import {
  autoResolve, autoResolveSteps, AutoResolveOptions, ResolveProgress, ResolveResult,
} from "@/lib/resolve";
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
  facultyTypeRegistry: FacultyTypeRegistry; // lecturer -> FT/PT
  thresholds: Thresholds;
  activeTerm: string | null;
  terms: string[];
  // filters
  fPrograms: string[];
  fLecturers: string[];
  fRooms: string[];
  fDays: string[];
  fDepartments: string[];
  search: string;

  history: Snapshot[]; // undo stack (most recent last)

  loadArrayBuffer: (buf: ArrayBuffer, name: string) => Promise<void>;
  loadCsvText: (text: string, name: string) => Promise<void>;
  setActiveTerm: (t: string) => void;
  setRoomRegistry: (r: RoomRegistry) => void;
  setRole: (lecturer: string, role: string) => void;
  setRoleMaxHours: (r: RoleMaxHours) => void;
  setRoleMaxHoursFor: (role: string, hours: number) => void;
  resetRoleMaxHours: () => void;
  setDepartment: (programme: string, dept: string) => void;
  setThreshold: <K extends keyof Thresholds>(k: K, v: Thresholds[K]) => void;
  resetThresholds: () => void;
  setFilter: (key: "fPrograms" | "fLecturers" | "fRooms" | "fDays" | "fDepartments", v: string[]) => void;
  setSearch: (q: string) => void;
  clearFilters: () => void;
  assignSubject: (lecturer: string, unitCode: string) => void;
  unassignSubject: (lecturer: string, unitCode: string) => void;
  setFacultyType: (lecturer: string, type: FacultyType) => void;
  mergeFaculty: (from: string, to: string) => void;
  dedupeFaculty: () => number;
  mergeSessions: (rowIds: number[]) => number;
  mergeAllSimilarCourses: () => { merged: number; removed: number };
  transferLecturer: (rowId: number, newLecturer: string) => void;
  changeRoom: (rowId: number, newRoom: string) => void;
  reschedule: (rowId: number, day: DayCode, startMin: number, endMin: number) => void;
  applyPlan: (rowId: number, plan: ReschedulePlan) => void;
  autoResolve: (opts: AutoResolveOptions, run?: Parameters<typeof autoResolve>[2]) => ResolveResult;
  autoResolveLive: (
    opts: AutoResolveOptions,
    run?: Parameters<typeof autoResolve>[2],
    onProgress?: (p: ResolveProgress) => void,
  ) => Promise<ResolveResult>;
  updateSession: (rowId: number, patch: Partial<Session>) => void;
  resetEdits: () => void;
  undo: () => void;
}

interface Snapshot {
  sessions: Session[];
  subjectAssignments: Record<string, string[]>;
  roleRegistry: RoleRegistry;
  facultyTypeRegistry: FacultyTypeRegistry;
}

const HISTORY_MAX = 50;

/** Capture the current undoable slice and append it to the history (capped). */
function pushSnap(s: {
  history: Snapshot[];
  sessions: Session[];
  subjectAssignments: Record<string, string[]>;
  roleRegistry: RoleRegistry;
  facultyTypeRegistry: FacultyTypeRegistry;
}): Snapshot[] {
  return [
    ...s.history,
    {
      sessions: s.sessions,
      subjectAssignments: s.subjectAssignments,
      roleRegistry: s.roleRegistry,
      facultyTypeRegistry: s.facultyTypeRegistry,
    },
  ].slice(-HISTORY_MAX);
}

/** Merge a resolved subset of sessions back into the full list, preserving order. */
function spliceTerm(all: Session[], resolved: Session[]): Session[] {
  const byRowId = new Map(resolved.map((s) => [s.rowId, s]));
  return all.map((s) => byRowId.get(s.rowId) ?? s);
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
    facultyTypeRegistry: r.facultyTypeRegistry,
    terms: r.terms,
    activeTerm: r.terms[0] ?? null,
    history: [] as Snapshot[],
    fPrograms: [] as string[], fLecturers: [] as string[], fRooms: [] as string[],
    fDays: [] as string[], fDepartments: [] as string[], search: "",
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
  roleMaxHours: withRoleDefaults(loadPersisted().roleMaxHours),
  departmentRegistry: {},
  subjectAssignments: {},
  facultyTypeRegistry: {},
  thresholds: { ...DEFAULT_THRESHOLDS, ...(loadPersisted().thresholds ?? {}) },
  activeTerm: null,
  terms: [],
  history: [],
  fPrograms: [],
  fLecturers: [],
  fRooms: [],
  fDays: [],
  fDepartments: [],
  search: "",

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

  setActiveTerm: (t) => set({ activeTerm: t, fPrograms: [], fLecturers: [], fRooms: [], fDays: [], fDepartments: [], search: "" }),
  setRoomRegistry: (r) => set({ roomRegistry: r }),
  setRole: (lecturer, role) =>
    set((s) => {
      const roleRegistry = { ...s.roleRegistry, [lecturer]: role };
      // Only a Lecturer may be Part-Time — taking a substantive role makes the
      // person Full-Time automatically, so the two registries never disagree.
      const facultyTypeRegistry = { ...s.facultyTypeRegistry };
      if (!canBePartTime(role) && facultyTypeRegistry[lecturer] === "PT") {
        facultyTypeRegistry[lecturer] = "FT";
        toast.info(
          `${lecturer} is now Full-Time — only the Lecturer role can be Part-Time.`,
          "Employment adjusted",
        );
      }
      return { history: pushSnap(s), roleRegistry, facultyTypeRegistry };
    }),
  setRoleMaxHours: (r) => {
    persist({ ...loadPersisted(), roleMaxHours: r });
    set({ roleMaxHours: r });
  },
  setRoleMaxHoursFor: (role, hours) =>
    set((s) => {
      const roleMaxHours = { ...s.roleMaxHours, [role]: hours };
      persist({ ...loadPersisted(), roleMaxHours });
      return { roleMaxHours };
    }),
  resetRoleMaxHours: () => {
    const roleMaxHours = { ...ROLE_MAX_HOURS };
    persist({ ...loadPersisted(), roleMaxHours });
    set({ roleMaxHours });
  },
  setDepartment: (programme, dept) =>
    set((s) => ({ departmentRegistry: { ...s.departmentRegistry, [programme.toUpperCase()]: dept } })),
  setThreshold: (k, v) =>
    set((s) => {
      const thresholds = { ...s.thresholds, [k]: v };
      persist({ ...loadPersisted(), thresholds });
      return { thresholds };
    }),
  resetThresholds: () => {
    const thresholds = { ...DEFAULT_THRESHOLDS };
    persist({ ...loadPersisted(), thresholds });
    set({ thresholds });
  },
  setFilter: (key, v) => set({ [key]: v } as Pick<State, typeof key>),
  setSearch: (q) => set({ search: q }),
  clearFilters: () =>
    set({ fPrograms: [], fLecturers: [], fRooms: [], fDays: [], fDepartments: [], search: "" }),

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
  setFacultyType: (lecturer, type) =>
    set((s) => {
      const role = s.roleRegistry[lecturer] ?? DEFAULT_ROLE;
      if (type === "PT" && !canBePartTime(role)) {
        toast.warn(
          `${lecturer} is ${role}. Only the Lecturer role can be Part-Time — change the role first.`,
          "Part-Time not allowed",
        );
        return {};
      }
      if ((s.facultyTypeRegistry[lecturer] ?? "FT") === type) return {};
      return { history: pushSnap(s), facultyTypeRegistry: { ...s.facultyTypeRegistry, [lecturer]: type } };
    }),
  mergeFaculty: (from, to) =>
    set((s) => {
      const sessions = mergeLecturer(s.sessions, from, to);
      const roleRegistry = { ...s.roleRegistry };
      if (roleRegistry[from] && !roleRegistry[to]) roleRegistry[to] = roleRegistry[from];
      delete roleRegistry[from];
      const facultyTypeRegistry = { ...s.facultyTypeRegistry };
      if (facultyTypeRegistry[from] && !facultyTypeRegistry[to]) facultyTypeRegistry[to] = facultyTypeRegistry[from];
      delete facultyTypeRegistry[from];
      const subjectAssignments = { ...s.subjectAssignments };
      const merged = [...new Set([...(subjectAssignments[to] ?? []), ...(subjectAssignments[from] ?? [])])].sort();
      if (merged.length) subjectAssignments[to] = merged;
      delete subjectAssignments[from];
      return { history: pushSnap(s), sessions, roleRegistry, facultyTypeRegistry, subjectAssignments };
    }),
  dedupeFaculty: () => {
    const map = facultyDedupMap(get().sessions);
    const count = Object.keys(map).length;
    if (count === 0) return 0;
    set((s) => {
      const sessions = applyFacultyMerge(s.sessions, map);
      const roleRegistry = { ...s.roleRegistry };
      const facultyTypeRegistry = { ...s.facultyTypeRegistry };
      const subjectAssignments = { ...s.subjectAssignments };
      for (const [from, to] of Object.entries(map)) {
        if (roleRegistry[from] && !roleRegistry[to]) roleRegistry[to] = roleRegistry[from];
        delete roleRegistry[from];
        if (facultyTypeRegistry[from] && !facultyTypeRegistry[to]) facultyTypeRegistry[to] = facultyTypeRegistry[from];
        delete facultyTypeRegistry[from];
        const merged = [...new Set([...(subjectAssignments[to] ?? []), ...(subjectAssignments[from] ?? [])])].sort();
        if (merged.length) subjectAssignments[to] = merged;
        delete subjectAssignments[from];
      }
      return { history: pushSnap(s), sessions, roleRegistry, facultyTypeRegistry, subjectAssignments };
    });
    return count;
  },

  /** Collapse duplicate rows of ONE teaching session into a single session. */
  mergeSessions: (rowIds) => {
    const before = get().sessions.length;
    set((s) => ({ history: pushSnap(s), sessions: applyMerge(s.sessions, rowIds) }));
    return before - get().sessions.length;
  },
  /** Merge every mergeable "similar course" group in the timetable at once. */
  mergeAllSimilarCourses: () => {
    const r = mergeAllSimilar(get().sessions);
    if (r.merged === 0) return { merged: 0, removed: 0 };
    set((s) => ({ history: pushSnap(s), sessions: r.sessions }));
    return { merged: r.merged, removed: r.removed };
  },

  transferLecturer: (rowId, newLecturer) =>
    set((s) => ({ history: pushSnap(s), sessions: applyTransfer(s.sessions, rowId, newLecturer) })),  changeRoom: (rowId, newRoom) =>
    set((s) => ({ history: pushSnap(s), sessions: applyRoomChange(s.sessions, rowId, newRoom) })),
  reschedule: (rowId, day, startMin, endMin) =>
    set((s) => ({ history: pushSnap(s), sessions: applyReschedule(s.sessions, rowId, day, startMin, endMin) })),
  applyPlan: (rowId, plan) =>
    set((s) => ({ history: pushSnap(s), sessions: applyReschedulePlan(s.sessions, rowId, plan) })),
  autoResolve: (opts, run) => {
    const { sessions, activeTerm } = get();
    const result = autoResolve(sessions.filter((x) => x.term === activeTerm), opts, run);
    set((s) => ({ history: pushSnap(s), sessions: spliceTerm(s.sessions, result.sessions) }));
    return result;
  },
  /**
   * Same as autoResolve, but driven in short time slices so the browser can
   * paint between them — the caller gets live progress and the UI never freezes.
   */
  autoResolveLive: async (opts, run = {}, onProgress) => {
    // Resolve only the ACTIVE term. Terms are analysed independently everywhere
    // else, so silently rescheduling the other term — which the user can't even
    // see from here — would be both surprising and unreviewable.
    const { sessions, activeTerm } = get();
    const iterator = autoResolveSteps(sessions.filter((x) => x.term === activeTerm), opts, run);
    const SLICE_MS = 40;
    let step = iterator.next();
    let latest: ResolveProgress | undefined;

    while (!step.done) {
      const sliceStart = performance.now();
      // Burn through as much work as fits in one frame. Progress is reported
      // ONCE per slice, not once per change — a React re-render costs far more
      // than the work itself, so reporting every step made the run ~30x slower.
      while (!step.done && performance.now() - sliceStart < SLICE_MS) {
        latest = step.value;
        step = iterator.next();
      }
      if (step.done) break;
      if (latest) onProgress?.(latest);
      // Hand control back so the browser can paint the progress we just reported.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }

    const result = step.value;
    set((s) => ({ history: pushSnap(s), sessions: spliceTerm(s.sessions, result.sessions) }));
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
        facultyTypeRegistry: prev.facultyTypeRegistry,
      };
    }),
}));
