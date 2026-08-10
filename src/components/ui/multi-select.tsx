"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { hueStyle } from "@/lib/colors";
import { cn } from "@/lib/cn";

/** Compact, searchable multi-select used in the timetable filter bar. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  colorCoded,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  /** Show each option's faculty/programme colour dot. */
  colorCoded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options;
  }, [options, q]);

  const summary =
    value.length === 0 ? "All" : value.length === 1 ? value[0] : `${value.length} selected`;

  return (
    <div className="relative">
      <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1.5">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded border border-current/25 bg-black/10 px-3 py-2 text-sm text-left"
      >
        <span className="truncate text-current/90 flex items-center gap-1.5 min-w-0">
          {colorCoded && value.length === 1 && (
            <span style={hueStyle(value[0])} className="dot-color inline-block h-2 w-2 rounded-full shrink-0" />
          )}
          <span className="truncate">{summary}</span>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {value.length > 0 && (
            <X
              size={13}
              className="opacity-70 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          )}
          <ChevronDown size={14} className={cn("transition", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full rounded border border-rule bg-surface text-content shadow-lg">
            {options.length > 7 && (
              <div className="relative border-b border-rule/70 p-1.5">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="w-full rounded border border-rule bg-surface pl-7 pr-2 py-1 text-xs text-content placeholder:text-muted outline-none focus:border-brass"
                />
              </div>
            )}
            <div className="max-h-60 overflow-auto py-1">
              {shown.length === 0 && <div className="px-3 py-2 text-xs text-muted">No match</div>}
              {shown.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-2/60 text-left"
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded-sm border shrink-0",
                      value.includes(opt) ? "bg-brass border-brass text-white" : "border-rule",
                    )}
                  >
                    {value.includes(opt) && <Check size={11} />}
                  </span>
                  {colorCoded && (
                    <span style={hueStyle(opt)} className="dot-color inline-block h-2 w-2 rounded-full shrink-0" />
                  )}
                  <span className="truncate">{opt}</span>
                </button>
              ))}
            </div>
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full border-t border-rule/70 px-3 py-1.5 text-xs text-muted hover:text-ink transition"
              >
                Clear selection
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
