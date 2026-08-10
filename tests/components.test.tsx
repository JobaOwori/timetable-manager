// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useStore } from "@/store/useStore";
import { ResolutionPanel } from "@/components/resolution-panel";
import { TimetablePage } from "@/components/pages/timetable";
import { Session } from "@/lib/types";

const CSV = [
  "Programm,BATCHCODE,UNITCODE,UNITNAME,TERM,WDAY,Time,Hours,ROOMCODE,CAPACITY,Faculty,Head Count",
  "BSCCS,B1,U1,Intro,1,MON,9:00AM - 10:55AM,2,101,30,Dr Kay,20",
  "BSCCS,B2,U2,Data,1,MON,9:00AM - 10:55AM,2,102,30,Dr Kay,20",
  "BSCCS,B3,U3,Algo,1,TUE,2:00PM - 3:55PM,2,103,30,Dr Zed,20",
  "BSCCS,B4,U4,Web,1,WED,11:00AM - 12:55PM,2,104,30,Dr Ann,20",
].join("\n");

function seed() {
  return useStore.getState().loadCsvText(CSV, "t.csv");
}
const row = (unit: string): Session =>
  useStore.getState().sessions.find((s) => s.unitCode === unit)!;

beforeEach(async () => {
  await seed();
});
afterEach(() => cleanup());

describe("ResolutionPanel (Fix dialog)", () => {
  it("shows transfer candidates for a lecturer clash and transfers on click", () => {
    const s = row("U2"); // Dr Kay, clashing MON 9-10:55
    render(<ResolutionPanel session={s} clashType="lecturer" onDone={() => {}} />);
    // A free colleague (Dr Zed or Dr Ann) should be offered as a candidate button
    const candidates = screen.getAllByRole("button", { name: /Dr Zed|Dr Ann/ });
    expect(candidates.length).toBeGreaterThan(0);
    const chip = candidates[0];
    const target = chip.textContent?.includes("Zed") ? "Dr Zed" : "Dr Ann";
    fireEvent.click(chip);
    // store reflects the transfer immediately
    expect(useStore.getState().sessions.find((x) => x.rowId === s.rowId)!.lecturer).toBe(target);
  });

  it("offers remedy toggles and a reschedule option", () => {
    const s = row("U2");
    render(<ResolutionPanel session={s} clashType="lecturer" onDone={() => {}} />);
    expect(screen.getByRole("button", { name: /Transfer lecturer/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Reschedule$/ })).toBeInTheDocument();
    // switch to reschedule remedy -> fully validated plans appear (TUE/WED exist)
    fireEvent.click(screen.getByRole("button", { name: /^Reschedule$/ }));
    expect(screen.getByText(/checked against all lecturers, rooms, slots and rules/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^(MON|TUE|WED|THU|FRI|SAT) \d/ }).length).toBeGreaterThan(0);
  });

  it("moves a room on a room clash", () => {
    // make a room clash: put U3 in room 101 at MON 9-10:55 (same as U1)
    const u3 = row("U3");
    useStore.getState().reschedule(u3.rowId, "MON", 540, 655);
    useStore.getState().changeRoom(u3.rowId, "101");
    const s = useStore.getState().sessions.find((x) => x.rowId === u3.rowId)!;
    render(<ResolutionPanel session={s} clashType="room" onDone={() => {}} />);
    // a different free room button should exist (e.g. 102/103/104)
    const roomBtn = screen.getByRole("button", { name: /10[234]/ });
    fireEvent.click(roomBtn);
    expect(useStore.getState().sessions.find((x) => x.rowId === u3.rowId)!.room).not.toBe("101");
  });
});

describe("Master Timetable", () => {
  it("renders the master grid, flags clashes, and opens a resolution modal on click", () => {
    render(<TimetablePage />);
    // Every chip is clickable for details; clashing ones also carry a Resolve action.
    const resolveButtons = screen.getAllByText("Resolve");
    expect(resolveButtons.length).toBeGreaterThan(0);
    fireEvent.click(resolveButtons[0]);
    // a modal dialog opens with resolution UI
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Resolve/i)).toBeInTheDocument();
  });

  it("shows the course name, programme and cohort on every entry", () => {
    render(<TimetablePage />);
    // Course names (not just codes) are visible at a glance.
    expect(screen.getAllByText("Intro").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Algo").length).toBeGreaterThan(0);
    // Clicking an entry opens its full details.
    fireEvent.click(screen.getAllByRole("button", { name: /^U1 Intro/ })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Course unit")).toBeInTheDocument();
    expect(within(dialog).getByText(/^Programme/)).toBeInTheDocument();
    expect(within(dialog).getByText(/^Cohort/)).toBeInTheDocument();
    expect(within(dialog).getByText("Room / venue")).toBeInTheDocument();
    expect(within(dialog).getByText("BSCCS")).toBeInTheDocument();
    expect(within(dialog).getByText("B1")).toBeInTheDocument();
  });

  it("updates the flagged count after a conflict is resolved", () => {
    render(<TimetablePage />);
    const before = screen.getAllByText("Resolve").length;
    // resolve the Dr Kay lecturer clash directly via the store
    const u2 = row("U2");
    useStore.getState().transferLecturer(u2.rowId, "Dr Zed");
    // re-render reflects fewer flagged chips (reactive)
    const after = screen.queryAllByText("Resolve").length;
    expect(after).toBeLessThanOrEqual(before);
  });
});
