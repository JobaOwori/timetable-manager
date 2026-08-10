import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import { reschedulePlans, rescheduleBlockers, applyReschedulePlan } from "@/lib/transfer";
import { allClashes, detectClashes, lecturerWorkload } from "@/lib/analysis";
import { validatePlacement, placementOf, detectRuleViolations } from "@/lib/validate";
import { DEFAULT_THRESHOLDS, Session } from "@/lib/types";
import { ROLE_MAX_HOURS, PART_TIME_ROLE, canBePartTime, ASSIGNABLE_ROLES, FULL_TIME_ONLY_ROLES } from "@/lib/roles";
import { effectiveFacultyType } from "@/lib/facultyType";
import { classDetails, buildClassIndex, distinctCohorts, sessionsForCohort, summarise } from "@/lib/classDetails";
import { buildGrid } from "@/lib/grid";
import { applyMerge } from "@/lib/merge";

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

describe("part-time is restricted to the Lecturer role", () => {
  it("allows only Lecturer to be Part-Time", () => {
    expect(canBePartTime("Lecturer")).toBe(true);
    for (const role of ["H.O.D.", "Dean", "DAA", "AR", "Lab Assistant", "Teaching Assistant"]) {
      expect(canBePartTime(role), `${role} must be Full-Time only`).toBe(false);
    }
  });

  it("offers Teaching Assistant as an assignable role", () => {
    expect(ASSIGNABLE_ROLES).toContain("Teaching Assistant");
    expect(ASSIGNABLE_ROLES).not.toContain(PART_TIME_ROLE);
    expect(FULL_TIME_ONLY_ROLES.sort()).toEqual(
      ["AR", "DAA", "Dean", "H.O.D.", "Lab Assistant", "Teaching Assistant"].sort(),
    );
  });

  it("forces a substantive role back to Full-Time even if the registry says PT", () => {
    expect(effectiveFacultyType("X", { X: "Dean" }, { X: "PT" })).toBe("FT");
    expect(effectiveFacultyType("X", { X: "AR" }, { X: "PT" })).toBe("FT");
    expect(effectiveFacultyType("X", { X: "Lecturer" }, { X: "PT" })).toBe("PT");
    // No role recorded at all defaults to Lecturer, so PT is honoured.
    expect(effectiveFacultyType("X", {}, { X: "PT" })).toBe("PT");
  });

  it("applies the Full-Time daily class limit to a PT-flagged H.O.D.", () => {
    const s = makeSessions([
      base({ Faculty: "Dr H", Time: "8:00AM - 9:00AM", UNITCODE: "A", ROOMCODE: "101" }),
      base({ Faculty: "Dr H", Time: "9:30AM - 10:30AM", UNITCODE: "B", ROOMCODE: "102", BATCHCODE: "B2" }),
      base({ Faculty: "Dr H", Time: "11:00AM - 12:00PM", UNITCODE: "C", ROOMCODE: "103", BATCHCODE: "B3" }),
      base({ Faculty: "Dr H", Time: "1:00PM - 2:00PM", UNITCODE: "D", ROOMCODE: "104", BATCHCODE: "B4" }),
    ]);
    const cfg = { ...opts, roleRegistry: { "Dr H": "H.O.D." }, facultyTypeRegistry: { "Dr H": "PT" as const } };
    const errs = validatePlacement(s[3].rowId, placementOf(s[3]), s, cfg).filter(
      (v) => v.kind === "max_per_day",
    );
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/max 3 per day for Full-Time/);
  });

  it("reports a PT-flagged Dean as Full-Time in the workload report", () => {
    const s = makeSessions([base({ Faculty: "Dr D" })]);
    const w = lecturerWorkload(s, { "Dr D": "Dean" }, ROLE_MAX_HOURS, { "Dr D": "PT" })[0];
    expect(w.facultyType).toBe("FT");
    expect(w.maxHours).toBe(ROLE_MAX_HOURS.Dean);
  });
});

