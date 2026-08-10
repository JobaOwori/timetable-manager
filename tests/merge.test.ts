import { describe, it, expect } from "vitest";
import { buildSessions, autoMapColumns } from "@/lib/ingest";
import { detectClashes, allClashes, lecturerWorkload } from "@/lib/analysis";
import { mergeableGroups, applyMerge, mergeAllSimilar, mergeableGroupsTouching } from "@/lib/merge";
import { isCombinedPair } from "@/lib/sharedClass";
import { similarSubject, subjectSimilarity } from "@/lib/subjectGroup";
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

// The reported bug: "Research Methods" and "Business Research Methods" are one
// class taught by one lecturer in one room — not a room clash.
const relatedNames = (batch2 = "B1") =>
  makeSessions([
    base({ UNITCODE: "RM101", UNITNAME: "Research Methods", Faculty: "Dr Ochieng", ROOMCODE: "204" }),
    base({
      UNITCODE: "BRM201", UNITNAME: "Business Research Methods", Faculty: "Dr Ochieng",
      ROOMCODE: "204", BATCHCODE: batch2, Programm: "BBAIB",
    }),
  ]);

describe("similar-course room clash false positives", () => {
  it("does not flag related unit names by the same lecturer in one room", () => {
    for (const batch of ["B1", "B2", null as unknown as string]) {
      const s = relatedNames(batch);
      expect(isCombinedPair(s[0], s[1])).toBe(true);
      expect(detectClashes(s, "room")).toHaveLength(0);
      expect(detectClashes(s, "lecturer")).toHaveLength(0);
    }
  });

  it("counts the pair once toward lecturer workload", () => {
    const wl = lecturerWorkload(relatedNames(), {}, ROLE_MAX_HOURS, {});
    expect(wl.find((w) => w.lecturer === "Dr Ochieng")!.totalHours).toBe(2);
  });

  it("still flags related names when the room differs (a real double-booking)", () => {
    const s = makeSessions([
      base({ UNITNAME: "Research Methods", Faculty: "Dr Ochieng", ROOMCODE: "204" }),
      base({ UNITNAME: "Business Research Methods", Faculty: "Dr Ochieng", ROOMCODE: "205", BATCHCODE: "B2" }),
    ]);
    expect(detectClashes(s, "lecturer").length).toBeGreaterThan(0);
  });

  it("still flags unrelated units for the same lecturer, room and cohort", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", UNITNAME: "Discrete Mathematics", ROOMCODE: "101" }),
      base({ UNITCODE: "B", UNITNAME: "Corporate and Business Law", ROOMCODE: "101" }),
    ]);
    expect(isCombinedPair(s[0], s[1])).toBe(false);
    expect(detectClashes(s, "room").length).toBeGreaterThan(0);
  });

  it("scores near-identical titles as similar and unrelated ones as not", () => {
    expect(similarSubject("Research Methods", "Business Research Methods")).toBe(true);
    expect(similarSubject("Data Structures and Algorithms", "Data Structures")).toBe(true);
    expect(similarSubject("Discrete Mathematics", "Corporate and Business Law")).toBe(false);
    expect(subjectSimilarity("Global Financial Markets", "Oil & Gas Economics").score).toBeLessThan(0.6);
  });
});

