import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "@/store/useStore";
import { detectClashes } from "@/lib/analysis";

// A compact CSV exercised through the real ingest pipeline (dedup + seeding).
const CSV = [
  "Programm,BATCHCODE,UNITCODE,UNITNAME,TERM,WDAY,Time,Hours,ROOMCODE,CAPACITY,Faculty,Head Count",
  // Dr Kay double-booked MON 9-10:55 (two cohorts/rooms) — a lecturer clash
  "BSCCS,B1,U1,Intro,1,MON,9:00AM - 10:55AM,2,101,30,Dr Kay,20",
  "BSCCS,B2,U2,Data,1,MON,9:00AM - 10:55AM,2,102,30,Dr Kay,20",
  // a free later slot exists so relocation is possible
  "BSCCS,B3,U3,Algo,1,TUE,2:00PM - 3:55PM,2,103,30,Dr Zed,20",
  // duplicate spelling of Dr Kay -> should be merged on load
  "BSCCS,B4,U4,Nets,1,WED,11:00AM - 12:55PM,2,104,30,KAY DR,20",
  // Term 2 row (isolation check)
  "MPH,B9,U9,Epi,2,MON,9:00AM - 10:55AM,2,101,30,Dr Kay,20",
].join("\n");

function load() {
  return useStore.getState().loadCsvText(CSV, "test.csv");
}