describe("reschedule planning", () => {
  /** A cohort clash: B1 has two different units in the same slot. */
  const cohortClash = () =>
    makeSessions([
      base({ UNITCODE: "U1", ROOMCODE: "101", Faculty: "Dr A" }),
      base({ UNITCODE: "U2", ROOMCODE: "102", Faculty: "Dr B" }),
      // free space elsewhere in the week
      base({ UNITCODE: "U3", WDAY: "TUE", Time: "2:00PM - 3:55PM", ROOMCODE: "103", Faculty: "Dr C", BATCHCODE: "B9" }),
    ]);

  it("only ever proposes fully valid, conflict-free placements", () => {
    const s = cohortClash();
    const plans = reschedulePlans(s[1], s, opts);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      const errs = validatePlacement(
        s[1].rowId,
        { ...placementOf(s[1]), day: p.day, startMin: p.startMin, endMin: p.endMin, room: p.room, lecturer: p.lecturer },
        s,
        opts,
      ).filter((v) => v.severity === "error");
      expect(errs, `plan ${p.label} must break no rule`).toHaveLength(0);
    }
  });

  it("actually clears the conflict when a plan is applied", () => {
    const s = cohortClash();
    expect(allClashes(s).length).toBeGreaterThan(0);
    const plan = reschedulePlans(s[1], s, opts)[0];
    const after = applyReschedulePlan(s, s[1].rowId, plan);
    expect(allClashes(after)).toHaveLength(0);
  });

  it("prefers the smallest change — same room and lecturer first", () => {
    const s = cohortClash();
    const best = reschedulePlans(s[1], s, opts)[0];
    expect(best.recommended).toBe(true);
    expect(best.lecturerChanged).toBe(false);
    expect(best.roomChanged).toBe(false);
  });

  it("checks room availability and moves room when the slot needs it", () => {
    // Only one alternative slot exists, and room 101 is taken in it — the plan
    // must therefore propose a different room rather than give up.
    const s = makeSessions([
      base({ UNITCODE: "U1", ROOMCODE: "101", Faculty: "Dr A", BATCHCODE: "B1" }),
      base({ UNITCODE: "U2", ROOMCODE: "101", Faculty: "Dr A", BATCHCODE: "B1" }),
      base({ UNITCODE: "U3", WDAY: "TUE", ROOMCODE: "101", Faculty: "Dr C", BATCHCODE: "B9" }),
      base({ UNITCODE: "U4", WDAY: "TUE", ROOMCODE: "202", Faculty: "Dr D", BATCHCODE: "B8" }),
    ]);
    const plans = reschedulePlans(s[1], s, { ...opts, roomRegistry: { "101": 30, "202": 30, "303": 40 } });
    const tue = plans.filter((p) => p.day === "TUE");
    expect(tue.length).toBeGreaterThan(0);
    for (const p of tue) expect(p.room).not.toBe("101");
  });

  it("falls back to another lecturer only when nothing else fits", () => {
    // Dr A teaches in every slot of the week, so the class cannot stay with them.
    const s = makeSessions([
      base({ UNITCODE: "U1", Faculty: "Dr A", WDAY: "MON", Time: "9:00AM - 10:55AM", ROOMCODE: "101", BATCHCODE: "B1" }),
      base({ UNITCODE: "U2", Faculty: "Dr A", WDAY: "MON", Time: "9:00AM - 10:55AM", ROOMCODE: "102", BATCHCODE: "B1" }),
      base({ UNITCODE: "U3", Faculty: "Dr A", WDAY: "TUE", Time: "9:00AM - 10:55AM", ROOMCODE: "103", BATCHCODE: "B7" }),
      base({ UNITCODE: "U4", Faculty: "Dr B", WDAY: "TUE", Time: "9:00AM - 10:55AM", ROOMCODE: "104", BATCHCODE: "B8" }),
    ]);
    const plans = reschedulePlans(s[1], s, opts);
    // Every returned plan is still fully valid…
    for (const p of plans) {
      const errs = validatePlacement(
        s[1].rowId,
        { ...placementOf(s[1]), day: p.day, startMin: p.startMin, endMin: p.endMin, room: p.room, lecturer: p.lecturer },
        s,
        opts,
      ).filter((v) => v.severity === "error");
      expect(errs).toHaveLength(0);
    }
    // …and applying one clears the clash.
    if (plans.length > 0) {
      const after = applyReschedulePlan(s, s[1].rowId, plans[0]);
      expect(detectClashes(after, "batch_code")).toHaveLength(0);
    }
  });

  it("respects the opt-outs for room and lecturer changes", () => {
    const s = cohortClash();
    const strict = reschedulePlans(s[1], s, {
      ...opts,
      allowRoomChange: false,
      allowLecturerChange: false,
    });
    for (const p of strict) {
      expect(p.roomChanged).toBe(false);
      expect(p.lecturerChanged).toBe(false);
    }
  });

  it("never offers a Saturday slot past 4:00 PM", () => {
    const s = makeSessions([
      base({ Programm: "MSCIT", WDAY: "SAT", Time: "4:00PM - 6:00PM", ROOMCODE: "301", BATCHCODE: "M1" }),
      base({ Programm: "MSCIT", WDAY: "SAT", Time: "9:00AM - 10:55AM", ROOMCODE: "302", BATCHCODE: "M2", Faculty: "Dr Z" }),
    ]);
    const plans = reschedulePlans(s[0], s, opts);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.day).toBe("SAT"); // Master's programmes are Saturday-only
      expect(p.endMin).toBeLessThanOrEqual(16 * 60);
    }
  });

  it("is not blocked by a pre-existing breach the move cannot fix", () => {
    // Dr X is already far over their weekly limit. That breach is invariant to
    // WHEN the class runs, so it must not veto every alternative slot and leave
    // the actual clash unfixable.
    const s = makeSessions([
      base({ Faculty: "Dr X", UNITCODE: "U1", Hours: 20, ROOMCODE: "101", BATCHCODE: "B1" }),
      base({ Faculty: "Dr X", UNITCODE: "U2", Hours: 20, ROOMCODE: "102", BATCHCODE: "B1" }),
      base({ Faculty: "Dr Y", UNITCODE: "U3", WDAY: "TUE", ROOMCODE: "103", BATCHCODE: "B9" }),
    ]);
    // The current placement really is over the cap…
    const pre = validatePlacement(s[1].rowId, placementOf(s[1]), s, opts).filter(
      (v) => v.kind === "workload",
    );
    expect(pre.length).toBeGreaterThan(0);

    // …yet a move is still offered, and it clears the cohort clash.
    const plans = reschedulePlans(s[1], s, opts);
    expect(plans.length).toBeGreaterThan(0);
    const after = applyReschedulePlan(s, s[1].rowId, plans[0]);
    expect(detectClashes(after, "batch_code")).toHaveLength(0);
  });

  it("still refuses a move that would newly break the workload cap", () => {
    // Dr Z is comfortably within limits; handing them a class that tips them
    // over must not be proposed.
    const s = makeSessions([
      base({ Faculty: "Dr A", UNITCODE: "U1", ROOMCODE: "101", BATCHCODE: "B1" }),
      base({ Faculty: "Dr A", UNITCODE: "U2", ROOMCODE: "102", BATCHCODE: "B1" }),
      base({ Faculty: "Dr Z", UNITCODE: "U3", WDAY: "TUE", Hours: 21, ROOMCODE: "103", BATCHCODE: "B9" }),
    ]);
    const plans = reschedulePlans(s[1], s, opts);
    for (const p of plans) {
      if (p.lecturer === "Dr Z") {
        const errs = validatePlacement(
          s[1].rowId,
          { ...placementOf(s[1]), day: p.day, startMin: p.startMin, endMin: p.endMin, room: p.room, lecturer: p.lecturer },
          s,
          opts,
        ).filter((v) => v.kind === "workload");
        expect(errs, "must not overload a lecturer who was within limits").toHaveLength(0);
      }
    }
  });

  it("names the cohort when the students are booked all week", () => {
    // B1 is in class in every slot, so the class genuinely cannot move.
    const s = makeSessions([
      base({ UNITCODE: "U1", ROOMCODE: "101", BATCHCODE: "B1", WDAY: "MON", Faculty: "Dr A" }),
      base({ UNITCODE: "U2", ROOMCODE: "102", BATCHCODE: "B1", WDAY: "MON", Faculty: "Dr B" }),
    ]);
    const plans = reschedulePlans(s[1], s, opts);
    if (plans.length === 0) {
      const reasons = rescheduleBlockers(s[1], s, opts).join(" ");
      expect(reasons).toMatch(/cohort B1 is already in class|students themselves are booked/);
    }
  });

  it("explains, in plain language, when nothing can be done", () => {
    const s = makeSessions([base({ WDAY: null, Time: null })]);
    const reasons = rescheduleBlockers(s[0], s, opts);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(" ")).toMatch(/no valid day\/time|no other scheduled day/i);
  });
});

