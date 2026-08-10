"use client";

import { useMemo } from "react";
import { useStore } from "@/store/useStore";
import { Session } from "@/lib/types";
import {
  allClashes,
  capacityAnalysis,
  consecutiveViolations,
  dataQualityIssues,
  duplicateSchedules,
  lecturerWorkload,
  summaryCounts,
} from "@/lib/analysis";
import { departmentFor } from "@/lib/departments";
import { searchSessions } from "@/lib/search";
import { mergeableGroups } from "@/lib/merge";
import { DAY_ORDER } from "@/lib/types";

/** Sessions scoped to the active term (hard isolation boundary). */
export function useTermSessions(): Session[] {
  const sessions = useStore((s) => s.sessions);
  const activeTerm = useStore((s) => s.activeTerm);
  return useMemo(
    () => sessions.filter((s) => s.term === activeTerm),
    [sessions, activeTerm],
  );
}

/** Sessions after applying the sidebar filters + search (on top of term scope). */
export function useFilteredSessions(): { termSessions: Session[]; filtered: Session[] } {
  const termSessions = useTermSessions();
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const fPrograms = useStore((s) => s.fPrograms);
  const fLecturers = useStore((s) => s.fLecturers);
  const fRooms = useStore((s) => s.fRooms);
  const fDays = useStore((s) => s.fDays);
  const fDepartments = useStore((s) => s.fDepartments);
  const search = useStore((s) => s.search);

  const filtered = useMemo(() => {
    let out = termSessions;
    if (fDepartments.length)
      out = out.filter((s) => {
        const d = departmentFor(s.programme, departmentRegistry);
        return d !== null && fDepartments.includes(d);
      });
    if (fPrograms.length) out = out.filter((s) => s.programme !== null && fPrograms.includes(s.programme));
    if (fLecturers.length) out = out.filter((s) => s.lecturer !== null && fLecturers.includes(s.lecturer));
    if (fRooms.length) out = out.filter((s) => s.room !== null && fRooms.includes(s.room));
    if (fDays.length) out = out.filter((s) => s.day !== null && fDays.includes(s.day));
    if (search.trim()) out = searchSessions(out, search, departmentRegistry);
    return out;
  }, [termSessions, fPrograms, fLecturers, fRooms, fDays, fDepartments, search, departmentRegistry]);

  return { termSessions, filtered };
}

/** How many filters (including the search box) are currently narrowing the view. */
export function useActiveFilterCount(): number {
  const fPrograms = useStore((s) => s.fPrograms);
  const fLecturers = useStore((s) => s.fLecturers);
  const fRooms = useStore((s) => s.fRooms);
  const fDays = useStore((s) => s.fDays);
  const fDepartments = useStore((s) => s.fDepartments);
  const search = useStore((s) => s.search);
  return (
    fPrograms.length + fLecturers.length + fRooms.length + fDays.length + fDepartments.length +
    (search.trim() ? 1 : 0)
  );
}

/** Groups of duplicate rows that describe ONE teaching session and can be merged. */
export function useMergeableGroups(sessions: Session[]) {
  return useMemo(() => mergeableGroups(sessions), [sessions]);
}

export function useAnalysis(sessions: Session[]) {
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const roomRegistry = useStore((s) => s.roomRegistry);
  const facultyTypeRegistry = useStore((s) => s.facultyTypeRegistry);
  const th = useStore((s) => s.thresholds);

  return useMemo(() => {
    const clashes = allClashes(sessions);
    const workload = lecturerWorkload(sessions, roleRegistry, roleMaxHours, facultyTypeRegistry);
    const capacity = capacityAnalysis(sessions, roomRegistry, th.underutilPct, th.capacityTolerance);
    const quality = dataQualityIssues(sessions);
    const consecutive = consecutiveViolations(sessions, th.maxConsecutiveHours, th.maxGapMinutes);
    const duplicates = duplicateSchedules(sessions);
    const summary = summaryCounts(sessions, clashes, workload, capacity, quality, consecutive, duplicates);
    return { clashes, workload, capacity, quality, consecutive, duplicates, summary };
  }, [sessions, roleRegistry, roleMaxHours, roomRegistry, facultyTypeRegistry, th]);
}

export function useFilterOptions() {
  const { termSessions } = useFilteredSessions();
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  return useMemo(() => {
    const programmes = [...new Set(termSessions.map((s) => s.programme).filter((x): x is string => !!x))].sort();
    const lecturers = [...new Set(termSessions.map((s) => s.lecturer).filter((x): x is string => !!x))].sort();
    const rooms = [...new Set(termSessions.map((s) => s.room).filter((x): x is string => !!x))].sort();
    const days = DAY_ORDER.filter((d) => termSessions.some((s) => s.day === d));
    const departments = [
      ...new Set(
        termSessions.map((s) => departmentFor(s.programme, departmentRegistry)).filter((x): x is string => !!x),
      ),
    ].sort();
    return { programmes, lecturers, rooms, days, departments };
  }, [termSessions, departmentRegistry]);
}