describe("merge similar courses", () => {
  it("offers exactly one mergeable group for the related pair", () => {
    const s = relatedNames("B2");
    const groups = mergeableGroups(s);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toEqual([1, 2]);
    expect(groups[0].unitCodes.sort()).toEqual(["BRM201", "RM101"]);
    expect(groups[0].reason).toMatch(/same lecturer|same teaching session|identical/i);
  });

  it("collapses the group into one session and clears the conflict", () => {
    const s = relatedNames("B2");
    const merged = applyMerge(s, [1, 2]);
    expect(merged).toHaveLength(1);
    expect(merged[0].rowId).toBe(1);
    expect(merged[0].merged?.rowIds).toEqual([2]);
    expect(merged[0].merged?.unitCodes).toEqual(["BRM201"]);
    expect(allClashes(merged)).toHaveLength(0);
    expect(mergeableGroups(merged)).toHaveLength(0);
  });

  it("sums enrolment across distinct cohorts but not for repeated rows", () => {
    const twoCohorts = applyMerge(relatedNames("B2"), [1, 2]);
    expect(twoCohorts[0].headCount).toBe(40);

    const oneCohort = applyMerge(relatedNames("B1"), [1, 2]);
    expect(oneCohort[0].headCount).toBe(20);
  });

  it("records what it absorbed in the notes so the merge is explainable", () => {
    const merged = applyMerge(relatedNames("B2"), [1, 2]);
    expect(merged[0].notes).toMatch(/Merged 1 duplicate row: BRM201/);
  });

  it("merges every group in one pass and is idempotent", () => {
    const s = makeSessions([
      base({ UNITCODE: "RM101", UNITNAME: "Research Methods", Faculty: "Dr A", ROOMCODE: "204" }),
      base({ UNITCODE: "BRM201", UNITNAME: "Business Research Methods", Faculty: "Dr A", ROOMCODE: "204", BATCHCODE: "B2" }),
      base({ UNITCODE: "ES", UNITNAME: "Entrepreneurship Skills", Faculty: "Dr B", ROOMCODE: "300", WDAY: "TUE" }),
      base({ UNITCODE: "ITES", UNITNAME: "IT Entrepreneurship Skills", Faculty: "Dr B", ROOMCODE: "300", WDAY: "TUE", BATCHCODE: "B3" }),
    ]);
    const r = mergeAllSimilar(s);
    expect(r.merged).toBe(2);
    expect(r.removed).toBe(2);
    expect(r.sessions).toHaveLength(2);
    expect(mergeAllSimilar(r.sessions).merged).toBe(0);
  });

  it("refuses to merge rows that are a genuine double-booking", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", UNITNAME: "Discrete Mathematics", ROOMCODE: "101" }),
      base({ UNITCODE: "B", UNITNAME: "Microeconomics", ROOMCODE: "101" }),
    ]);
    expect(mergeableGroups(s)).toHaveLength(0);
    expect(mergeableGroupsTouching(s, [1, 2])).toHaveLength(0);
    // A merge must never silently delete a class that still needs teaching.
    expect(applyMerge(s, [1, 2])).toHaveLength(2);
    expect(detectClashes(s, "room").length).toBeGreaterThan(0);
  });

  it("does not merge different lecturers even for the same subject family", () => {
    const s = makeSessions([
      base({ UNITCODE: "RM", UNITNAME: "Research Methods", Faculty: "Dr A", ROOMCODE: "204" }),
      base({ UNITCODE: "BRM", UNITNAME: "Business Research Methods", Faculty: "Dr B", ROOMCODE: "204", BATCHCODE: "B2" }),
    ]);
    // Still a combined class (not a clash), but two people are involved, so the
    // rows are NOT collapsed automatically.
    expect(detectClashes(s, "room")).toHaveLength(0);
    expect(mergeableGroups(s)).toHaveLength(0);
  });

  it("merges a mixed cluster transitively (the real JAMES KAWUKI case)", () => {
    // Three co-scheduled units in ONE room: "Business Research Methods" and
    // "Marketing Research Methods" are directly alike, and "Research
    // Methodology" joins them through the shared subject family.
    const s = makeSessions([
      base({ UNITCODE: "BBAIB3123", UNITNAME: "Business Research Methods", Faculty: "J KAWUKI", ROOMCODE: "501", WDAY: "THU", BATCHCODE: "BBAIBF23DA" }),
      base({ UNITCODE: "BBAIM3123", UNITNAME: "Marketing Research Methods", Faculty: "J KAWUKI", ROOMCODE: "501", WDAY: "THU", BATCHCODE: "BBAIMF23DA" }),
      base({ UNITCODE: "BAE3128", UNITNAME: "Research Methodology", Faculty: "J KAWUKI", ROOMCODE: "501", WDAY: "THU", BATCHCODE: "BSCAEF24DA" }),
      // Same lecturer, same slot, DIFFERENT room — a genuine double-booking.
      base({ UNITCODE: "BAF2216", UNITNAME: "Research Methods", Faculty: "J KAWUKI", ROOMCODE: "301", WDAY: "THU", BATCHCODE: "BSCAFS24DA" }),
    ]);

    const groups = mergeableGroups(s);
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIds).toEqual([1, 2, 3]); // only the room-501 rows
    expect(groups[0].room).toBe("501");

    const merged = applyMerge(s, groups[0].rowIds);
    expect(merged).toHaveLength(2);
    expect(merged[0].merged?.unitCodes.sort()).toEqual(["BAE3128", "BBAIM3123"]);
    expect(merged[0].headCount).toBe(60); // three distinct cohorts of 20

    // The cross-room clash is preserved — one person can't be in two rooms.
    expect(detectClashes(merged, "lecturer").length).toBeGreaterThan(0);
  });

  it("keeps a room's genuinely different co-taught subjects unmerged", () => {
    const s = makeSessions([
      base({ UNITCODE: "A", UNITNAME: "Research Methods", Faculty: "Dr A", ROOMCODE: "501" }),
      base({ UNITCODE: "B", UNITNAME: "Corporate and Business Law", Faculty: "Dr A", ROOMCODE: "501", BATCHCODE: "B2" }),
    ]);
    // Combined (one lecturer, one room, two cohorts) so NOT a clash…
    expect(detectClashes(s, "room")).toHaveLength(0);
    // …but the two subjects are different, so they are never collapsed.
    expect(mergeableGroups(s)).toHaveLength(0);
  });

  it("finds the mergeable rows behind a conflict card's row list", () => {
    const s = relatedNames("B2");
    expect(mergeableGroupsTouching(s, [1, 2])).toHaveLength(1);
  });
});
