import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import { validatePlacement, placementOf, detectRuleViolations } from "@/lib/validate";
import { lecturerWorkload } from "@/lib/analysis";
import { DEFAULT_THRESHOLDS, DayCode } from "@/lib/types";
import { WEEKDAY_SLOTS, SATURDAY_SLOTS, isOfficialSlot, snapToOfficialSlot } from "@/lib/slots";
import { rescheduleCandidates, reschedulePlans } from "@/lib/transfer";
import { ROLE_MAX_HOURS, PART_TIME_ROLE, maxHoursFor, withRoleDefaults } from "@/lib/roles";
import { searchSessions, parseQuery, highlightTerms } from "@/lib/search";

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

function makeSessions(rows: (string | number | null)[][]) {
  const objs = rows.map((r) => {
    const o: Record<string, unknown> = {};
    HEADERS.forEach((h, i) => (o[h] = r[i] ?? null));
    return o;
  });
  return buildSessions(objs, autoMapColumns(HEADERS));
}

const opts = { thresholds: DEFAULT_THRESHOLDS, roleMaxHours: ROLE_MAX_HOURS };

describe("official teaching periods", () => {
  it("defines four weekday periods and three on Saturday, with lunch free", () => {
    expect(WEEKDAY_SLOTS.map((x) => [x.startMin / 60, x.endMin / 60])).toEqual([
      [9, 11], [11, 13], [14, 16], [16, 18],
    ]);
    expect(SATURDAY_SLOTS.map((x) => [x.startMin / 60, x.endMin / 60])).toEqual([
      [9, 11], [11, 13], [14, 16],
    ]);
    // Nothing runs over lunch (1–2 PM) and Saturday stops at 4 PM.
    expect(isOfficialSlot("MON", 13 * 60, 14 * 60)).toBe(false);
    expect(isOfficialSlot("SAT", 16 * 60, 18 * 60)).toBe(false);
    expect(isOfficialSlot("MON", 16 * 60, 18 * 60)).toBe(true);
  });

  it("folds the sheet's spellings of a period onto that period", () => {
    const snap = (day: DayCode, a: number, b: number) => {
      const r = snapToOfficialSlot(day, a, b);
      return r ? [r.startMin / 60, r.endMin / 60] : null;
    };
    expect(snap("MON", 9 * 60, 10 * 60 + 55)).toEqual([9, 11]);
    expect(snap("MON", 11 * 60 + 5, 13 * 60)).toEqual([11, 13]);
    expect(snap("MON", 14 * 60, 15 * 60 + 55)).toEqual([14, 16]);
    expect(snap("MON", 16 * 60 + 5, 18 * 60)).toEqual([16, 18]);
    // …but never invents a period for a genuinely different time.
    expect(snap("MON", 13 * 60, 14 * 60)).toBeNull(); // lunch hour
    expect(snap("FRI", 17 * 60 + 45, 20 * 60)).toBeNull(); // evening
    expect(snap("SAT", 16 * 60 + 5, 18 * 60)).toBeNull(); // no Saturday 4–6
  });

  it("rejects any placement that is not an official period", () => {
    const s = makeSessions([base({ WDAY: "MON", Time: "9:00AM - 11:00AM" })]);
    const lunch = validatePlacement(
      s[0].rowId,
      { ...placementOf(s[0]), day: "MON", startMin: 13 * 60, endMin: 14 * 60 },
      s,
      opts,
    ).filter((v) => v.severity === "error");
    expect(lunch.some((e) => e.kind === "time_window")).toBe(true);
    expect(lunch.find((e) => e.kind === "time_window")!.message).toMatch(/not an official/i);

    // Saturday has no 4–6 PM period.
    const lateSat = validatePlacement(
      s[0].rowId,
      { ...placementOf(s[0]), day: "SAT", startMin: 16 * 60, endMin: 18 * 60 },
      s,
      opts,
    ).filter((v) => v.kind === "time_window");
    expect(lateSat).toHaveLength(1);
  });

  it("only ever offers official periods when rescheduling", () => {
    const s = makeSessions([
      base({ UNITCODE: "U1", WDAY: "MON", Time: "9:00AM - 11:00AM", ROOMCODE: "101", BATCHCODE: "B1" }),
      base({ UNITCODE: "U2", WDAY: "MON", Time: "9:00AM - 11:00AM", ROOMCODE: "102", BATCHCODE: "B1" }),
    ]);
    const offered = [
      ...rescheduleCandidates(s[1], s, opts).map((c) => ({ d: c.day, a: c.startMin, b: c.endMin })),
      ...reschedulePlans(s[1], s, opts).map((p) => ({ d: p.day, a: p.startMin, b: p.endMin })),
    ];
    expect(offered.length).toBeGreaterThan(0);
    for (const o of offered) {
      expect(isOfficialSlot(o.d, o.a, o.b), `${o.d} ${o.a}-${o.b} must be official`).toBe(true);
    }
  });

  it("recovers an obvious AM/PM slip, but never guesses", () => {
    const snap = (day: DayCode, a: number, b: number) => {
      const r = snapToOfficialSlot(day, a, b);
      return r ? [r.startMin / 60, r.endMin / 60] : null;
    };
    // "2:00 AM - 3:55 PM" can only mean the afternoon period.
    expect(snap("MON", 2 * 60, 15 * 60 + 55)).toEqual([14, 16]);
    // "9:05 AM - 10:55 PM" — the END carries the slip.
    expect(snap("MON", 9 * 60 + 5, 22 * 60 + 55)).toEqual([9, 11]);
    // "11:05 PM - 1:00 PM" — the START carries it.
    expect(snap("MON", 23 * 60 + 5, 13 * 60)).toEqual([11, 13]);

    // A well-formed time is never "repaired".
    expect(snap("MON", 13 * 60, 14 * 60)).toBeNull();
    // Saturday has no 4–6 PM period, so flipping the end helps nothing.
    expect(snap("SAT", 16 * 60 + 5, 6 * 60)).toBeNull();
  });

  it("snaps messy times on the way in", () => {
    const s = makeSessions([
      base({ WDAY: "MON", Time: "9:00AM - 10:55AM" }),
      base({ WDAY: "SAT", Time: "2:00PM-3:55PM", Programm: "MSCIT" }),
      base({ WDAY: "FRI", Time: "5:45PM - 8:00PM" }),
    ]);
    expect([s[0].startMin, s[0].endMin]).toEqual([9 * 60, 11 * 60]);
    expect([s[1].startMin, s[1].endMin]).toEqual([14 * 60, 16 * 60]);
    // Left untouched, so it can be reported rather than silently moved.
    expect([s[2].startMin, s[2].endMin]).toEqual([17 * 60 + 45, 20 * 60]);
  });
});

