"use client";

import { useRef, useState } from "react";
import {
  ChevronRight, FileSpreadsheet, RotateCcw, Upload, Loader2, Undo2,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { ROLE_OPTIONS } from "@/lib/roles";
import { DEPARTMENT_OPTIONS, DEPARTMENT_LABELS } from "@/lib/departments";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";

function Section({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-current/15 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 font-serif uppercase tracking-wide text-[0.78rem] font-semibold text-[rgb(217,198,144)]">
          {icon}
          {title}
        </span>
        <ChevronRight size={15} className={cn("opacity-70 transition", open && "rotate-90")} />
      </button>
      {open && <div className="mt-2.5 space-y-2.5 animate-fade">{children}</div>}
    </div>
  );
}

export function ConfigRail() {
  const loaded = useStore((s) => s.loaded);
  const loading = useStore((s) => s.loading);
  const loadError = useStore((s) => s.loadError);
  const fileName = useStore((s) => s.fileName);
  const loadArrayBuffer = useStore((s) => s.loadArrayBuffer);
  const loadCsvText = useStore((s) => s.loadCsvText);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File) => {
    if (f.name.toLowerCase().endsWith(".csv")) {
      loadCsvText(await f.text(), f.name);
    } else {
      loadArrayBuffer(await f.arrayBuffer(), f.name);
    }
  };

  return (
    <aside className="ledger-rail w-[290px] shrink-0 overflow-y-auto px-4 py-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-mono text-[0.6rem] tracking-[0.2em] uppercase text-[rgb(201,151,47)]">
            Registrar&apos;s Office
          </div>
          <div className="font-serif text-xl font-semibold text-[rgb(233,226,205)]">
            Timetable <span className="italic text-[rgb(201,151,47)]">Manager</span>
          </div>
        </div>
        <ThemeToggle className="text-[rgb(233,226,205)]" />
      </div>

      {/* Load */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <div className="space-y-2 mb-1">
        <button
          type="button"
          disabled={loading}
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center gap-2 rounded border border-[rgb(201,151,47)]/60 bg-[rgb(201,151,47)]/15 px-3 py-2 text-sm text-[rgb(233,226,205)] hover:bg-[rgb(201,151,47)]/25 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload size={15} /> Upload timetable (CSV / XLSX)
        </button>
        {loading && (
          <div className="flex items-center gap-2 text-[0.72rem] text-[rgb(217,198,144)] animate-fade">
            <Loader2 size={13} className="animate-spin" /> Reading {fileName ?? "file"}…
          </div>
        )}
        {loadError && !loading && (
          <div className="text-[0.7rem] text-red-300 leading-snug">Couldn&apos;t read that file: {loadError}</div>
        )}
        {fileName && !loading && (
          <div className="flex items-center gap-1.5 text-[0.7rem] text-[rgb(168,155,120)]">
            <FileSpreadsheet size={12} /> {fileName}
          </div>
        )}
      </div>

      {loaded && <RailBody />}
    </aside>
  );
}

function RailBody() {
  const terms = useStore((s) => s.terms);
  const activeTerm = useStore((s) => s.activeTerm);
  const setActiveTerm = useStore((s) => s.setActiveTerm);
  const resetEdits = useStore((s) => s.resetEdits);
  const undo = useStore((s) => s.undo);
  const historyLen = useStore((s) => s.history.length);

  return (
    <>
      {/* Active term */}
      <Section title="Active Term" defaultOpen>
        <p className="text-[0.72rem] text-[rgb(168,155,120)] leading-snug">
          Term 1 &amp; Term 2 are fully isolated — clashes and workload never mix.
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {terms.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTerm(t)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium border transition",
                activeTerm === t
                  ? "bg-[rgb(201,151,47)] border-[rgb(201,151,47)] text-[#14182a]"
                  : "border-current/30 text-[rgb(233,226,205)] hover:bg-white/5",
              )}
            >
              Term {t}
            </button>
          ))}
        </div>
      </Section>

      <RolesSection />
      <DepartmentsSection />
      <RoomsSection />
      <ThresholdsSection />

      <div className="pt-3 space-y-2">
        <button
          type="button"
          onClick={undo}
          disabled={historyLen === 0}
          title="Undo the last change (Ctrl/Cmd+Z)"
          className="w-full flex items-center justify-center gap-1.5 rounded border border-[rgb(201,151,47)]/50 bg-[rgb(201,151,47)]/10 px-3 py-1.5 text-xs text-[rgb(233,226,205)] hover:bg-[rgb(201,151,47)]/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Undo2 size={13} /> Undo last change{historyLen > 0 ? ` (${historyLen})` : ""}
        </button>
        <button
          type="button"
          onClick={resetEdits}
          className="w-full flex items-center justify-center gap-1.5 rounded border border-current/30 px-3 py-1.5 text-xs text-[rgb(233,226,205)] hover:bg-white/5"
        >
          <RotateCcw size={13} /> Reset all edits
        </button>
      </div>
    </>
  );
}

