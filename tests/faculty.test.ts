import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import { Session } from "@/lib/types";
import {
  lecturerKey, detectDuplicateFaculty, facultyDedupMap, applyFacultyMerge,
  subjectAssignmentsFromSessions, distinctUnits,
} from "@/lib/faculty";
import { autoResolve, explainSession } from "@/lib/resolve";
import { detectClashes } from "@/lib/analysis";
import { ROLE_MAX_HOURS } from "@/lib/roles";
import { DEFAULT_PROGRAMME_DEPARTMENT } from "@/lib/departments";

const HEADERS = [
  "Programm", "SEMCODE", "BATCHCODE", "UNITCODE", "UNITNAME", "TERM", "WDAY",
  "Time", "Hours", "ROOMCODE", "CAPACITY", "Faculty", "Head Count", "Comment",
];
const base = (over: Partial<Record<string, string | number | null>> = {}) => {
  const d: Record<string, string | number | null> = {
    Programm: "BSCCS", SEMCODE: 1, BATCHCODE: "B1", UNITCODE: "U1", UNITNAME: "Unit",
    TERM: 1, WDAY: "MON", Time: "9:00AM - 10:55AM", Hours: 2, ROOMCODE: "101",
    CAPACITY: 30, Faculty: "Dr Smith", "Head Count": 20, Comment: null, ...over,
  };
  return HEADERS.map((h) => d[h] ?? null);
};
function makeSessions(rows: (string | number | null)[][]): Session[] {
  const objs = rows.map((r) => {
    const o: Record<string, unknown> = {};
    HEADERS.forEach((h, i) => (o[h] = r[i] ?? null));
    return o;
  });
  return buildSessions(objs, autoMapColumns(HEADERS));
}

const resolveOpts = {
  roleRegistry: {} as Record<string, string>,
  roleMaxHours: ROLE_MAX_HOURS,
  departmentRegistry: DEFAULT_PROGRAMME_DEPARTMENT,
  thresholds: { nearMaxPct: 0.85, farUnderPct: 0.4 },
  roomRegistry: {} as Record<string, number>,
  capacityTolerance: 20,
};

const countAllClashes = (sessions: Session[]) =>
  (["lecturer", "room", "batch_code"] as const).reduce(
    (total, type) => total + detectClashes(sessions, type).length,
    0,
  );

describe("faculty dedup", () => {
  it("keys names order-independently (case/space/punct)", () => {
    expect(lecturerKey("JAMES KAWUKI")).toBe(lecturerKey("James  Kawuki"));
    expect(lecturerKey("Kawuki, James")).toBe(lecturerKey("James Kawuki"));
    expect(lecturerKey("Dr. Ann-Marie")).toBe(lecturerKey("ann marie dr"));
  });

  it("detects duplicate spellings and picks the most common as canonical", () => {
    const s = makeSessions([
      base({ Faculty: "James Kawuki", UNITCODE: "A" }),
      base({ Faculty: "James Kawuki", UNITCODE: "B", WDAY: "TUE" }),
      base({ Faculty: "KAWUKI, JAMES", UNITCODE: "C", WDAY: "WED" }),
    ]);
    const dups = detectDuplicateFaculty(s);
    expect(dups.length).toBe(1);
    expect(dups[0].canonical).toBe("James Kawuki");
    expect(dups[0].variants).toContain("KAWUKI, JAMES");
  });

  it("merges duplicates so workload counts one person", () => {
    const s = makeSessions([
      base({ Faculty: "James Kawuki", UNITCODE: "A", WDAY: "MON" }),
      base({ Faculty: "KAWUKI, JAMES", UNITCODE: "B", WDAY: "TUE" }),
    ]);
    const merged = applyFacultyMerge(s, facultyDedupMap(s));
    const names = new Set(merged.map((x) => x.lecturer));
    expect(names.size).toBe(1);
    expect([...names][0]).toBe("James Kawuki");
  });

  it("no false positives for genuinely different lecturers", () => {
    const s = makeSessions([
      base({ Faculty: "Alice Brown" }),
      base({ Faculty: "Bob Green", WDAY: "TUE" }),
    ]);
    expect(detectDuplicateFaculty(s).length).toBe(0);
    expect(Object.keys(facultyDedupMap(s)).length).toBe(0);
  });
});

describe("subject assignments", () => {
  it("seeds assignments from what each lecturer teaches", () => {
    const s = makeSessions([
      base({ Faculty: "Dr A", UNITCODE: "CS101" }),
      base({ Faculty: "Dr A", UNITCODE: "CS102", WDAY: "TUE" }),
      base({ Faculty: "Dr B", UNITCODE: "CS101", WDAY: "WED" }),
    ]);
    const map = subjectAssignmentsFromSessions(s);
    expect(map["Dr A"]).toEqual(["CS101", "CS102"]);
    expect(map["Dr B"]).toEqual(["CS101"]);
  });

  it("lists distinct units with names", () => {
    const s = makeSessions([
      base({ UNITCODE: "CS101", UNITNAME: "Intro" }),
      base({ UNITCODE: "CS101", UNITNAME: "Intro", WDAY: "TUE" }),
      base({ UNITCODE: "CS102", UNITNAME: "Data", WDAY: "WED" }),
    ]);
    const units = distinctUnits(s);
    expect(units.map((u) => u.code)).toEqual(["CS101", "CS102"]);
    expect(units.find((u) => u.code === "CS102")!.name).toBe("Data");
  });
});