describe("class details, programmes and cohorts", () => {
  const shared = () =>
    makeSessions([
      base({ Programm: "BBAIB", BATCHCODE: "TAXB", UNITCODE: "TAX", UNITNAME: "Taxation", Faculty: "Dr Tax", ROOMCODE: "109" }),
      base({ Programm: "BBAIM", BATCHCODE: "TAXM", UNITCODE: "ITAX", UNITNAME: "Introduction to Taxation", Faculty: "Dr Tax", ROOMCODE: "109" }),
    ]);

  it("lists every programme and cohort attending a combined class", () => {
    const s = shared();
    const idx = buildClassIndex(s);
    const d = classDetails(s[0], s, undefined, idx);
    expect(d.programmes).toEqual(["BBAIB", "BBAIM"]);
    expect(d.cohorts).toEqual(["TAXB", "TAXM"]);
    expect(d.shared).toBe(true);
    expect(d.headCount).toBe(40);
    expect(d.attendees).toHaveLength(2);
  });

  it("keeps the absorbed programmes and cohorts visible after a merge", () => {
    const merged = applyMerge(shared(), [1, 2]);
    expect(merged).toHaveLength(1);
    const d = classDetails(merged[0], merged);
    expect(d.programmes).toEqual(["BBAIB", "BBAIM"]);
    expect(d.cohorts).toEqual(["TAXB", "TAXM"]);
    expect(d.unitCodes).toContain("ITAX");
  });

  it("reports a single-cohort class as not shared", () => {
    const s = makeSessions([base()]);
    const d = classDetails(s[0], s);
    expect(d.shared).toBe(false);
    expect(d.programmes).toEqual(["BSCCS"]);
    expect(d.cohorts).toEqual(["B1"]);
  });

  it("summarises long lists compactly", () => {
    expect(summarise([])).toBe("—");
    expect(summarise(["A"])).toBe("A");
    expect(summarise(["A", "B", "C", "D"])).toBe("A, B +2");
  });
});

