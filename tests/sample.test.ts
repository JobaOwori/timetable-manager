import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  readWorkbook, sheetNames, guessTimetableSheet, guessRoomSheet,
  readSheet, autoMapColumns, dropBlankRows, buildSessions, parseRoomRegistry,
} from "@/lib/ingest";
import { allClashes, lecturerWorkload, capacityAnalysis } from "@/lib/analysis";
import { ROLE_MAX_HOURS } from "@/lib/roles";
import { RoleRegistry } from "@/lib/types";

const SAMPLE = path.resolve(__dirname, "../public/sample/sample_timetable.xlsx");

function load() {
  const buf = readFileSync(SAMPLE);
  const wb = readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const names = sheetNames(wb);
  const tt = guessTimetableSheet(names)!;
  const table = readSheet(wb, tt);
  const mapping = autoMapColumns(table.header);
  const rows = dropBlankRows(table, mapping);
  const sessions = buildSessions(rows, mapping);
  const roomSheet = guessRoomSheet(names)!;
  const registry = parseRoomRegistry(wb, roomSheet);
  return { sessions, registry, names };
}

describe("real sample integration (parity with Python engine)", () => {
  const { sessions, registry, names } = load();

  it("auto-detects the multi-sheet layout", () => {
    expect(names).toContain("Time Table");
    expect(names).toContain("Room Capacity");
  });

  it("parses ~969 sessions with clean term codes", () => {
    // Python reported 969 data rows (972 after keeping blanks; dropBlankRows->969-972 range).
    expect(sessions.length).toBeGreaterThan(950);
    const terms = new Set(sessions.map((s) => s.term).filter(Boolean));
    expect(terms).toContain("1");
    expect(terms).toContain("2");
    // must NOT be float artifacts like "1.0"
    expect([...terms]).not.toContain("1.0");
  });

  it("parses room registry with Block B disambiguation", () => {
    expect(registry["104"]).toBe(20);
    expect(registry["206"]).toBe(67);
    expect(registry["B202"]).toBe(60);
    expect(registry["TOTAL"]).toBeUndefined();
  });

  it("enforces term isolation: total clashes == term1 + term2 clashes", () => {
    const t1 = sessions.filter((s) => s.term === "1");
    const t2 = sessions.filter((s) => s.term === "2");
    const all = allClashes(sessions).length;
    const sum = allClashes(t1).length + allClashes(t2).length;
    expect(all).toBe(sum);
    expect(all).toBeGreaterThan(400); // Python reported 584
  });

  it("cross-checks the human-flagged LECTURER TIME CLASHING rows", () => {
    // The original scheduler hand-annotated some rows as "LECTURER TIME CLASHING".
    // These are free-text notes, not all of which correspond to a still-present
    // overlap (some were partly fixed). Validate the engine independently detects
    // a real overlap for the majority of them.
    const flagged = sessions.filter((s) => (s.notes ?? "").toUpperCase().includes("CLASHING"));
    expect(flagged.length).toBeGreaterThanOrEqual(3);
    const clashes = allClashes(sessions);
    const involved = flagged.filter((f) =>
      clashes.some((c) => c.rowId1 === f.rowId || c.rowId2 === f.rowId),
    );
    expect(involved.length).toBeGreaterThanOrEqual(2);
  });

  it("computes workload with all-default Lecturer role", () => {
    const roleReg: RoleRegistry = {};
    for (const l of new Set(sessions.map((s) => s.lecturer).filter(Boolean) as string[])) roleReg[l] = "Lecturer";
    const wl = lecturerWorkload(sessions, roleReg, ROLE_MAX_HOURS, {});
    const unbalanced = wl.filter((w) => w.status === "Unbalanced").length;
    expect(unbalanced).toBeGreaterThan(5);
    expect(wl.every((w) => w.maxHours === 22)).toBe(true);
    expect(wl.every((w) => w.facultyType === "FT")).toBe(true);
  });

  it("computes capacity tiers", () => {
    const cap = capacityAnalysis(sessions, registry, 0.4, 20);
    const over = cap.filter((c) => c.capacityStatus === "Over Capacity").length;
    expect(over).toBeGreaterThan(30); // Python reported 74
  });
});