describe("autoResolve", () => {
  it("clears a lecturer pile-up by relocating sessions and reports steps", () => {
    // Dr Busy triple-booked MON 9:00-10:55 (3 cohorts/rooms) + free later slots exist.
    const s = makeSessions([
      base({ UNITCODE: "P1", Faculty: "Dr Busy", ROOMCODE: "101", BATCHCODE: "B1", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "P2", Faculty: "Dr Busy", ROOMCODE: "102", BATCHCODE: "B2", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "P3", Faculty: "Dr Busy", ROOMCODE: "103", BATCHCODE: "B3", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "F1", Faculty: "Dr Busy", ROOMCODE: "104", BATCHCODE: "B4", WDAY: "TUE", Time: "2:00PM - 3:55PM" }),
      base({ UNITCODE: "F2", Faculty: "Dr Busy", ROOMCODE: "105", BATCHCODE: "B5", WDAY: "WED", Time: "11:00AM - 12:55PM" }),
    ]);
    expect(detectClashes(s, "lecturer").length).toBeGreaterThan(0);
    const res = autoResolve(s, resolveOpts, { lecturer: "Dr Busy", types: ["lecturer"] });
    expect(res.steps.length).toBeGreaterThan(0);
    expect(detectClashes(res.sessions, "lecturer").filter((c) => c.groupValue === "Dr Busy").length).toBe(0);
  });

  it("reports unresolved conflicts with plain-language reasons when stuck", () => {
    // Two cohorts collide and there is literally no other slot to move to.
    const s = makeSessions([
      base({ UNITCODE: "X", Faculty: "Dr A", ROOMCODE: "101", BATCHCODE: "B1", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "Y", Faculty: "Dr B", ROOMCODE: "102", BATCHCODE: "B1", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
    ]);
    const res = autoResolve(s, resolveOpts, { types: ["batch_code"] });
    // only one slot in the term -> can't reschedule -> unresolved with reasons
    expect(res.unresolved.length).toBeGreaterThan(0);
    for (const unresolved of res.unresolved) {
      const reasons = unresolved.reasons.join(" ");
      expect(reasons).toMatch(/free (time )?slot|room|lecturer|cohort/i);
      expect(reasons).not.toContain("Still in conflict after resolution.");
    }
  });

  it("resolves a room clash without oscillating or transferring lecturers", () => {
    const s = makeSessions([
      base({ UNITCODE: "R1", Faculty: "Dr A", ROOMCODE: "101", BATCHCODE: "B1", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "R2", Faculty: "Dr B", ROOMCODE: "101", BATCHCODE: "B2", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "FREE", Faculty: "Dr C", ROOMCODE: "102", BATCHCODE: "B3", WDAY: "TUE", Time: "2:00PM - 3:55PM" }),
    ]);
    expect(detectClashes(s, "room").length).toBe(1);
    const res = autoResolve(s, resolveOpts, { types: ["room"] });
    expect(res.steps.length).toBeGreaterThan(0);
    expect(res.steps.length).toBeLessThanOrEqual(2);
    expect(res.steps.every((step) => step.action !== "transfer")).toBe(true);
    expect(detectClashes(res.sessions, "room").length).toBe(0);
  });

  it("keeps multi-clash auto-resolution bounded by monotonic progress", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", Faculty: "Dr Busy", ROOMCODE: "101", BATCHCODE: "B1", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "B", Faculty: "Dr Busy", ROOMCODE: "102", BATCHCODE: "B2", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "C", Faculty: "Dr C", ROOMCODE: "101", BATCHCODE: "B3", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "D", Faculty: "Dr D", ROOMCODE: "103", BATCHCODE: "B4", WDAY: "TUE", Time: "2:00PM - 3:55PM" }),
      base({ UNITCODE: "E", Faculty: "Dr E", ROOMCODE: "104", BATCHCODE: "B5", WDAY: "WED", Time: "11:00AM - 12:55PM" }),
    ]);
    const initialClashes = countAllClashes(s);
    expect(initialClashes).toBeGreaterThan(1);
    const res = autoResolve(s, resolveOpts);
    expect(res.steps.length).toBeLessThanOrEqual(initialClashes + 2);
    expect(countAllClashes(res.sessions)).toBe(0);
  });

  it("does not create new clashes (never trades one for another)", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", Faculty: "Dr A", ROOMCODE: "101", BATCHCODE: "B1", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "B", Faculty: "Dr A", ROOMCODE: "102", BATCHCODE: "B2", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "C", Faculty: "Dr C", ROOMCODE: "103", BATCHCODE: "B3", WDAY: "TUE", Time: "2:00PM - 3:55PM" }),
    ]);
    const before = detectClashes(s, "room").length + detectClashes(s, "batch_code").length;
    const res = autoResolve(s, resolveOpts, { lecturer: "Dr A", types: ["lecturer"] });
    const after = detectClashes(res.sessions, "room").length + detectClashes(res.sessions, "batch_code").length;
    expect(after).toBeLessThanOrEqual(before);
  });
});

describe("explainSession", () => {
  it("says why a session cannot be rescheduled/transferred/moved", () => {
    const s = makeSessions([
      base({ UNITCODE: "ONLY", Faculty: "Dr Solo", ROOMCODE: "101", BATCHCODE: "B1", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "BLK", Faculty: "Dr Other", ROOMCODE: "102", BATCHCODE: "B1", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
    ]);
    const only = s.find((x) => x.unitCode === "ONLY")!;
    const ex = explainSession(only, s, resolveOpts);
    expect(typeof ex.canReschedule).toBe("boolean");
    expect(Array.isArray(ex.reasons)).toBe(true);
  });
});