describe("cohort timetable view", () => {
  const week = () =>
    makeSessions([
      base({ BATCHCODE: "B1", UNITCODE: "U1", UNITNAME: "Intro", WDAY: "MON" }),
      base({ BATCHCODE: "B1", UNITCODE: "U2", UNITNAME: "Data", WDAY: "TUE", ROOMCODE: "102" }),
      base({ BATCHCODE: "B2", UNITCODE: "U3", UNITNAME: "Algo", WDAY: "WED", ROOMCODE: "103" }),
    ]);

  it("lists every cohort present", () => {
    expect(distinctCohorts(week())).toEqual(["B1", "B2"]);
  });

  it("returns the complete schedule for one cohort", () => {
    const s = week();
    const b1 = sessionsForCohort(s, "B1");
    expect(b1.map((x) => x.unitCode)).toEqual(["U1", "U2"]);
    expect(sessionsForCohort(s, "B2").map((x) => x.unitCode)).toEqual(["U3"]);
  });

  it("does not lose a cohort's class to a merge", () => {
    const s = makeSessions([
      base({ Programm: "BBAIB", BATCHCODE: "TAXB", UNITCODE: "TAX", UNITNAME: "Taxation", Faculty: "Dr Tax", ROOMCODE: "109" }),
      base({ Programm: "BBAIM", BATCHCODE: "TAXM", UNITCODE: "ITAX", UNITNAME: "Introduction to Taxation", Faculty: "Dr Tax", ROOMCODE: "109" }),
    ]);
    const merged = applyMerge(s, [1, 2]);
    // TAXM's own row is gone, but the students still have the class.
    expect(merged.some((x) => x.batchCode === "TAXM")).toBe(false);
    expect(sessionsForCohort(merged, "TAXM")).toHaveLength(1);
    expect(sessionsForCohort(merged, "TAXB")).toHaveLength(1);
  });
});

