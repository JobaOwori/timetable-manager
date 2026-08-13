import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import { DEFAULT_THRESHOLDS, Session } from "@/lib/types";
import { validatePlacement, placementOf, hasError, detectRuleViolations } from "@/lib/validate";
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
  thresholds: { ...DEFAULT_THRESHOLDS },
};

describe("validatePlacement", () => {
  it("passes for a genuinely free slot", () => {
    const s = makeSessions([
      base({ UNITCODE: "MOVE", Faculty: "Dr X", ROOMCODE: "101", WDAY: "MON" }),
      base({ UNITCODE: "OTHER", Faculty: "Dr Y", ROOMCODE: "102", WDAY: "TUE", BATCHCODE: "B2", Time: "2:00PM - 3:55PM" }),
    ]);
    const move = s.find((x) => x.unitCode === "MOVE")!;
    const v = validatePlacement(move.rowId, { ...placementOf(move), day: "TUE", startMin: 16 * 60, endMin: 18 * 60 }, s, opts);
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

  it("reports a long back-to-back run as advice, not a blocker", () => {
    // Dr Run already has the two morning periods; adding the afternoon ones
    // makes a long day, which is allowed.
    const s = makeSessions([
      base({ UNITCODE: "R1", Faculty: "Dr Run", WDAY: "MON", Time: "9:00AM - 11:00AM", ROOMCODE: "109", BATCHCODE: "B1" }),
      base({ UNITCODE: "R2", Faculty: "Dr Run", WDAY: "MON", Time: "11:00AM - 1:00PM", ROOMCODE: "109", BATCHCODE: "B2" }),
      base({ UNITCODE: "MV", Faculty: "Dr Run", WDAY: "TUE", Time: "9:00AM - 11:00AM", ROOMCODE: "109", BATCHCODE: "B3" }),
    ]);
    const mv = s.find((x) => x.unitCode === "MV")!;
    const v = validatePlacement(mv.rowId, { ...placementOf(mv), day: "MON", startMin: 14 * 60, endMin: 16 * 60 }, s, opts);
    expect(v.filter((x) => x.kind === "consecutive" && x.severity === "error")).toHaveLength(0);
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

  it("allows four weekday classes but not a fifth", () => {
    const s = makeSessions([
      base({ UNITCODE: "D1", Faculty: "Dr Day", WDAY: "MON", Time: "9:00AM - 11:00AM", Hours: 1, ROOMCODE: "201", BATCHCODE: "B1" }),
      base({ UNITCODE: "D2", Faculty: "Dr Day", WDAY: "MON", Time: "11:00AM - 1:00PM", Hours: 1, ROOMCODE: "202", BATCHCODE: "B2" }),
      base({ UNITCODE: "D3", Faculty: "Dr Day", WDAY: "MON", Time: "2:00PM - 4:00PM", Hours: 1, ROOMCODE: "203", BATCHCODE: "B3" }),
      base({ UNITCODE: "MOVE", Faculty: "Dr Other", WDAY: "TUE", Time: "2:00PM - 4:00PM", Hours: 1, ROOMCODE: "204", BATCHCODE: "B4" }),
    ]);
    const move = s.find((x) => x.unitCode === "MOVE")!;
    // The 4th Monday period is free — allowed.
    const fourth = validatePlacement(
      move.rowId,
      { ...placementOf(move), lecturer: "Dr Day", day: "MON", startMin: 16 * 60, endMin: 18 * 60 },
      s,
      opts,
    );
    expect(fourth.some((x) => x.kind === "max_per_day")).toBe(false);

    // With all four taken, a fifth cannot fit.
    const full = makeSessions([
      base({ UNITCODE: "D4", Faculty: "Dr Day", WDAY: "MON", Time: "4:00PM - 6:00PM", Hours: 1, ROOMCODE: "205", BATCHCODE: "B5" }),
    ]).map((x) => ({ ...x, rowId: 99 }));
    const fifth = validatePlacement(
      move.rowId,
      { ...placementOf(move), lecturer: "Dr Day", day: "MON", startMin: 9 * 60, endMin: 11 * 60 },
      [...s, ...full],
      opts,
    );
    expect(fifth.some((x) => x.kind === "max_per_day")).toBe(true);
  });

  it("blocks full-time lecturers in the Friday 4-6 PM slot but allows part-time and earlier FT slots", () => {
    const s = makeSessions([
      base({ UNITCODE: "EVENING", Faculty: "Dr Evening", WDAY: "MON", Time: "9:00AM - 10:55AM" }),
    ]);
    const session = s[0];

    const ftEvening = validatePlacement(
      session.rowId,
      { ...placementOf(session), day: "FRI", startMin: 960, endMin: 1075 },
      s,
      opts,
    );
    expect(ftEvening.some((x) => x.kind === "faculty_rule")).toBe(true);

    const ptEvening = validatePlacement(
      session.rowId,
      { ...placementOf(session), day: "FRI", startMin: 960, endMin: 1075 },
      s,
      { ...opts, facultyTypeRegistry: { "Dr Evening": "PT" } },
    );
    expect(ptEvening.some((x) => x.kind === "faculty_rule")).toBe(false);

    const ftMorning = validatePlacement(
      session.rowId,
      { ...placementOf(session), day: "FRI", startMin: 600, endMin: 715 },
      s,
      opts,
    );
    expect(ftMorning.some((x) => x.kind === "faculty_rule")).toBe(false);
  });

  it("enforces Saturday rules for undergraduate and postgraduate programmes", () => {
    const s = makeSessions([
      base({ UNITCODE: "UG", Programm: "BSCCS", Faculty: "Dr UG", WDAY: "MON" }),
      base({ UNITCODE: "PG", Programm: "MSCIT", Faculty: "Dr PG", WDAY: "MON", ROOMCODE: "102", BATCHCODE: "B2" }),
    ]);
    const ug = s.find((x) => x.unitCode === "UG")!;
    const pg = s.find((x) => x.unitCode === "PG")!;

    const ugSaturday = validatePlacement(ug.rowId, { ...placementOf(ug), day: "SAT" }, s, opts);
    expect(ugSaturday.some((x) => x.kind === "programme_rule")).toBe(true);

    const pgWeekday = validatePlacement(pg.rowId, placementOf(pg), s, opts);
    expect(pgWeekday.some((x) => x.kind === "programme_rule")).toBe(true);

    const pgSaturday = validatePlacement(pg.rowId, { ...placementOf(pg), day: "SAT" }, s, opts);
    expect(pgSaturday.some((x) => x.kind === "programme_rule")).toBe(false);

    const ugWeekday = validatePlacement(ug.rowId, placementOf(ug), s, opts);
    expect(ugWeekday.some((x) => x.kind === "programme_rule")).toBe(false);
  });
});

describe("detectRuleViolations", () => {
  it("reports timetable rows that break scheduling policy rules", () => {
    const s = makeSessions([
      base({ UNITCODE: "PG", Programm: "MSCIT", Faculty: "Dr PG", WDAY: "MON" }),
    ]);
    const violations = detectRuleViolations(s, opts);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowId: s[0].rowId,
          unitCode: "PG",
          programme: "MSCIT",
          kind: "programme_rule",
        }),
      ]),
    );
  });
});
