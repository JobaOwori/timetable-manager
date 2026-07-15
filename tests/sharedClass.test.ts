import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import { detectClashes, lecturerWorkload } from "@/lib/analysis";
import {
  detectSharedClasses,
  sameSharedClass,
  combinedRowIds,
  dedupeSharedClasses,
} from "@/lib/sharedClass";
import { programmeLevel, requiresSaturday, forbiddenOnSaturday } from "@/lib/facultyType";
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

function makeSessions(rows: (string | number | null)[][]) {
  const objs = rows.map((r) => {
    const o: Record<string, unknown> = {};
    HEADERS.forEach((h, i) => (o[h] = r[i] ?? null));
    return o;
  });
  return buildSessions(objs, autoMapColumns(HEADERS));
}

// The real-world example: BBAIB "Taxation" and BBAIM "Introduction to Taxation"
// are one combined class — same term/day/time/room/lecturer, different cohorts.
const combined = () =>
  makeSessions([
    base({ Programm: "BBAIB", BATCHCODE: "TAXB", UNITCODE: "TAX", UNITNAME: "Taxation", Faculty: "Dr Tax", ROOMCODE: "109" }),
    base({ Programm: "BBAIM", BATCHCODE: "TAXM", UNITCODE: "ITAX", UNITNAME: "Introduction to Taxation", Faculty: "Dr Tax", ROOMCODE: "109" }),
  ]);

describe("combined / shared classes", () => {
  it("does NOT flag a combined class as a room or lecturer clash", () => {
    const s = combined();
    expect(detectClashes(s, "room").length).toBe(0);
    expect(detectClashes(s, "lecturer").length).toBe(0);
  });

  it("detects the combined class as a single shared group", () => {
    const s = combined();
    const groups = detectSharedClasses(s);
    expect(groups.length).toBe(1);
    expect(groups[0].programmes.sort()).toEqual(["BBAIB", "BBAIM"]);
    expect(groups[0].rowIds.length).toBe(2);
    expect(combinedRowIds(s).size).toBe(2);
    expect(sameSharedClass(s[0], s[1])).toBe(true);
  });

  it("counts a combined class once toward lecturer workload", () => {
    const s = combined();
    expect(dedupeSharedClasses(s).length).toBe(1);
    const wl = lecturerWorkload(s, {}, ROLE_MAX_HOURS, {});
    const drTax = wl.find((w) => w.lecturer === "Dr Tax")!;
    expect(drTax.totalHours).toBe(2); // one 2-hour class, not 4
  });

  it("still flags a genuine double-booking of the SAME cohort", () => {
    // Same batch B1 in two different units at the same time/room/lecturer.
    const s = makeSessions([
      base({ UNITCODE: "A", BATCHCODE: "B1" }),
      base({ UNITCODE: "B", BATCHCODE: "B1" }),
    ]);
    expect(sameSharedClass(s[0], s[1])).toBe(false);
    expect(detectClashes(s, "room").length).toBeGreaterThan(0);
    expect(detectClashes(s, "lecturer").length).toBeGreaterThan(0);
  });
});

describe("programme classification by code prefix", () => {
  it("maps prefixes to the five levels", () => {
    expect(programmeLevel("BSCCS")).toBe("bachelor");
    expect(programmeLevel("BBAIB")).toBe("bachelor");
    expect(programmeLevel("DIT")).toBe("diploma");
    expect(programmeLevel("HEC")).toBe("hec");
    expect(programmeLevel("HEC-HS")).toBe("hec");
    expect(programmeLevel("MSCIT")).toBe("master");
    expect(programmeLevel("MBA")).toBe("master");
    expect(programmeLevel("PHDICT")).toBe("doctoral");
    expect(programmeLevel("PGDIT")).toBe("doctoral");
  });

  it("derives Saturday scheduling rules from the level", () => {
    // Master's / doctoral run only on Saturday.
    expect(requiresSaturday("MSCIT")).toBe(true);
    expect(requiresSaturday("PHDICT")).toBe(true);
    expect(requiresSaturday("BSCCS")).toBe(false);
    // Bachelor / diploma / HEC never on Saturday.
    expect(forbiddenOnSaturday("BSCCS")).toBe(true);
    expect(forbiddenOnSaturday("DIT")).toBe(true);
    expect(forbiddenOnSaturday("HEC")).toBe(true);
    expect(forbiddenOnSaturday("MSCIT")).toBe(false);
  });
});