function RolesSection() {
  const roleRegistry = useStore((s) => s.roleRegistry);
  const setRole = useStore((s) => s.setRole);
  const [q, setQ] = useState("");
  const lecturers = Object.keys(roleRegistry).sort();
  const shown = q ? lecturers.filter((l) => l.toLowerCase().includes(q.toLowerCase())) : lecturers;
  return (
    <Section title="Faculty Roles">
      <p className="text-[0.72rem] text-[rgb(168,155,120)]">Role drives each lecturer&apos;s weekly-hours cap.</p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search lecturer…"
        className="w-full rounded border border-current/25 bg-black/10 px-2 py-1 text-sm text-[rgb(233,226,205)] placeholder:text-[rgb(168,155,120)]"
      />
      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
        {shown.map((l) => (
          <div key={l} className="flex items-center gap-1.5">
            <span className="flex-1 truncate text-[0.78rem] text-[rgb(233,226,205)]" title={l}>{l}</span>
            <select
              value={roleRegistry[l]}
              onChange={(e) => setRole(l, e.target.value)}
              className="rounded border border-current/25 bg-black/20 px-1 py-0.5 text-[0.72rem] text-[rgb(233,226,205)]"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r} className="text-black">{r}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DepartmentsSection() {
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const setDepartment = useStore((s) => s.setDepartment);
  const programmes = Object.keys(departmentRegistry).sort();
  return (
    <Section title="Department Map">
      <p className="text-[0.72rem] text-[rgb(168,155,120)] leading-snug">
        {DEPARTMENT_OPTIONS.map((c) => `${c} = ${DEPARTMENT_LABELS[c]}`).join(" · ")}
      </p>
      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
        {programmes.map((p) => (
          <div key={p} className="flex items-center gap-1.5">
            <span className="flex-1 truncate text-[0.78rem] text-[rgb(233,226,205)]">{p}</span>
            <select
              value={departmentRegistry[p]}
              onChange={(e) => setDepartment(p, e.target.value)}
              className="rounded border border-current/25 bg-black/20 px-1 py-0.5 text-[0.72rem] text-[rgb(233,226,205)]"
            >
              <option value="" className="text-black">—</option>
              {DEPARTMENT_OPTIONS.map((d) => (
                <option key={d} value={d} className="text-black">{d}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </Section>
  );
}

function RoomsSection() {
  const roomRegistry = useStore((s) => s.roomRegistry);
  const setRoomRegistry = useStore((s) => s.setRoomRegistry);
  const rooms = Object.keys(roomRegistry).sort();
  return (
    <Section title="Room Capacities">
      <p className="text-[0.72rem] text-[rgb(168,155,120)]">Verified capacities override the sheet value.</p>
      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
        {rooms.map((r) => (
          <div key={r} className="flex items-center gap-2">
            <span className="flex-1 truncate text-[0.78rem] text-[rgb(233,226,205)]">{r}</span>
            <input
              type="number"
              value={roomRegistry[r]}
              onChange={(e) =>
                setRoomRegistry({ ...roomRegistry, [r]: Number(e.target.value) })
              }
              className="w-16 rounded border border-current/25 bg-black/20 px-1 py-0.5 text-[0.72rem] text-right text-[rgb(233,226,205)]"
            />
          </div>
        ))}
        {rooms.length === 0 && <div className="text-xs text-[rgb(168,155,120)]">No room sheet detected.</div>}
      </div>
    </Section>
  );
}

function ThresholdsSection() {
  const th = useStore((s) => s.thresholds);
  const setThreshold = useStore((s) => s.setThreshold);
  const Row = ({ label, k, min, max, step = 1 }: { label: string; k: keyof typeof th; min: number; max: number; step?: number }) => (
    <div>
      <div className="flex justify-between text-[0.72rem] text-[rgb(233,226,205)]">
        <span>{label}</span>
        <span className="font-mono">{th[k]}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={th[k]}
        onChange={(e) => setThreshold(k, Number(e.target.value))}
        className="w-full accent-[rgb(201,151,47)]"
      />
    </div>
  );
  return (
    <Section title="Thresholds">
      <Row label="Close-to-max %" k="nearMaxPct" min={0.5} max={1} step={0.05} />
      <Row label="Far-under %" k="farUnderPct" min={0} max={1} step={0.05} />
      <Row label="Underutilized %" k="underutilPct" min={0} max={1} step={0.05} />
      <Row label="Capacity tolerance" k="capacityTolerance" min={0} max={100} step={1} />
      <Row label="Max consecutive hrs" k="maxConsecutiveHours" min={2} max={12} step={0.5} />
    </Section>
  );
}
