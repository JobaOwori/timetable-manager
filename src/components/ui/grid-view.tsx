import { AlertTriangle } from "lucide-react";
import { Grid } from "@/lib/grid";
import { EmptyState } from "@/components/ui/card";

/**
 * Compact reusable Day x Time grid renderer (faculty / room drill-downs).
 * Each entry shows its course code and name on their own lines so a class is
 * identifiable at a glance, with the supporting detail beneath.
 */
export function GridView({ grid }: { grid: Grid }) {
  if (grid.slots.length === 0) return <EmptyState>No scheduled sessions.</EmptyState>;
  return (
    <div className="overflow-auto rounded-card border border-rule">
      <table className="w-full text-[0.7rem] border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface-2/70 border-b border-r border-rule px-2 py-1.5 text-left text-muted uppercase tracking-wide text-[0.6rem]">
              Time
            </th>
            {grid.days.map((d) => (
              <th key={d} className="border-b border-rule px-2 py-1.5 text-left text-muted uppercase tracking-wide text-[0.6rem] min-w-[140px]">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.slots.map((slot) => (
            <tr key={slot} className="border-b border-rule/50 last:border-0">
              <td className="sticky left-0 bg-surface border-r border-rule px-2 py-1 font-mono text-[0.6rem] text-muted whitespace-nowrap align-top">
                {slot}
              </td>
              {grid.days.map((d) => {
                const cell = grid.cells[slot][d];
                return (
                  <td
                    key={d}
                    className={`px-2 py-1 align-top ${cell.clash ? "bg-danger/10 ring-1 ring-inset ring-danger/40" : ""}`}
                  >
                    <div className="flex flex-col gap-1">
                      {cell.entries.map((e) => (
                        <div key={e.rowId} className="leading-tight" title={e.text}>
                          <div className="flex items-start gap-1">
                            {cell.clash && <AlertTriangle size={10} className="text-danger mt-0.5 shrink-0" />}
                            <span className="font-mono font-semibold text-ink">{e.unitCode ?? "—"}</span>
                          </div>
                          {e.unitName && <div className="text-[0.64rem] text-content">{e.unitName}</div>}
                          {e.secondary && <div className="text-[0.6rem] text-muted">{e.secondary}</div>}
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
    </div>
  );
}
