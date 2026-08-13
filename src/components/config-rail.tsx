"use client";

import { useRef, useState } from "react";
import {
  ChevronRight, FileSpreadsheet, RotateCcw, Upload, Loader2, Undo2, Search, X,
} from "lucide-react";
import { useStore } from "@/store/useStore";
import { ROLE_OPTIONS, ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, PART_TIME_ROLE, DEFAULT_ROLE, canBePartTime } from "@/lib/roles";
import {
  FACULTY_TYPE_LABEL, FACULTY_TYPE_OPTIONS, effectiveFacultyType,
} from "@/lib/facultyType";
import { DEPARTMENT_OPTIONS, DEPARTMENT_LABELS } from "@/lib/departments";
import { minutesToLabel } from "@/lib/clean";
import { describeOfficialSlots } from "@/lib/slots";
import { chipProps } from "@/lib/colors";
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
    <div className="border-b border-rule py-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 font-serif uppercase tracking-wide text-[0.78rem] font-semibold text-brass">
          {icon}
          {title}
        </span>
        <ChevronRight size={15} className={cn("text-muted transition", open && "rotate-90")} />
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
    <aside className="ledger-rail w-[290px] shrink-0 overflow-y-auto px-4 py-4 h-full text-content">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-mono text-[0.6rem] tracking-[0.2em] uppercase text-brass">
            Registrar&apos;s Office
          </div>
          <div className="font-serif text-xl font-semibold text-ink">
            Timetable <span className="italic text-brass">Manager</span>
          </div>
        </div>
        <ThemeToggle className="text-ink" />
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
          className="w-full flex items-center gap-2 rounded border border-brass/60 bg-brass/15 px-3 py-2 text-sm text-ink hover:bg-brass/25 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload size={15} /> Upload timetable (CSV / XLSX)
        </button>
        {loading && (
          <div className="flex items-center gap-2 text-[0.72rem] text-brass animate-fade">
            <Loader2 size={13} className="animate-spin" /> Reading {fileName ?? "file"}…
          </div>
        )}
        {loadError && !loading && (
          <div className="text-[0.7rem] text-danger leading-snug">Couldn&apos;t read that file: {loadError}</div>
        )}
        {fileName && !loading && (
          <div className="flex items-center gap-1.5 text-[0.7rem] text-muted">
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
        <p className="text-[0.72rem] text-muted leading-snug">
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
                  ? "bg-brass border-brass text-white"
                  : "border-rule text-content hover:bg-ink/5",
              )}
            >
              Term {t}
            </button>
          ))}
        </div>
      </Section>

      <GlobalSearch />
      <RolesSection />
      <DepartmentsSection />
      <RoomsSection />
      <WorkloadLimitsSection />
      <ThresholdsSection />

      <div className="pt-3 space-y-2">
        <button
          type="button"
          onClick={undo}
          disabled={historyLen === 0}
          title="Undo the last change (Ctrl/Cmd+Z)"
          className="w-full flex items-center justify-center gap-1.5 rounded border border-brass/50 bg-brass/10 px-3 py-1.5 text-xs text-ink hover:bg-brass/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Undo2 size={13} /> Undo last change{historyLen > 0 ? ` (${historyLen})` : ""}
        </button>
        <button
          type="button"
          onClick={resetEdits}
          className="w-full flex items-center justify-center gap-1.5 rounded border border-rule px-3 py-1.5 text-xs text-content hover:bg-ink/5 transition"
        >
          <RotateCcw size={13} /> Reset all edits
        </button>
      </div>
    </>
  );
}

