"use client";

import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Compact multi-select used in the config rail filters. */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  return (
    <div className="relative">
      <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1.5">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded border border-current/25 bg-black/10 px-3 py-2 text-sm text-left"
      >
        <span className="truncate text-current/90">
          {value.length ? `${value.length} selected` : "All"}
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
          <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-rule bg-surface text-content shadow-lg py-1">
            {options.length === 0 && <div className="px-3 py-2 text-xs text-muted">None</div>}
            {options.map((opt) => (
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
                <span className="truncate">{opt}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