describe("daily class limits", () => {
  /** A lecturer filling every weekday period, back to back. */
  const fullDay = (faculty = "Dr A") =>
    makeSessions([
      base({ Faculty: faculty, WDAY: "MON", Time: "9:00AM - 11:00AM", UNITCODE: "A", ROOMCODE: "101", BATCHCODE: "B1" }),
      base({ Faculty: faculty, WDAY: "MON", Time: "11:00AM - 1:00PM", UNITCODE: "B", ROOMCODE: "102", BATCHCODE: "B2" }),
      base({ Faculty: faculty, WDAY: "MON", Time: "2:00PM - 4:00PM", UNITCODE: "C", ROOMCODE: "103", BATCHCODE: "B3" }),
      base({ Faculty: faculty, WDAY: "MON", Time: "4:00PM - 6:00PM", UNITCODE: "D", ROOMCODE: "104", BATCHCODE: "B4" }),
    ]);

  it("allows four weekday classes and three on Saturday", () => {
    expect(DEFAULT_THRESHOLDS.maxSessionsPerWeekday).toBe(4);
    expect(DEFAULT_THRESHOLDS.maxSessionsPerSaturday).toBe(3);
  });

  it("lets a lecturer teach all four weekday periods back to back", () => {
    const s = fullDay();
    for (const session of s) {
      const errs = validatePlacement(session.rowId, placementOf(session), s, opts).filter(
        (v) => v.severity === "error",
      );
      expect(errs, `${session.unitCode} should be allowed`).toHaveLength(0);
    }
  });

  it("treats a long back-to-back run as advice, never a blocker", () => {
    const s = fullDay();
    const all = validatePlacement(s[3].rowId, placementOf(s[3]), s, opts);
    expect(all.filter((v) => v.kind === "consecutive" && v.severity === "error")).toHaveLength(0);
  });

  it("blocks a fifth weekday class — there is no fifth period", () => {
    const s = fullDay();
    // A fifth class can only exist by doubling up on a period.
    const fifth = makeSessions([
      base({ Faculty: "Dr A", WDAY: "MON", Time: "9:00AM - 11:00AM", UNITCODE: "E", ROOMCODE: "105", BATCHCODE: "B5" }),
    ]).map((x) => ({ ...x, rowId: 5 }));
    const errs = validatePlacement(5, placementOf(fifth[0]), [...s, ...fifth], opts).filter(
      (v) => v.kind === "max_per_day",
    );
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/only 4 teaching periods exist/);
  });

  it("caps Saturday at three classes", () => {
    const sat = makeSessions([
      base({ Programm: "MSCIT", Faculty: "Dr S", WDAY: "SAT", Time: "9:00AM - 11:00AM", UNITCODE: "A", ROOMCODE: "101", BATCHCODE: "M1" }),
      base({ Programm: "MSCIT", Faculty: "Dr S", WDAY: "SAT", Time: "11:00AM - 1:00PM", UNITCODE: "B", ROOMCODE: "102", BATCHCODE: "M2" }),
      base({ Programm: "MSCIT", Faculty: "Dr S", WDAY: "SAT", Time: "2:00PM - 4:00PM", UNITCODE: "C", ROOMCODE: "103", BATCHCODE: "M3" }),
    ]);
    for (const session of sat) {
      const errs = validatePlacement(session.rowId, placementOf(session), sat, opts).filter(
        (v) => v.kind === "max_per_day",
      );
      expect(errs).toHaveLength(0);
    }
    const fourth = makeSessions([
      base({ Programm: "MSCIT", Faculty: "Dr S", WDAY: "SAT", Time: "9:00AM - 11:00AM", UNITCODE: "D", ROOMCODE: "104", BATCHCODE: "M4" }),
    ]).map((x) => ({ ...x, rowId: 4 }));
    const errs = validatePlacement(4, placementOf(fourth[0]), [...sat, ...fourth], opts).filter(
      (v) => v.kind === "max_per_day",
    );
    expect(errs[0].message).toMatch(/only 3 teaching periods exist/);
  });

  it("keeps the weekly hour cap strict even when the day is legal", () => {
    // Four 2-hour classes a day is fine, but 22h a week is not negotiable.
    const s = makeSessions([
      base({ Faculty: "Dr Full", WDAY: "MON", Time: "9:00AM - 11:00AM", Hours: 21, UNITCODE: "A", ROOMCODE: "101", BATCHCODE: "B1" }),
      base({ Faculty: "Dr Full", WDAY: "TUE", Time: "9:00AM - 11:00AM", Hours: 2, UNITCODE: "B", ROOMCODE: "102", BATCHCODE: "B2" }),
    ]);
    const errs = validatePlacement(s[1].rowId, placementOf(s[1]), s, opts).filter(
      (v) => v.kind === "workload" && v.severity === "error",
    );
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/22h weekly limit/);
  });
});

