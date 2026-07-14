"use client";

import { useMemo, useState } from "react";
import { useFilteredSessions, useFilterOptions } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { buildGrid, CellField } from "@/lib/grid";
import { departmentFor } from "@/lib/departments";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { MultiSelect } from "@/components/ui/multi-select";
import { MasterTimetable } from "@/components/pages/master-timetable";
import { AlertTriangle, SlidersHorizontal, X } from "lucide-react";

type Layout = "master" | "weekly" | "daily" | "department" | "programme" | "lecturer" | "room";

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
        return filtered.filter((s) => s.programme === effectivePick);
      case "lecturer":
        return filtered.filter((s) => s.lecturer === effectivePick);
      case "room":
        return filtered.filter((s) => s.room === effectivePick);
      default:
        return filtered;
    }
  }, [filtered, layout, effectivePick, departmentRegistry]);

  const cellFields: CellField[] =
    layout === "lecturer" ? ["unitCode", "room"] : layout === "room" ? ["unitCode", "lecturer"] : ["unitCode", "room", "lecturer"];
  const grid = useMemo(() => buildGrid(subset, cellFields), [subset, cellFields]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">Timetable</h1>
          <p className="text-sm text-muted">
            {layout === "master"
              ? "Complete term timetable — real conflicts are flagged red; click one to resolve it."
              : "Visual weekly grid — parallel classes are grouped by time slot."}
          </p>
        </div>
        <div className="ml-auto flex items-end gap-2">
          <div>
            <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1">Layout</label>
            <Select
              value={layout}
              onChange={(v) => {
                setLayout(v as Layout);
                setPick("");
              }}
              options={[
                { value: "master", label: "Master (all + conflicts)" },
                { value: "weekly", label: "Weekly (all)" },
                { value: "daily", label: "By day" },
                { value: "department", label: "By department" },
                { value: "programme", label: "By programme" },
                { value: "lecturer", label: "By lecturer" },
                { value: "room", label: "By room" },
              ]}
            />
          </div>
          {layout !== "weekly" && layout !== "master" && (
            <div>
              <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1 capitalize">{layout}</label>
              <Select value={effectivePick} onChange={setPick} options={options.map((o) => ({ value: o, label: o }))} />
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
        <Card className="overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface-2/70 border-b border-r border-rule px-2 py-2 text-left text-muted uppercase tracking-wide text-[0.62rem] w-28">
                  Time
                </th>
                {grid.days.map((d) => (
                  <th key={d} className="border-b border-rule px-2 py-2 text-left text-muted uppercase tracking-wide text-[0.62rem] min-w-[150px]">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.slots.map((slot) => (
                <tr key={slot} className="border-b border-rule/50 last:border-0">
                  <td className="sticky left-0 bg-surface border-r border-rule px-2 py-1.5 font-mono text-[0.65rem] text-muted whitespace-nowrap">
                    {slot}
                  </td>
                  {grid.days.map((d) => {
                    const cell = grid.cells[slot][d];
                    if (!cell.text) return <td key={d} className="px-2 py-1.5 align-top" />;
                    return (
                      <td
                        key={d}
                        className={`px-2 py-1.5 align-top ${cell.clash ? "bg-danger/10 ring-1 ring-inset ring-danger/40" : ""}`}
                      >
                        {cell.text.split("\n").map((line, i) => (
                          <div key={i} className="text-content leading-tight py-0.5 flex items-start gap-1">
                            {cell.clash && <AlertTriangle size={11} className="text-danger mt-0.5 shrink-0" />}
                            <span>{line}</span>
                          </div>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** In-context filter bar for the timetable — Department, Programme, Lecturer, Room, Day. */
function TimetableFilters() {
  const { programmes, lecturers, rooms, days, departments } = useFilterOptions();
  const fDepartments = useStore((s) => s.fDepartments);
  const fPrograms = useStore((s) => s.fPrograms);
  const fLecturers = useStore((s) => s.fLecturers);
  const fRooms = useStore((s) => s.fRooms);
  const fDays = useStore((s) => s.fDays);
  const setFilter = useStore((s) => s.setFilter);

  const activeCount =
    fDepartments.length + fPrograms.length + fLecturers.length + fRooms.length + fDays.length;

  const clearAll = () => {
    setFilter("fDepartments", []);
    setFilter("fPrograms", []);
    setFilter("fLecturers", []);
    setFilter("fRooms", []);
    setFilter("fDays", []);
  };

  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-2 mb-2.5">
        <SlidersHorizontal size={14} className="text-brass" />
        <span className="font-serif uppercase tracking-wide text-xs font-semibold text-ink">Filters</span>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-rule px-2.5 py-0.5 text-xs text-muted hover:text-ink hover:border-brass transition"
          >
            <X size={12} /> Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <MultiSelect label="Department" options={departments} value={fDepartments} onChange={(v) => setFilter("fDepartments", v)} />
        <MultiSelect label="Programme" options={programmes} value={fPrograms} onChange={(v) => setFilter("fPrograms", v)} />
        <MultiSelect label="Lecturer" options={lecturers} value={fLecturers} onChange={(v) => setFilter("fLecturers", v)} />
        <MultiSelect label="Room" options={rooms} value={fRooms} onChange={(v) => setFilter("fRooms", v)} />
        <MultiSelect label="Day" options={days} value={fDays} onChange={(v) => setFilter("fDays", v)} />
      </div>
    </Card>
  );
}
