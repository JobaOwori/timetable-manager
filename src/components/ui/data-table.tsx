import { cn } from "@/lib/cn";

/** Lightweight, styled data table. Columns describe header + cell renderer. */
export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "No rows.",
  rowClassName,
  dense,
  onRowContextMenu,
  rowTitle,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string | number;
  empty?: string;
  rowClassName?: (row: T) => string;
  dense?: boolean;
  /** Right-click handler — enables an in-place actions menu for the row. */
  onRowContextMenu?: (e: React.MouseEvent, row: T) => void;
  rowTitle?: (row: T) => string;
}) {
  if (!rows.length) {
    return <div className="px-3 py-6 text-center text-muted text-sm">{empty}</div>;
  }
  return (
    <div className="overflow-auto rounded-card border border-rule">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-surface-2/60">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "text-left font-semibold text-muted uppercase tracking-wide text-[0.68rem] px-3 py-2 border-b border-rule whitespace-nowrap",
                  c.align === "right" && "text-right",
                  c.align === "center" && "text-center",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onContextMenu={onRowContextMenu ? (e) => onRowContextMenu(e, row) : undefined}
              title={rowTitle?.(row)}
              className={cn(
                "border-b border-rule/60 last:border-0 hover:bg-surface-2/40 transition-colors",
                onRowContextMenu && "cursor-context-menu",
                rowClassName?.(row),
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-3 text-content align-middle",
                    dense ? "py-1.5" : "py-2",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.className,
                  )}
                >
                  {c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as React.ReactNode) ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