describe("configurable role workload limits", () => {
  it("ships adjustable caps for every staff role incl. DAA, AR, H.O.D. and Dean", () => {
    for (const role of ["Lecturer", "H.O.D.", "Dean", "DAA", "AR", "Lab Assistant", PART_TIME_ROLE]) {
      expect(typeof ROLE_MAX_HOURS[role]).toBe("number");
    }
  });

  it("caps part-time staff by the Part-Time limit whatever their role", () => {
    expect(maxHoursFor("H.O.D.", "FT", ROLE_MAX_HOURS)).toBe(ROLE_MAX_HOURS["H.O.D."]);
    expect(maxHoursFor("H.O.D.", "PT", ROLE_MAX_HOURS)).toBe(ROLE_MAX_HOURS[PART_TIME_ROLE]);
    expect(maxHoursFor("Dean", "PT", ROLE_MAX_HOURS)).toBe(ROLE_MAX_HOURS[PART_TIME_ROLE]);
  });

  it("uses the configured limits in the workload report", () => {
    const s = makeSessions([base({ Faculty: "Dr HOD" })]);
    const custom = { ...ROLE_MAX_HOURS, "H.O.D.": 10, [PART_TIME_ROLE]: 8 };

    const ft = lecturerWorkload(s, { "Dr HOD": "H.O.D." }, custom, {})[0];
    expect(ft.maxHours).toBe(10);

    // An H.O.D. flagged Part-Time is still governed by the H.O.D. limit —
    // only Lecturers may be Part-Time.
    const hodPt = lecturerWorkload(s, { "Dr HOD": "H.O.D." }, custom, { "Dr HOD": "PT" })[0];
    expect(hodPt.facultyType).toBe("FT");
    expect(hodPt.maxHours).toBe(10);

    // A Lecturer marked Part-Time does get the Part-Time cap.
    const lecturerPt = lecturerWorkload(s, { "Dr HOD": "Lecturer" }, custom, { "Dr HOD": "PT" })[0];
    expect(lecturerPt.facultyType).toBe("PT");
    expect(lecturerPt.maxHours).toBe(8);
  });

  it("backfills new roles over a stale persisted map", () => {
    const stale = { Lecturer: 18 };
    const merged = withRoleDefaults(stale);
    expect(merged.Lecturer).toBe(18);
    expect(merged[PART_TIME_ROLE]).toBe(ROLE_MAX_HOURS[PART_TIME_ROLE]);
    expect(merged.DAA).toBe(ROLE_MAX_HOURS.DAA);
  });
});

