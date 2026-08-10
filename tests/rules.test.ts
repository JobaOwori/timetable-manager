import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import { validatePlacement, placementOf, detectRuleViolations } from "@/lib/validate";
import { rescheduleCandidates } from "@/lib/transfer";
import { lecturerWorkload } from "@/lib/analysis";
import { DEFAULT_THRESHOLDS } from "@/lib/types";
import { SATURDAY_WINDOW, withinSaturdayWindow } from "@/lib/facultyType";
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

describe("Saturday 9:00 AM – 4:00 PM teaching window", () => {
  it("defaults to 9 AM–4 PM", () => {
    expect(SATURDAY_WINDOW.startMin).toBe(9 * 60);
    expect(SATURDAY_WINDOW.endMin).toBe(16 * 60);
    expect(DEFAULT_THRESHOLDS.saturdayStartMin).toBe(9 * 60);
    expect(DEFAULT_THRESHOLDS.saturdayEndMin).toBe(16 * 60);
  });

  it("accepts a slot inside the window and rejects one that overruns 4 PM", () => {
    expect(withinSaturdayWindow(9 * 60, 11 * 60)).toBe(true);
    expect(withinSaturdayWindow(14 * 60, 16 * 60)).toBe(true);
    expect(withinSaturdayWindow(16 * 60, 18 * 60)).toBe(false);
    expect(withinSaturdayWindow(8 * 60, 10 * 60)).toBe(false);
  });

  it("flags a Saturday class that ends at 6 PM as a policy violation", () => {
    const s = makeSessions([
      base({ Programm: "MSCIT", WDAY: "SAT", Time: "4:00PM - 6:00PM", ROOMCODE: "301" }),
    ]);
    const errs = validatePlacement(s[0].rowId, placementOf(s[0]), s, opts).filter(
      (v) => v.severity === "error",
    );
    expect(errs.some((e) => e.kind === "time_window")).toBe(true);
    expect(errs.find((e) => e.kind === "time_window")!.message).toMatch(/9:00 AM.*4:00 PM/);

    const rules = detectRuleViolations(s, opts);
    expect(rules.some((r) => r.kind === "time_window")).toBe(true);
  });

  it("accepts a Saturday class that finishes by 4 PM", () => {
    const s = makeSessions([
      base({ Programm: "MSCIT", WDAY: "SAT", Time: "2:00PM - 4:00PM", ROOMCODE: "301" }),
    ]);
    const errs = validatePlacement(s[0].rowId, placementOf(s[0]), s, opts).filter(
      (v) => v.severity === "error",
    );
    expect(errs).toHaveLength(0);
  });

  it("only offers Saturday slots that finish by 4 PM when rescheduling", () => {
    const s = makeSessions([
      base({ Programm: "MSCIT", WDAY: "SAT", Time: "4:00PM - 6:00PM", ROOMCODE: "301" }),
    ]);
    const sat = rescheduleCandidates(s[0], s, opts).filter((c) => c.day === "SAT");
    expect(sat.length).toBeGreaterThan(0);
    for (const c of sat) {
      expect(c.startMin).toBeGreaterThanOrEqual(9 * 60);
      expect(c.endMin).toBeLessThanOrEqual(16 * 60);
    }
  });

  it("honours a customised Saturday window", () => {
    const s = makeSessions([
      base({ Programm: "MSCIT", WDAY: "SAT", Time: "4:00PM - 6:00PM", ROOMCODE: "301" }),
    ]);
    const late = {
      thresholds: { ...DEFAULT_THRESHOLDS, saturdayEndMin: 18 * 60 },
      roleMaxHours: ROLE_MAX_HOURS,
    };
    const errs = validatePlacement(s[0].rowId, placementOf(s[0]), s, late).filter(
      (v) => v.kind === "time_window",
    );
    expect(errs).toHaveLength(0);
  });
});

describe("part-time daily class limit", () => {
  const fourClasses = (faculty = "Dr PT") =>
    makeSessions([
      base({ Faculty: faculty, Time: "8:00AM - 9:00AM", UNITCODE: "A", ROOMCODE: "101" }),
      base({ Faculty: faculty, Time: "9:30AM - 10:30AM", UNITCODE: "B", ROOMCODE: "102", BATCHCODE: "B2" }),
      base({ Faculty: faculty, Time: "11:00AM - 12:00PM", UNITCODE: "C", ROOMCODE: "103", BATCHCODE: "B3" }),
      base({ Faculty: faculty, Time: "1:00PM - 2:00PM", UNITCODE: "D", ROOMCODE: "104", BATCHCODE: "B4" }),
    ]);

  it("defaults part-time staff to 4 classes per day and full-time to 3", () => {
    expect(DEFAULT_THRESHOLDS.maxSessionsPerDayPartTime).toBe(4);
    expect(DEFAULT_THRESHOLDS.maxSessionsPerDay).toBe(3);
  });

  it("allows a part-time lecturer a 4th class on the same day", () => {
    const s = fourClasses();
    const partTime = { ...opts, facultyTypeRegistry: { "Dr PT": "PT" as const } };
    const errs = validatePlacement(s[3].rowId, placementOf(s[3]), s, partTime).filter(
      (v) => v.kind === "max_per_day",
    );
    expect(errs).toHaveLength(0);
  });

  it("still blocks a full-time lecturer's 4th class on the same day", () => {
    const s = fourClasses("Dr FT");
    const errs = validatePlacement(s[3].rowId, placementOf(s[3]), s, opts).filter(
      (v) => v.kind === "max_per_day",
    );
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/max 3 per day for Full-Time/);
  });

  it("blocks a part-time lecturer's 5th class on the same day", () => {
    const s = [
      ...fourClasses(),
      ...makeSessions([
        base({ Faculty: "Dr PT", Time: "2:30PM - 3:30PM", UNITCODE: "E", ROOMCODE: "105", BATCHCODE: "B5" }),
      ]).map((x) => ({ ...x, rowId: 5 })),
    ];
    const partTime = { ...opts, facultyTypeRegistry: { "Dr PT": "PT" as const } };
    const errs = validatePlacement(5, placementOf(s[4]), s, partTime).filter(
      (v) => v.kind === "max_per_day",
    );
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/max 4 per day for Part-Time/);
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