/** One search box that narrows every view — supports `field:value` qualifiers. */
function GlobalSearch() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const clearFilters = useStore((s) => s.clearFilters);
  const active =
    useStore((s) => s.fPrograms.length + s.fLecturers.length + s.fRooms.length + s.fDays.length + s.fDepartments.length) +
    (search.trim() ? 1 : 0);

  return (
    <div className="border-b border-rule py-2.5 space-y-1.5">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search everything…"
          aria-label="Search sessions"
          className="w-full rounded border border-rule bg-surface pl-8 pr-7 py-1.5 text-sm text-content placeholder:text-muted outline-none focus:border-brass"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <p className="text-[0.66rem] text-muted leading-snug">
        Unit, lecturer, room, programme, cohort, day, time or note. Use{" "}
        <span className="font-mono text-brass">room:109</span>,{" "}
        <span className="font-mono text-brass">lecturer:tax</span>,{" "}
        <span className="font-mono text-brass">&quot;research methods&quot;</span> or{" "}
        <span className="font-mono text-brass">-online</span> to exclude.
      </p>
      {active > 0 && (
        <button
          type="button"
          onClick={clearFilters}
          className="w-full flex items-center justify-center gap-1.5 rounded border border-rule px-2 py-1 text-[0.7rem] text-muted hover:text-ink transition"
        >
          <X size={11} /> Clear {active} active filter{active === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

/**
 * Assign each lecturer's staff role AND their Full-Time / Part-Time status —
 * both drive the weekly-hours cap and the daily class limit. (The Faculty page
 * offers the same via right-click.)
 */
function RolesSection() {
  const roleRegistry = useStore((s) => s.roleRegistry);
  const facultyTypeRegistry = useStore((s) => s.facultyTypeRegistry);
  const setRole = useStore((s) => s.setRole);
  const setFacultyType = useStore((s) => s.setFacultyType);
  const [q, setQ] = useState("");
  const [onlyPT, setOnlyPT] = useState(false);
  const lecturers = Object.keys(roleRegistry).sort();
  const shown = lecturers
    .filter((l) => (q ? l.toLowerCase().includes(q.toLowerCase()) : true))
    .filter((l) => (onlyPT ? effectiveFacultyType(l, roleRegistry, facultyTypeRegistry) === "PT" : true));
  return (
    <Section title="Faculty Roles">
      <p className="text-[0.72rem] text-muted leading-snug">
        Role sets the weekly-hours cap. <span className="text-ink">Only a Lecturer may be
        Part-Time</span> — DAA, AR, H.O.D., Dean, Lab Assistant and Teaching Assistant are always
        Full-Time. Part-time staff get a higher daily class limit because they are paid per session.
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search lecturer…"
        className="w-full rounded border border-rule bg-surface px-2 py-1 text-sm text-content placeholder:text-muted outline-none focus:border-brass"
      />
      <label className="flex items-center gap-1.5 text-[0.7rem] text-muted cursor-pointer">
        <input type="checkbox" checked={onlyPT} onChange={(e) => setOnlyPT(e.target.checked)} className="accent-brass" />
        Show part-time only
      </label>
      <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
        {shown.length === 0 && <div className="text-xs text-muted">No lecturer matches.</div>}
        {shown.map((l) => {
          const role = roleRegistry[l] ?? DEFAULT_ROLE;
          const type = effectiveFacultyType(l, roleRegistry, facultyTypeRegistry);
          const ptAllowed = canBePartTime(role);
          return (
            <div key={l} className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="flex-1 truncate text-[0.78rem] text-content" title={l}>{l}</span>
                <select
                  value={role}
                  onChange={(e) => setRole(l, e.target.value)}
                  title={ROLE_DESCRIPTIONS[role] ?? "Staff role"}
                  className="rounded border border-rule bg-surface px-1 py-0.5 text-[0.72rem] text-content"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-1 pl-0.5">
                {FACULTY_TYPE_OPTIONS.map((t) => {
                  const blocked = t === "PT" && !ptAllowed;
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={blocked}
                      title={blocked ? `${role} must always be Full-Time` : undefined}
                      onClick={() => setFacultyType(l, t)}
                      className={cn(
                        "rounded-full border px-1.5 py-[1px] text-[0.62rem] transition",
                        type === t
                          ? "bg-brass border-brass text-white"
                          : blocked
                            ? "border-rule/60 text-muted/40 cursor-not-allowed"
                            : "border-rule text-muted hover:text-ink",
                      )}
                    >
                      {FACULTY_TYPE_LABEL[t]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function DepartmentsSection() {
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const setDepartment = useStore((s) => s.setDepartment);
  const [q, setQ] = useState("");
  const programmes = Object.keys(departmentRegistry)
    .sort()
    .filter((p) => (q ? p.toLowerCase().includes(q.toLowerCase()) : true));
  return (
    <Section title="Department Map">
      <div className="flex flex-wrap gap-1.5">
        {DEPARTMENT_OPTIONS.map((c) => {
          const { style, className } = chipProps(c);
          return (
            <span
              key={c}
              style={style}
              title={DEPARTMENT_LABELS[c]}
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.68rem] font-medium",
                className,
              )}
            >
              {c}
            </span>
          );
        })}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search programme…"
        className="w-full rounded border border-rule bg-surface px-2 py-1 text-sm text-content placeholder:text-muted outline-none focus:border-brass"
      />
      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
        {programmes.length === 0 && <div className="text-xs text-muted">No programme matches.</div>}
        {programmes.map((p) => (
          <div key={p} className="flex items-center gap-1.5">
            <span
              style={chipProps(departmentRegistry[p]).style}
              className={cn("h-2 w-2 rounded-full shrink-0", departmentRegistry[p] ? "dot-color" : "bg-rule")}
            />
            <span className="flex-1 truncate text-[0.78rem] text-content">{p}</span>
            <select
              value={departmentRegistry[p]}
              onChange={(e) => setDepartment(p, e.target.value)}
              className="rounded border border-rule bg-surface px-1 py-0.5 text-[0.72rem] text-content"
            >
              <option value="">—</option>
              {DEPARTMENT_OPTIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
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
  const [q, setQ] = useState("");
  const rooms = Object.keys(roomRegistry)
    .sort()
    .filter((r) => (q ? r.toLowerCase().includes(q.toLowerCase()) : true));
  const total = Object.keys(roomRegistry).length;
  return (
    <Section title="Room Capacities">
      <p className="text-[0.72rem] text-muted">Verified capacities override the sheet value.</p>
      {total > 0 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search room…"
          className="w-full rounded border border-rule bg-surface px-2 py-1 text-sm text-content placeholder:text-muted outline-none focus:border-brass"
        />
      )}
      <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
        {rooms.map((r) => (
          <div key={r} className="flex items-center gap-2">
            <span className="flex-1 truncate text-[0.78rem] text-content">{r}</span>
            <input
              type="number"
              value={roomRegistry[r]}
              onChange={(e) =>
                setRoomRegistry({ ...roomRegistry, [r]: Number(e.target.value) })
              }
              className="w-16 rounded border border-rule bg-surface px-1 py-0.5 text-[0.72rem] text-right text-content"
            />
          </div>
        ))}
        {total === 0 && <div className="text-xs text-muted">No room sheet detected.</div>}
        {total > 0 && rooms.length === 0 && <div className="text-xs text-muted">No room matches.</div>}
      </div>
    </Section>
  );
}

/**
 * Weekly teaching-hour caps per staff role — Lecturer, H.O.D., Dean, DAA, AR,
 * Lab Assistant and Part-Time Lecturer. Every limit is adjustable and persists
 * across reloads.
 */
function WorkloadLimitsSection() {
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const setRoleMaxHoursFor = useStore((s) => s.setRoleMaxHoursFor);
  const resetRoleMaxHours = useStore((s) => s.resetRoleMaxHours);
  return (
    <Section title="Workload Limits by Role">
      <p className="text-[0.72rem] text-muted leading-snug">
        Maximum teaching hours per week. Part-time staff are capped by the{" "}
        <span className="text-ink">Part-Time Lecturer</span> limit regardless of their role.
      </p>
      <div className="space-y-2">
        {ROLE_OPTIONS.map((role) => (
          <div key={role}>
            <div className="flex justify-between items-center gap-2 text-[0.72rem] text-content">
              <span className="truncate" title={ROLE_DESCRIPTIONS[role] ?? role}>{role}</span>
              <div className="flex items-center gap-1 shrink-0">
                <input
                  type="number"
                  min={0}
                  max={40}
                  step={1}
                  value={roleMaxHours[role] ?? 0}
                  onChange={(e) => setRoleMaxHoursFor(role, Number(e.target.value))}
                  className="w-12 rounded border border-rule bg-surface px-1 py-0.5 text-[0.72rem] text-right text-content"
                />
                <span className="font-mono text-muted text-[0.66rem]">h/wk</span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={roleMaxHours[role] ?? 0}
              onChange={(e) => setRoleMaxHoursFor(role, Number(e.target.value))}
              aria-label={`${role} weekly hours limit`}
              className="w-full accent-brass"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={resetRoleMaxHours}
        className="w-full flex items-center justify-center gap-1.5 rounded border border-rule px-2 py-1 text-[0.7rem] text-muted hover:text-ink transition"
      >
        <RotateCcw size={11} /> Restore default limits
      </button>
    </Section>
  );
}

function ThresholdsSection() {
  const th = useStore((s) => s.thresholds);
  const setThreshold = useStore((s) => s.setThreshold);
  const resetThresholds = useStore((s) => s.resetThresholds);
  const Row = ({
    label,
    k,
    min,
    max,
    step = 1,
    format,
    hint,
  }: {
    label: string;
    k: keyof typeof th;
    min: number;
    max: number;
    step?: number;
    format?: (v: number) => string;
    hint?: string;
  }) => (
    <div>
      <div className="flex justify-between text-[0.72rem] text-content">
        <span title={hint}>{label}</span>
        <span className="font-mono text-muted">{format ? format(th[k]) : th[k]}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={th[k]}
        onChange={(e) => setThreshold(k, Number(e.target.value))}
        aria-label={label}
        className="w-full accent-brass"
      />
    </div>
  );
  return (
    <Section title="Thresholds">
      <Row label="Close-to-max %" k="nearMaxPct" min={0.5} max={1} step={0.05} />
      <Row label="Far-under %" k="farUnderPct" min={0} max={1} step={0.05} />
      <Row label="Underutilized %" k="underutilPct" min={0} max={1} step={0.05} />
      <Row label="Capacity tolerance" k="capacityTolerance" min={0} max={100} step={1} />
      <Row
        label="Long-run warning (hrs)"
        k="maxConsecutiveHours"
        min={2}
        max={12}
        step={0.5}
        hint="Advisory only — teaching every period back to back is allowed."
      />
      <Row label="Max gap between classes (min)" k="maxGapMinutes" min={0} max={120} step={5} />

      <div className="pt-1 border-t border-rule/60">
        <div className="text-[0.66rem] uppercase tracking-wide text-brass mb-1.5">Daily class limits</div>
        <Row
          label="Max classes — weekday"
          k="maxSessionsPerWeekday"
          min={1}
          max={4}
          step={1}
          hint="Per lecturer. A combined class counts once."
        />
        <Row
          label="Max classes — Saturday"
          k="maxSessionsPerSaturday"
          min={1}
          max={3}
          step={1}
          hint="Saturday has three teaching periods."
        />
        <p className="text-[0.66rem] text-muted leading-snug mt-0.5">
          A lecturer may fill every period of the day, back to back. The weekly hour cap per role
          still applies and is never relaxed.
        </p>
      </div>

      <div className="pt-1 border-t border-rule/60">
        <div className="text-[0.66rem] uppercase tracking-wide text-brass mb-1.5">Official teaching periods</div>
        <p className="text-[0.66rem] text-muted leading-snug">
          <span className="text-ink">Mon–Fri</span> {describeOfficialSlots("MON")}
          <br />
          <span className="text-ink">Saturday</span> {describeOfficialSlots("SAT")}
          <br />
          Nothing is scheduled over lunch. Classes on any other time are listed under Scheduling
          policy breaches on Resolve, and rescheduling only ever offers these periods.
        </p>
      </div>

      <button
        type="button"
        onClick={resetThresholds}
        className="w-full flex items-center justify-center gap-1.5 rounded border border-rule px-2 py-1 text-[0.7rem] text-muted hover:text-ink transition"
      >
        <RotateCcw size={11} /> Restore default thresholds
      </button>
    </Section>
  );
}
