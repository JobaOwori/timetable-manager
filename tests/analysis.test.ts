import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import {
  detectClashes, allClashes, lecturerWorkload, capacityAnalysis,
  consecutiveViolations, duplicateSchedules, dataQualityIssues,
} from "@/lib/analysis";
import { ROLE_MAX_HOURS } from "@/lib/roles";
import { Session } from "@/lib/types";

const HEADERS = [
  "Programm", "SEMCODE", "BATCHCODE", "UNITCODE", "UNITNAME", "TERM", "WDAY",
  "Time", "Hours", "ROOMCODE", "CAPACITY", "Faculty", "Head Count", "Comment",
];

function makeSessions(rows: (string | number | null)[][]): Session[] {
  const objs = rows.map((r) => {
    const o: Record<string, unknown> = {};
    HEADERS.forEach((h, i) => (o[h] = r[i] ?? null));
    return o;
  });
  const mapping = autoMapColumns(HEADERS);
  return buildSessions(objs, mapping);
}

const base = (over: Partial<Record<string, string | number | null>> = {}) => {
  const d: Record<string, string | number | null> = {
    Programm: "BSCCS", SEMCODE: 1, BATCHCODE: "B1", UNITCODE: "U1", UNITNAME: "Unit",
    TERM: 1, WDAY: "MON", Time: "9:00AM - 10:55AM", Hours: 2, ROOMCODE: "101",
    CAPACITY: 30, Faculty: "Dr Smith", "Head Count": 20, Comment: null, ...over,
  };
  return HEADERS.map((h) => d[h] ?? null);
};

describe("analysis", () => {
  it("detects room clash on overlap, not back-to-back", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", Time: "9:00AM - 10:55AM", ROOMCODE: "101" }),
      base({ UNITCODE: "B", Time: "10:00AM - 11:55AM", ROOMCODE: "101" }),
    ]);
    expect(detectClashes(s, "room").length).toBe(1);
    const s2 = makeSessions([
      base({ UNITCODE: "A", Time: "9:00AM - 10:55AM", ROOMCODE: "101" }),
      base({ UNITCODE: "B", Time: "11:05AM - 1:00PM", ROOMCODE: "101" }),
    ]);
    expect(detectClashes(s2, "room").length).toBe(0);
  });

  it("does not leak clashes across terms", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", TERM: 1, Faculty: "Dr Smith", ROOMCODE: "101", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "B", TERM: 2, Faculty: "Dr Smith", ROOMCODE: "101", Time: "9:00AM - 10:55AM" }),
    ]);
    expect(allClashes(s).length).toBe(0);
  });

  it("excludes placeholder lecturer from clash", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", Faculty: "X", Time: "9:00AM - 10:55AM", ROOMCODE: "101" }),
      base({ UNITCODE: "B", Faculty: "X", Time: "9:30AM - 11:00AM", ROOMCODE: "102" }),
    ]);
    expect(detectClashes(s, "lecturer").length).toBe(0);
  });

  it("computes role-based workload status", () => {
    const s = makeSessions([
      base({ Faculty: "Dr Over", Hours: 10, WDAY: "MON" }),
      base({ Faculty: "Dr Over", Hours: 10, WDAY: "TUE" }),
      base({ Faculty: "Dr Under", Hours: 2, WDAY: "MON" }),
    ]);
    const wl = lecturerWorkload(s, { "Dr Over": "AR", "Dr Under": "Lecturer" }, ROLE_MAX_HOURS, { nearMaxPct: 0.85, farUnderPct: 0.4 });
    const over = wl.find((w) => w.lecturer === "Dr Over")!;
    const under = wl.find((w) => w.lecturer === "Dr Under")!;
    expect(over.totalHours).toBe(20);
    expect(over.status).toBe("Overloaded");
    expect(under.status).toBe("Close to Maximum");
  });

  it("applies capacity tolerance tiers", () => {
    const over = capacityAnalysis(makeSessions([base({ ROOMCODE: "101", "Head Count": 60 })]), { "101": 30 }, 0.4, 20);
    expect(over[0].capacityStatus).toBe("Over Capacity");
    const within = capacityAnalysis(makeSessions([base({ ROOMCODE: "101", "Head Count": 40 })]), { "101": 30 }, 0.4, 20);
    expect(within[0].capacityStatus).toBe("Within Tolerance");
  });

  it("flags consecutive block over cap, ignores real lunch break", () => {
    const bad = makeSessions([
      base({ UNITCODE: "A", WDAY: "MON", Time: "8:00AM - 10:00AM", Faculty: "Dr Busy" }),
      base({ UNITCODE: "B", WDAY: "MON", Time: "10:00AM - 12:00PM", Faculty: "Dr Busy" }),
      base({ UNITCODE: "C", WDAY: "MON", Time: "12:00PM - 2:30PM", Faculty: "Dr Busy" }),
    ]);
    expect(consecutiveViolations(bad, 6, 15).length).toBe(1);
    const ok = makeSessions([
      base({ UNITCODE: "A", WDAY: "MON", Time: "9:00AM - 10:55AM", Faculty: "Dr Rest" }),
      base({ UNITCODE: "B", WDAY: "MON", Time: "11:05AM - 1:00PM", Faculty: "Dr Rest" }),
      base({ UNITCODE: "C", WDAY: "MON", Time: "2:00PM - 3:55PM", Faculty: "Dr Rest" }),
    ]);
    expect(consecutiveViolations(ok, 6, 15).length).toBe(0);
  });

  it("detects duplicate schedules", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", ROOMCODE: "101", Faculty: "Dr Smith", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "A", ROOMCODE: "101", Faculty: "Dr Smith", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "B", ROOMCODE: "102", Faculty: "Dr Jones", Time: "9:00AM - 10:55AM" }),
    ]);
    const d = duplicateSchedules(s);
    expect(d.length).toBe(1);
    expect(d[0].count).toBe(2);
  });

  it("flags missing fields and blank comment not surfacing as nan", () => {
    const s = makeSessions([base({ ROOMCODE: null, Faculty: "X", "Head Count": null, Comment: null })]);
    const q = dataQualityIssues(s);
    expect(q[0].issues).toContain("No room assigned");
    expect(q[0].issues).toContain("No lecturer assigned");
    expect(q[0].issues.toLowerCase()).not.toContain("nan");
  });
});
