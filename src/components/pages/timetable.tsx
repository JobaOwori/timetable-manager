"use client";

import { useMemo, useState } from "react";
import { useFilteredSessions, useFilterOptions } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { buildGrid, CellField } from "@/lib/grid";
import { sessionsForCohort } from "@/lib/classDetails";
import { Session } from "@/lib/types";
import { departmentFor, DEPARTMENT_LABELS } from "@/lib/departments";
import { hueStyle } from "@/lib/colors";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { MultiSelect } from "@/components/ui/multi-select";
import { MasterTimetable } from "@/components/pages/master-timetable";
import { AlertTriangle, Search, SlidersHorizontal, Users, X } from "lucide-react";

type Layout = "master" | "weekly" | "daily" | "department" | "programme" | "cohort" | "lecturer" | "room";

export function TimetablePage() {
  const { filtered } = useFilteredSessions();
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const [layout, setLayout] = useState<Layout>("master");
  const [pick, setPick] = useState("");

  const options = useMemo(() => {
    const get = (fn: (s: (typeof filtered)[number]) => string | null) =>
      [...new Set(filtered.map(fn).filter((x): x is string => !!x))].sort();
    switch (layout) {
      case "daily":
        return get((s) => s.day);
      case "department":
        return get((s) => departmentFor(s.programme, departmentRegistry));
      case "programme":
        return get((s) => s.programme);
      case "cohort":
        // Include cohorts whose own row was merged into another session.
        return [
          ...new Set([
            ...filtered.map((s) => s.batchCode).filter((x): x is string => !!x),
            ...filtered.flatMap((s) => s.merged?.batchCodes ?? []),
          ]),
        ].sort();
      case "lecturer":
        return get((s) => s.lecturer);
      case "room":
        return get((s) => (s.isVirtualRoom ? null : s.room));
      default:
        return [];
    }
  }, [filtered, layout, departmentRegistry]);

  const effectivePick = pick && options.includes(pick) ? pick : options[0] ?? "";

  const subset = useMemo(() => {
    switch (layout) {
      case "daily":
        return filtered.filter((s) => s.day === effectivePick);
      case "department":
        return filtered.filter((s) => departmentFor(s.programme, departmentRegistry) === effectivePick);
      case "programme":
        return filtered.filter(
          (s) => s.programme === effectivePick || (s.merged?.programmes.includes(effectivePick) ?? false),
        );
      case "cohort":
        return sessionsForCohort(filtered, effectivePick);
      case "lecturer":
        return filtered.filter((s) => s.lecturer === effectivePick);
      case "room":
        return filtered.filter((s) => s.room === effectivePick);
      default:
        return filtered;
    }
  }, [filtered, layout, effectivePick, departmentRegistry]);

  const cellFields: CellField[] =
    layout === "lecturer"
      ? ["unitCode", "unitName", "room", "programme"]
      : layout === "room"
        ? ["unitCode", "unitName", "lecturer", "programme"]
        : layout === "cohort"
          ? ["unitCode", "unitName", "lecturer", "room"]
          : ["unitCode", "unitName", "room", "lecturer", "programme"];
  const grid = useMemo(() => buildGrid(subset, cellFields), [subset, cellFields]);

  const layoutLabel: Record<Layout, string> = {
    master: "Complete term timetable — every class with its course, lecturer, room and cohorts. Click one for full details.",
    weekly: "Visual weekly grid — parallel classes are grouped by time slot.",
    daily: "One day at a time.",
    department: "Every class run by a faculty.",
    programme: "Every class a programme attends.",
    cohort: "The complete schedule for one cohort/class — what these students attend, week by week.",
    lecturer: "One lecturer's teaching week.",
    room: "Everything scheduled in one room.",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">Timetable</h1>
          <p className="text-sm text-muted max-w-2xl">{layoutLabel[layout]}</p>
        </div>
        <div className="ml-auto flex items-end gap-2">
          <div>
            <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1">Layout</label>
            <Select
              ariaLabel="Layout"
              value={layout}
              onChange={(v) => {
                setLayout(v as Layout);
                setPick("");
              }}
              options={[
                { value: "master", label: "Master (all + conflicts)" },
                { value: "weekly", label: "Weekly (all)" },
                { value: "daily", label: "By day" },
                { value: "department", label: "By faculty" },
                { value: "programme", label: "By programme" },
                { value: "cohort", label: "By cohort / class" },
                { value: "lecturer", label: "By lecturer" },
                { value: "room", label: "By room" },
              ]}
            />
          </div>
          {layout !== "weekly" && layout !== "master" && (
            <div>
              <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1 capitalize">
                {layout === "department" ? "faculty" : layout}
              </label>
              <Select
                ariaLabel={layout === "department" ? "Faculty" : layout === "cohort" ? "Cohort" : layout}
                value={effectivePick}
                onChange={setPick}
                options={options.map((o) => ({ value: o, label: o }))}
              />
            </div>
          )}
        </div>
      </div>

      <TimetableFilters />

      {layout === "master" ? (
        <MasterTimetable />
      ) : grid.slots.length === 0 ? (
        <EmptyState>No scheduled sessions match this view.</EmptyState>
      ) : (
        <>
          {layout === "cohort" && effectivePick && (
            <CohortSummary cohort={effectivePick} sessions={subset} />
          )}
          <Card className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-surface-2/70 border-b border-r border-rule px-2 py-2 text-left text-muted uppercase tracking-wide text-[0.62rem] w-28">
                    Time
                  </th>
                  {grid.days.map((d) => (
                    <th key={d} className="border-b border-rule px-2 py-2 text-left text-muted uppercase tracking-wide text-[0.62rem] min-w-[180px]">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.slots.map((slot) => (
                  <tr key={slot} className="border-b border-rule/50 last:border-0">
                    <td className="sticky left-0 bg-surface border-r border-rule px-2 py-1.5 font-mono text-[0.65rem] text-muted whitespace-nowrap align-top">
                      {slot}
                    </td>
                    {grid.days.map((d) => {
                      const cell = grid.cells[slot][d];
                      if (!cell.entries.length) return <td key={d} className="px-2 py-1.5 align-top" />;
                      return (
                        <td
                          key={d}
                          className={`px-2 py-1.5 align-top ${cell.clash ? "bg-danger/10 ring-1 ring-inset ring-danger/40" : ""}`}
                        >
                          <div className="flex flex-col gap-1.5">
                            {cell.entries.map((e) => (
                              <div
                                key={e.rowId}
                                style={hueStyle(departmentFor(e.programme, departmentRegistry))}
                                className="stripe-color pl-1.5 leading-tight"
                              >
                                <div className="flex items-start gap-1">
                                  {cell.clash && <AlertTriangle size={10} className="text-danger mt-0.5 shrink-0" />}
                                  <span className="font-mono font-semibold text-ink">{e.unitCode ?? "—"}</span>
                                </div>
                                <div className="text-[0.66rem] text-content">{e.unitName ?? "Untitled unit"}</div>
                                <div className="text-[0.62rem] text-muted">{e.secondary}</div>
                              </div>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

/** Headline facts about a cohort's week, above their grid. */
function CohortSummary({ cohort, sessions }: { cohort: string; sessions: Session[] }) {
  const programmes = [...new Set(sessions.map((s) => s.programme).filter((x): x is string => !!x))].sort();
  const units = [...new Set(sessions.map((s) => s.unitCode).filter((x): x is string => !!x))];
  const lecturers = [...new Set(sessions.map((s) => s.lecturer).filter((x): x is string => !!x))];
  const hours = sessions.reduce((a, s) => a + (s.workloadHours ?? 0), 0);
  const headCount = Math.max(0, ...sessions.map((s) => s.headCount ?? 0));

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Users size={15} className="text-brass" />
        <span className="font-serif text-sm font-semibold text-ink">Cohort {cohort}</span>
        {programmes.map((p) => (
          <span
            key={p}
            style={hueStyle(p)}
            className="chip-color inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
          >
            {p}
          </span>
        ))}
        <span className="ml-auto text-xs text-muted font-mono">
          {sessions.length} classes · {units.length} units · {lecturers.length} lecturers ·{" "}
          {Number.isInteger(hours) ? hours : hours.toFixed(1)}h/week
          {headCount > 0 ? ` · ${headCount} students` : ""}
        </span>
      </div>
    </Card>
  );
}

/** In-context filter bar for the timetable — search, Department, Programme, Lecturer, Room, Day. */
function TimetableFilters() {
  const { programmes, lecturers, rooms, days, departments } = useFilterOptions();
  const fDepartments = useStore((s) => s.fDepartments);
  const fPrograms = useStore((s) => s.fPrograms);
  const fLecturers = useStore((s) => s.fLecturers);
  const fRooms = useStore((s) => s.fRooms);
  const fDays = useStore((s) => s.fDays);
  const setFilter = useStore((s) => s.setFilter);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const clearFilters = useStore((s) => s.clearFilters);

  const activeCount =
    fDepartments.length + fPrograms.length + fLecturers.length + fRooms.length + fDays.length +
    (search.trim() ? 1 : 0);

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3.5 flex-wrap">
        <SlidersHorizontal size={14} className="text-brass" />
        <span className="font-serif uppercase tracking-wide text-xs font-semibold text-ink">Search &amp; filter</span>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-rule px-3 py-1 text-xs text-muted hover:text-ink hover:border-brass transition"
          >
            <X size={12} /> Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </button>
        )}
      </div>

      <div className="relative mb-3.5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search unit, lecturer, room, programme, cohort…  (try room:109 or -online)"
          aria-label="Search sessions"
          className="w-full rounded border border-rule bg-surface pl-9 pr-8 py-2 text-sm text-content placeholder:text-muted outline-none focus:border-brass"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3.5">
        <MultiSelect label="Department" options={departments} value={fDepartments} onChange={(v) => setFilter("fDepartments", v)} colorCoded />
        <MultiSelect label="Programme" options={programmes} value={fPrograms} onChange={(v) => setFilter("fPrograms", v)} colorCoded />
        <MultiSelect label="Lecturer" options={lecturers} value={fLecturers} onChange={(v) => setFilter("fLecturers", v)} />
        <MultiSelect label="Room" options={rooms} value={fRooms} onChange={(v) => setFilter("fRooms", v)} />
        <MultiSelect label="Day" options={days} value={fDays} onChange={(v) => setFilter("fDays", v)} />
      </div>
      <FacultyLegend departments={departments} />
    </Card>
  );
}

/** Colour key so the department hues used across the app are self-explanatory. */
function FacultyLegend({ departments }: { departments: string[] }) {
  if (departments.length === 0) return null;
  return (
    <div className="flex items-center gap-3 flex-wrap mt-3.5 pt-3 border-t border-rule/60 text-xs text-muted">
      <span className="uppercase tracking-wide text-[0.62rem]">Faculty colours</span>
      {departments.map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5">
          <span style={hueStyle(d)} className="dot-color inline-block h-2.5 w-2.5 rounded-full" />
          <span className="text-content">{d}</span>
          <span className="text-muted/80">{DEPARTMENT_LABELS[d] ?? ""}</span>
        </span>
      ))}
    </div>
  );
}
