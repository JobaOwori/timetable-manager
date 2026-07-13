"use client";

import { useMemo, useState } from "react";
import { useFilteredSessions } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { buildGrid, CellField } from "@/lib/grid";
import { departmentFor } from "@/lib/departments";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { MasterTimetable } from "@/components/pages/master-timetable";
import { AlertTriangle } from "lucide-react";

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
