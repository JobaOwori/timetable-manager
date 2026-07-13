import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import { Session } from "@/lib/types";
import { validatePlacement, placementOf, hasError } from "@/lib/validate";
import { ROLE_MAX_HOURS } from "@/lib/roles";

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

const opts = {
  roleRegistry: {} as Record<string, string>,
  roleMaxHours: ROLE_MAX_HOURS,
  roomRegistry: { "101": 30, "102": 30, "109": 200 } as Record<string, number>,
  thresholds: { capacityTolerance: 20, maxConsecutiveHours: 6, maxGapMinutes: 15 },
};

describe("validatePlacement", () => {
  it("passes for a genuinely free slot", () => {
    const s = makeSessions([
      base({ UNITCODE: "MOVE", Faculty: "Dr X", ROOMCODE: "101", WDAY: "MON" }),
      base({ UNITCODE: "OTHER", Faculty: "Dr Y", ROOMCODE: "102", WDAY: "TUE", BATCHCODE: "B2", Time: "2:00PM - 3:55PM" }),
    ]);
    const move = s.find((x) => x.unitCode === "MOVE")!;
    const v = validatePlacement(move.rowId, { ...placementOf(move), day: "TUE", startMin: 840, endMin: 955 }, s, opts);
    expect(v.length).toBe(0);
  });

  it("flags room, lecturer and cohort double-bookings with reasons", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", Faculty: "Dr X", ROOMCODE: "101", BATCHCODE: "B1", WDAY: "MON" }),
      base({ UNITCODE: "B", Faculty: "Dr X", ROOMCODE: "101", BATCHCODE: "B1", WDAY: "MON" }),
    ]);
    const b = s.find((x) => x.unitCode === "B")!;
    const v = validatePlacement(b.rowId, placementOf(b), s, opts);
    const kinds = v.map((x) => x.kind).sort();
    expect(kinds).toContain("room");
    expect(kinds).toContain("lecturer");
    expect(kinds).toContain("cohort");
    expect(hasError(v)).toBe(true);
  });

  it("flags a weekly workload breach", () => {
    // Lecturer role default = Lecturer (22h). 12 x 2h sessions = 24h > 22h.
    const rows = Array.from({ length: 11 }, (_, i) =>
      base({ UNITCODE: `U${i}`, Faculty: "Dr Load", WDAY: "MON", Time: "9:00AM - 10:55AM", ROOMCODE: `${200 + i}`, BATCHCODE: `C${i}` }),
    );
    // move a 2h session onto this lecturer -> 11*2 + 2 = 24
    rows.push(base({ UNITCODE: "NEW", Faculty: "Dr Other", WDAY: "SAT", Time: "9:00AM - 10:55AM", ROOMCODE: "300", BATCHCODE: "Z" }));
    const s = makeSessions(rows);
    const mv = s.find((x) => x.unitCode === "NEW")!;
    const v = validatePlacement(
      mv.rowId,
      { ...placementOf(mv), lecturer: "Dr Load" },
      s,
      opts,
    );
    expect(v.some((x) => x.kind === "workload")).toBe(true);
  });

  it("flags a consecutive-hours breach", () => {
    // Build a MON run 9:00-15:55 already (7h) for Dr Run, then place another adjacent.
    const s = makeSessions([
      base({ UNITCODE: "R1", Faculty: "Dr Run", WDAY: "MON", Time: "9:00AM - 12:55PM", ROOMCODE: "109", BATCHCODE: "B1" }),
      base({ UNITCODE: "R2", Faculty: "Dr Run", WDAY: "MON", Time: "1:00PM - 3:55PM", ROOMCODE: "109", BATCHCODE: "B2" }),
      base({ UNITCODE: "MV", Faculty: "Dr Run", WDAY: "TUE", Time: "9:00AM - 10:55AM", ROOMCODE: "109", BATCHCODE: "B3" }),
    ]);
    const mv = s.find((x) => x.unitCode === "MV")!;
    // place MV MON 4:00-5:55 right after the run -> long consecutive block
    const v = validatePlacement(mv.rowId, { ...placementOf(mv), day: "MON", startMin: 960, endMin: 1075 }, s, opts);
    expect(v.some((x) => x.kind === "consecutive")).toBe(true);
  });

  it("distinguishes capacity warning (within tolerance) from error (beyond)", () => {
    const s = makeSessions([base({ UNITCODE: "CAP", ROOMCODE: "101", "Head Count": 45, WDAY: "MON", Time: "9:00AM - 10:55AM" })]);
    const cap = s[0];
    // room 101 holds 30; hc 45 -> 15 over, tolerance 20 -> warning
    const warnV = validatePlacement(cap.rowId, placementOf(cap), s, opts);
    expect(warnV.some((x) => x.kind === "capacity" && x.severity === "warning")).toBe(true);
    expect(hasError(warnV.filter((x) => x.kind === "capacity"))).toBe(false);
    // hc 60 -> 30 over -> error
    const s2 = makeSessions([base({ UNITCODE: "CAP", ROOMCODE: "101", "Head Count": 65, WDAY: "MON", Time: "9:00AM - 10:55AM" })]);
    const errV = validatePlacement(s2[0].rowId, placementOf(s2[0]), s2, opts);
    expect(errV.some((x) => x.kind === "capacity" && x.severity === "error")).toBe(true);
  });

  it("respects term isolation (no clash across terms)", () => {
    const s = makeSessions([
      base({ UNITCODE: "T1", Faculty: "Dr X", ROOMCODE: "101", TERM: 1, WDAY: "MON" }),
      base({ UNITCODE: "T2", Faculty: "Dr X", ROOMCODE: "101", TERM: 2, WDAY: "MON" }),
    ]);
    const t1 = s.find((x) => x.unitCode === "T1")!;
    const v = validatePlacement(t1.rowId, placementOf(t1), s, opts);
    expect(v.length).toBe(0);
  });
});