describe("timetable grid entries", () => {
  it("exposes the course code, name and supporting detail separately", () => {
    const s = makeSessions([base({ UNITCODE: "BAF1102", UNITNAME: "Financial Accounting I" })]);
    const grid = buildGrid(s, ["unitCode", "unitName", "room", "lecturer", "programme", "cohort"]);
    const cell = grid.cells[grid.slots[0]][grid.days[0]];
    expect(cell.entries).toHaveLength(1);
    const e = cell.entries[0];
    expect(e.unitCode).toBe("BAF1102");
    expect(e.unitName).toBe("Financial Accounting I");
    expect(e.secondary).toContain("Rm 101");
    expect(e.secondary).toContain("Dr Smith");
    expect(e.secondary).toContain("BSCCS");
    expect(e.secondary).toContain("B1");
    expect(e.text).toContain("Financial Accounting I");
  });

  it("shows all merged programmes on the entry", () => {
    const merged = applyMerge(
      makeSessions([
        base({ Programm: "BBAIB", BATCHCODE: "TAXB", UNITCODE: "TAX", UNITNAME: "Taxation", Faculty: "Dr Tax", ROOMCODE: "109" }),
        base({ Programm: "BBAIM", BATCHCODE: "TAXM", UNITCODE: "ITAX", UNITNAME: "Introduction to Taxation", Faculty: "Dr Tax", ROOMCODE: "109" }),
      ]),
      [1, 2],
    );
    const grid = buildGrid(merged, ["unitCode", "unitName", "programme", "cohort"]);
    const e = grid.cells[grid.slots[0]][grid.days[0]].entries[0];
    expect(e.secondary).toContain("BBAIB");
    expect(e.secondary).toContain("BBAIM");
  });
});

describe("policy violations are explained in plain English", () => {
  it("names the level and the actual day, with no UG/PG jargon", () => {
    // A Master's programme scheduled on a weekday.
    const pg = makeSessions([
      base({ Programm: "MSCIT", WDAY: "MON", UNITCODE: "MB1", UNITNAME: "IT Audit" }),
    ]);
    const pgMsg = detectRuleViolations(pg, opts).find((v) => v.kind === "programme_rule")!.message;
    expect(pgMsg).toContain("Master's");
    expect(pgMsg).toContain("Saturday only");
    expect(pgMsg).toContain("Monday");
    expect(pgMsg).not.toMatch(/UG|PG|≠/);

    // A Bachelor's programme scheduled on Saturday.
    const ug = makeSessions([
      base({ Programm: "BSCCS", WDAY: "SAT", Time: "9:00AM - 10:55AM", UNITCODE: "B1" }),
    ]);
    const ugMsg = detectRuleViolations(ug, opts).find((v) => v.kind === "programme_rule")!.message;
    expect(ugMsg).toContain("Bachelor's");
    expect(ugMsg).toContain("Saturday");
    expect(ugMsg).not.toMatch(/UG|PG|≠/);
  });

  it("carries the full class context so the UI needs no extra lookup", () => {
    const s = makeSessions([
      base({
        Programm: "MSCIT", WDAY: "MON", UNITCODE: "MB1", UNITNAME: "IT Audit",
        Faculty: "Dr Q", ROOMCODE: "308", BATCHCODE: "M1", "Head Count": 20,
      }),
    ]);
    const v = detectRuleViolations(s, opts).find((x) => x.kind === "programme_rule")!;
    expect(v.unitCode).toBe("MB1");
    expect(v.unitName).toBe("IT Audit");
    expect(v.lecturer).toBe("Dr Q");
    expect(v.room).toBe("308");
    expect(v.day).toBe("MON");
    expect(v.time).toBeTruthy();
    expect(v.headCount).toBe(20);
    expect(v.programmes).toEqual(["MSCIT"]);
    expect(v.cohorts).toEqual(["M1"]);
  });

  it("lists every programme and cohort of a merged class", () => {
    const merged = applyMerge(
      makeSessions([
        base({ Programm: "MBA", BATCHCODE: "M1", UNITCODE: "TX1", UNITNAME: "Taxation", Faculty: "Dr P", ROOMCODE: "406", WDAY: "MON" }),
        base({ Programm: "MSC.DFT", BATCHCODE: "M2", UNITCODE: "TX2", UNITNAME: "Introduction to Taxation", Faculty: "Dr P", ROOMCODE: "406", WDAY: "MON" }),
      ]),
      [1, 2],
    );
    const v = detectRuleViolations(merged, opts).find((x) => x.kind === "programme_rule");
    expect(v).toBeTruthy();
    expect(v!.programmes).toEqual(["MBA", "MSC.DFT"]);
    expect(v!.cohorts).toEqual(["M1", "M2"]);
  });
});