describe("search", () => {
  const sessions = makeSessions([
    base({ UNITCODE: "RM101", UNITNAME: "Research Methods", Faculty: "Dr Ochieng", ROOMCODE: "204" }),
    base({ UNITCODE: "CS200", UNITNAME: "Operating Systems", Faculty: "Dr Smith", ROOMCODE: "109", Programm: "BSCCS", BATCHCODE: "B2" }),
    base({ UNITCODE: "BA300", UNITNAME: "Taxation", Faculty: "Dr Tax", ROOMCODE: "ONLINE", Programm: "BBAIB", BATCHCODE: "B3", WDAY: "TUE" }),
  ]);

  it("matches across unit, lecturer, room and programme", () => {
    expect(searchSessions(sessions, "research")).toHaveLength(1);
    expect(searchSessions(sessions, "ochieng")).toHaveLength(1);
    expect(searchSessions(sessions, "109")).toHaveLength(1);
    expect(searchSessions(sessions, "bbaib")).toHaveLength(1);
    expect(searchSessions(sessions, "")).toHaveLength(3);
  });

  it("requires every term to match (AND semantics)", () => {
    expect(searchSessions(sessions, "research methods")).toHaveLength(1);
    expect(searchSessions(sessions, "research taxation")).toHaveLength(0);
  });

  it("supports field:value qualifiers", () => {
    expect(searchSessions(sessions, "room:204")).toHaveLength(1);
    expect(searchSessions(sessions, "lecturer:tax")).toHaveLength(1);
    expect(searchSessions(sessions, "day:TUE")).toHaveLength(1);
    // 204 is a room, never a lecturer
    expect(searchSessions(sessions, "lecturer:204")).toHaveLength(0);
  });

  it("supports quoted phrases and negation", () => {
    expect(searchSessions(sessions, '"operating systems"')).toHaveLength(1);
    expect(searchSessions(sessions, "-online")).toHaveLength(2);
  });

  it("is case-insensitive and exposes highlight terms", () => {
    expect(searchSessions(sessions, "RESEARCH")).toHaveLength(1);
    expect(parseQuery("room:204 -online")).toHaveLength(2);
    expect(highlightTerms("research methods")).toEqual(["research", "methods"]);
  });
});

describe("Fix panel search cost", () => {
  /**
   * Opening Fix generates candidates for one session. Restricting the search to
   * the official periods and skipping the room loop when a slot fails for a
   * reason no room can fix took this from ~29ms to ~1ms per session; this guards
   * against that regressing.
   */
  it("plans a busy session quickly", () => {
    // A full week of teaching, every period, so the search has real work to do.
    const rows: (string | number | null)[][] = [];
    const days = ["MON", "TUE", "WED", "THU", "FRI"];
    const times = ["9:00AM - 11:00AM", "11:00AM - 1:00PM", "2:00PM - 4:00PM", "4:00PM - 6:00PM"];
    let n = 0;
    for (const d of days) {
      for (const t of times) {
        for (let room = 0; room < 6; room++) {
          n += 1;
          rows.push(
            base({
              WDAY: d, Time: t, ROOMCODE: `R${room}`, Faculty: `Dr ${n % 20}`,
              UNITCODE: `U${n}`, BATCHCODE: `B${n % 25}`, Hours: 2,
            }),
          );
        }
      }
    }
    const s = makeSessions(rows);
    const registry: Record<string, number> = {};
    for (let room = 0; room < 6; room++) registry[`R${room}`] = 40;
    const cfg = { ...opts, roomRegistry: registry };

    const started = performance.now();
    const runs = 20;
    for (let i = 0; i < runs; i++) reschedulePlans(s[i % s.length], s, cfg);
    const perCall = (performance.now() - started) / runs;

    expect(perCall, `reschedulePlans took ${perCall.toFixed(1)}ms per session`).toBeLessThan(15);
  });
});
