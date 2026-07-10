import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import { transferCandidates, applyTransfer, UNASSIGN } from "@/lib/transfer";
import { detectClashes } from "@/lib/analysis";
import { ROLE_MAX_HOURS } from "@/lib/roles";
import { DEFAULT_PROGRAMME_DEPARTMENT } from "@/lib/departments";
import { Session } from "@/lib/types";

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
  departmentRegistry: DEFAULT_PROGRAMME_DEPARTMENT,
  thresholds: { nearMaxPct: 0.85, farUnderPct: 0.4 },
};

describe("transfer", () => {
  it("ranks an available free lecturer above a busy one and marks it recommended", () => {
    // Session to move: Dr Smith teaching at MON 9-10:55.
    // Dr Free is idle. Dr Busy is teaching MON 9:30-11 (would clash).
    const s = makeSessions([
      base({ UNITCODE: "MOVE", Faculty: "Dr Smith", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "BUSY", Faculty: "Dr Busy", Time: "9:30AM - 11:00AM", ROOMCODE: "102" }),
      base({ UNITCODE: "OTHER", Faculty: "Dr Free", Time: "2:00PM - 3:55PM", ROOMCODE: "103", WDAY: "TUE" }),
    ]);
    const target = s.find((x) => x.unitCode === "MOVE")!;
    const cands = transferCandidates(target, s, opts);
    // Dr Busy is unavailable (overlap) so excluded by default; Dr Free is available.
    expect(cands.map((c) => c.lecturer)).toContain("Dr Free");
    expect(cands.map((c) => c.lecturer)).not.toContain("Dr Busy");
    expect(cands[0].lecturer).toBe("Dr Free");
    expect(cands[0].recommended).toBe(true);
    expect(cands[0].available).toBe(true);
  });

  it("includes unavailable candidates with a reason when asked", () => {
    const s = makeSessions([
      base({ UNITCODE: "MOVE", Faculty: "Dr Smith", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "BUSY", Faculty: "Dr Busy", Time: "9:30AM - 11:00AM", ROOMCODE: "102" }),
    ]);
    const target = s.find((x) => x.unitCode === "MOVE")!;
    const cands = transferCandidates(target, s, { ...opts, includeUnavailable: true });
    const busy = cands.find((c) => c.lecturer === "Dr Busy")!;
    expect(busy.available).toBe(false);
    expect(busy.conflictReason).toContain("Already teaching");
  });

  it("resolves a lecturer clash when the session is transferred to a free lecturer", () => {
    // Dr Smith double-booked at MON 9-10:55 in rooms 101 and 102 (a lecturer clash).
    const s = makeSessions([
      base({ UNITCODE: "A", Faculty: "Dr Smith", Time: "9:00AM - 10:55AM", ROOMCODE: "101" }),
      base({ UNITCODE: "B", Faculty: "Dr Smith", Time: "9:00AM - 10:55AM", ROOMCODE: "102" }),
      base({ UNITCODE: "C", Faculty: "Dr Free", Time: "2:00PM - 3:55PM", ROOMCODE: "103", WDAY: "FRI" }),
    ]);
    expect(detectClashes(s, "lecturer").length).toBe(1);
    const rowB = s.find((x) => x.unitCode === "B")!;
    const after = applyTransfer(s, rowB.rowId, "Dr Free");
    expect(detectClashes(after, "lecturer").length).toBe(0);
    expect(after.find((x) => x.unitCode === "B")!.lecturer).toBe("Dr Free");
  });

  it("unassign sets lecturer to null", () => {
    const s = makeSessions([base({ UNITCODE: "A", Faculty: "Dr Smith" })]);
    const after = applyTransfer(s, s[0].rowId, UNASSIGN);
    expect(after[0].lecturer).toBeNull();
  });

  it("boosts candidates who already teach the same unit", () => {
    const s = makeSessions([
      base({ UNITCODE: "SHARED", Faculty: "Dr Smith", Time: "9:00AM - 10:55AM" }),
      base({ UNITCODE: "SHARED", Faculty: "Dr SameUnit", Time: "2:00PM - 3:55PM", WDAY: "TUE", ROOMCODE: "102" }),
      base({ UNITCODE: "OTHER", Faculty: "Dr Diff", Time: "2:00PM - 3:55PM", WDAY: "TUE", ROOMCODE: "103", Programm: "MPH" }),
    ]);
    const target = s.find((x) => x.rowId === 1)!;
    const cands = transferCandidates(target, s, opts);
    expect(cands[0].lecturer).toBe("Dr SameUnit");
    expect(cands[0].teachesSameUnit).toBe(true);
  });
});