describe("store integration", () => {
  beforeEach(async () => {
    await load();
  });

  it("loads, isolates terms and merges duplicate faculty on ingest", () => {
    const st = useStore.getState();
    expect(st.loaded).toBe(true);
    expect(st.terms).toEqual(["1", "2"]);
    // "KAY DR" duplicate merged into "Dr Kay"
    const lecturers = new Set(st.sessions.map((s) => s.lecturer));
    expect(lecturers.has("Dr Kay")).toBe(true);
    expect(lecturers.has("KAY DR")).toBe(false);
  });

  it("seeds subject assignments from taught units", () => {
    const st = useStore.getState();
    expect(st.subjectAssignments["Dr Kay"]).toContain("U1");
    // U4 came from the merged duplicate, so it belongs to Dr Kay too
    expect(st.subjectAssignments["Dr Kay"]).toContain("U4");
  });

  it("assign/unassign subject mutates state", () => {
    useStore.getState().assignSubject("Dr Zed", "U1");
    expect(useStore.getState().subjectAssignments["Dr Zed"]).toContain("U1");
    useStore.getState().unassignSubject("Dr Zed", "U1");
    expect(useStore.getState().subjectAssignments["Dr Zed"]).not.toContain("U1");
  });

  it("transferLecturer reassigns a session and updates clashes reactively", () => {
    const before = detectClashes(useStore.getState().sessions.filter((s) => s.term === "1"), "lecturer").length;
    expect(before).toBeGreaterThan(0);
    const clashRow = useStore.getState().sessions.find((s) => s.unitCode === "U2" && s.term === "1")!;
    useStore.getState().transferLecturer(clashRow.rowId, "Dr Zed");
    const moved = useStore.getState().sessions.find((s) => s.rowId === clashRow.rowId)!;
    expect(moved.lecturer).toBe("Dr Zed");
    const after = detectClashes(useStore.getState().sessions.filter((s) => s.term === "1"), "lecturer").length;
    expect(after).toBeLessThan(before);
  });

  it("changeRoom moves a session immediately", () => {
    const row = useStore.getState().sessions.find((s) => s.unitCode === "U1")!;
    useStore.getState().changeRoom(row.rowId, "109");
    expect(useStore.getState().sessions.find((s) => s.rowId === row.rowId)!.room).toBe("109");
  });

  it("reschedule moves a session's day/time immediately", () => {
    const row = useStore.getState().sessions.find((s) => s.unitCode === "U2")!;
    useStore.getState().reschedule(row.rowId, "TUE", 840, 955);
    const moved = useStore.getState().sessions.find((s) => s.rowId === row.rowId)!;
    expect(moved.day).toBe("TUE");
    expect(moved.startMin).toBe(840);
  });

  it("autoResolve clears the lecturer pile-up and returns a plan", () => {
    const opts = {
      roleRegistry: useStore.getState().roleRegistry,
      roleMaxHours: useStore.getState().roleMaxHours,
      departmentRegistry: useStore.getState().departmentRegistry,
      subjectAssignments: useStore.getState().subjectAssignments,
      thresholds: { nearMaxPct: 0.85, farUnderPct: 0.4 },
      roomRegistry: useStore.getState().roomRegistry,
      capacityTolerance: 20,
    };
    const res = useStore.getState().autoResolve(opts, { lecturer: "Dr Kay", types: ["lecturer"] });
    expect(res.steps.length).toBeGreaterThan(0);
    const remaining = detectClashes(
      useStore.getState().sessions.filter((s) => s.term === "1"),
      "lecturer",
    ).filter((c) => c.groupValue === "Dr Kay");
    expect(remaining.length).toBe(0);
  });

  it("resetEdits restores the original loaded sessions", () => {
    const row = useStore.getState().sessions.find((s) => s.unitCode === "U1")!;
    useStore.getState().changeRoom(row.rowId, "109");
    useStore.getState().resetEdits();
    expect(useStore.getState().sessions.find((s) => s.unitCode === "U1")!.room).toBe("101");
  });

  it("mergeFaculty combines two lecturers and their subjects", () => {
    useStore.getState().assignSubject("Dr Zed", "ZZZ");
    useStore.getState().mergeFaculty("Dr Zed", "Dr Kay");
    const st = useStore.getState();
    expect(new Set(st.sessions.map((s) => s.lecturer)).has("Dr Zed")).toBe(false);
    expect(st.subjectAssignments["Dr Kay"]).toContain("ZZZ");
  });

  it("undo reverts the last change (room, transfer, reschedule)", () => {
    const row = useStore.getState().sessions.find((s) => s.unitCode === "U1")!;
    expect(useStore.getState().history.length).toBe(0);
    useStore.getState().changeRoom(row.rowId, "109");
    expect(useStore.getState().sessions.find((s) => s.rowId === row.rowId)!.room).toBe("109");
    expect(useStore.getState().history.length).toBe(1);
    useStore.getState().undo();
    expect(useStore.getState().sessions.find((s) => s.rowId === row.rowId)!.room).toBe("101");
    expect(useStore.getState().history.length).toBe(0);
  });

  it("undo is multi-level (LIFO) and undoes subject assignments too", () => {
    const row = useStore.getState().sessions.find((s) => s.unitCode === "U2")!;
    useStore.getState().transferLecturer(row.rowId, "Dr Zed"); // change 1
    useStore.getState().assignSubject("Dr Zed", "NEW1"); // change 2
    expect(useStore.getState().subjectAssignments["Dr Zed"]).toContain("NEW1");
    useStore.getState().undo(); // reverts change 2
    expect(useStore.getState().subjectAssignments["Dr Zed"] ?? []).not.toContain("NEW1");
    expect(useStore.getState().sessions.find((s) => s.rowId === row.rowId)!.lecturer).toBe("Dr Zed");
    useStore.getState().undo(); // reverts change 1
    expect(useStore.getState().sessions.find((s) => s.rowId === row.rowId)!.lecturer).toBe("Dr Kay");
  });

  it("undo restores the timetable after an auto-resolve", () => {
    const before = useStore.getState().sessions.map((s) => ({ id: s.rowId, room: s.room, day: s.day, lect: s.lecturer }));
    const opts = {
      roleRegistry: useStore.getState().roleRegistry,
      roleMaxHours: useStore.getState().roleMaxHours,
      departmentRegistry: useStore.getState().departmentRegistry,
      subjectAssignments: useStore.getState().subjectAssignments,
      thresholds: { nearMaxPct: 0.85, farUnderPct: 0.4 },
      roomRegistry: useStore.getState().roomRegistry,
      capacityTolerance: 20,
    };
    const res = useStore.getState().autoResolve(opts, { types: ["lecturer"] });
    expect(res.steps.length).toBeGreaterThan(0);
    useStore.getState().undo();
    const after = useStore.getState().sessions.map((s) => ({ id: s.rowId, room: s.room, day: s.day, lect: s.lecturer }));
    expect(after).toEqual(before);
  });

  it("loading a file clears the undo history", () => {
    useStore.getState().changeRoom(useStore.getState().sessions[0].rowId, "109");
    expect(useStore.getState().history.length).toBeGreaterThan(0);
    return useStore.getState().loadCsvText(CSV, "t.csv").then(() => {
      expect(useStore.getState().history.length).toBe(0);
    });
  });
});
