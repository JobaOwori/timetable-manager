"use client";

import { useMemo, useState } from "react";
import { Users2, Plus, X, ArrowRightLeft, BookOpen, MousePointerClick, Search } from "lucide-react";
import { useFilteredSessions, useTermSessions } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { facultyReport } from "@/lib/analysis";
import { detectDuplicateFaculty, distinctUnits } from "@/lib/faculty";
import { buildGrid } from "@/lib/grid";
import { maxHoursFor, DEFAULT_ROLE, ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, PART_TIME_ROLE, canBePartTime } from "@/lib/roles";
import {
  FACULTY_TYPE_LABEL, FACULTY_TYPE_OPTIONS, effectiveFacultyType, workloadStatus,
} from "@/lib/facultyType";
import { departmentFor } from "@/lib/departments";
import { Card, SectionTitle, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, Select } from "@/components/ui/button";
import { DataTable, Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { FacultyTypeBadge } from "@/components/ui/faculty-badge";
import { DepartmentList } from "@/components/ui/department-badge";
import { ContextMenu, MenuEntry, useContextMenu } from "@/components/ui/context-menu";
import { GridView } from "@/components/ui/grid-view";
import { LecturerTransferPanel } from "@/components/resolution-panel";
import { FacultyAnalytics } from "@/components/faculty-charts";
import { toast } from "@/store/useToast";
import { fmtHours } from "@/lib/cn";
import type { FacultyReportRow } from "@/lib/analysis";
import type { FacultyType } from "@/lib/types";

const undoToast = {
  action: { label: "Undo", onClick: () => useStore.getState().undo() },
  duration: 9000,
};

/**
 * Build the right-click menu for one lecturer: assign a staff role (Lecturer,
 * H.O.D., Dean, DAA, AR…) or switch them between Full-Time and Part-Time —
 * both of which drive their weekly workload cap and daily class limit.
 */
export function useStaffRoleMenu() {
  const setRole = useStore((s) => s.setRole);
  const setFacultyType = useStore((s) => s.setFacultyType);
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const facultyTypeRegistry = useStore((s) => s.facultyTypeRegistry);

  return (lecturer: string): MenuEntry[] => {
    const role = roleRegistry[lecturer] ?? DEFAULT_ROLE;
    const type = effectiveFacultyType(lecturer, roleRegistry, facultyTypeRegistry);
    const ptAllowed = canBePartTime(role);
    return [
      { type: "heading", label: "Employment" },
      ...FACULTY_TYPE_OPTIONS.map((t): MenuEntry => {
        const blocked = t === "PT" && !ptAllowed;
        return {
          label: FACULTY_TYPE_LABEL[t],
          hint: blocked ? `${role} is Full-Time only` : t === "PT" ? `${roleMaxHours[PART_TIME_ROLE]}h/wk` : undefined,
          checked: type === t,
          disabled: blocked,
          onSelect: () => {
            if (type === t) return;
            setFacultyType(lecturer, t as FacultyType);
            toast.success(`${lecturer} is now ${FACULTY_TYPE_LABEL[t]}.`, "Employment updated", undoToast);
          },
        };
      }),
      { type: "separator" },
      { type: "heading", label: "Staff role" },
      ...ASSIGNABLE_ROLES.map(
        (r): MenuEntry => ({
          label: r,
          hint: `${roleMaxHours[r] ?? "—"}h/wk`,
          checked: role === r,
          onSelect: () => {
            if (role === r) return;
            setRole(lecturer, r);
            toast.success(
              `${lecturer} is now ${r}${ROLE_DESCRIPTIONS[r] ? ` (${ROLE_DESCRIPTIONS[r]})` : ""}.`,
              "Role updated",
              undoToast,
            );
          },
        }),
      ),
    ];
  };
}

export function FacultyPage() {
  const { filtered } = useFilteredSessions();
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const facultyTypeRegistry = useStore((s) => s.facultyTypeRegistry);
  const [q, setQ] = useState("");
  const menuFor = useStaffRoleMenu();
  const menu = useContextMenu<string>();

  const report = useMemo(
    () => facultyReport(filtered, roleRegistry, roleMaxHours, departmentRegistry, facultyTypeRegistry),
    [filtered, roleRegistry, roleMaxHours, departmentRegistry, facultyTypeRegistry],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return report;
    return report.filter((r) =>
      [r.lecturer, r.role, r.departments, r.courses, r.status, FACULTY_TYPE_LABEL[r.facultyType]]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [report, q]);

  const columns: Column<FacultyReportRow>[] = [
    { key: "lecturer", header: "Lecturer", render: (r) => <span className="font-medium text-ink">{r.lecturer}</span> },
    { key: "role", header: "Role", render: (r) => <Badge tone="neutral" className="cursor-context-menu">{r.role}</Badge> },
    { key: "facultyType", header: "Type", render: (r) => <FacultyTypeBadge type={r.facultyType} /> },
    { key: "departments", header: "Dept", render: (r) => <DepartmentList codes={r.departments} /> },
    { key: "sessions", header: "Sessions", align: "right" },
    {
      key: "hours",
      header: "Hours / Max",
      align: "right",
      render: (r) => (
        <span className="font-mono whitespace-nowrap" title={r.statusReason}>
          {fmtHours(r.totalHours)}/{r.maxHours}
        </span>
      ),
    },
    {
      key: "remainingHours",
      header: "Left",
      align: "right",
      render: (r) => (
        <span className={`font-mono ${r.remainingHours < 0 ? "text-danger" : "text-muted"}`}>
          {fmtHours(r.remainingHours)}
        </span>
      ),
    },
    { key: "clashes", header: "Clashes", align: "right", render: (r) => (r.clashes ? <span className="text-danger font-mono">{r.clashes}</span> : <span className="text-muted">0</span>) },
    { key: "status", header: "Status", render: (r) => <span title={r.statusReason}><StatusBadge status={r.status} /></span> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Faculty Workload</h1>
        <p className="text-sm text-muted">Faculty type workload model · 🔴 Unbalanced FT · 🟢 Balanced FT · 🔵 Flexible PT</p>
      </div>

      <DuplicateBanner />
      <FacultyDrilldown />

      <Card className="p-4 overflow-hidden">
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <SectionTitle className="mb-0 border-0 pb-0">Faculty Report</SectionTitle>
          <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-muted">
            <MousePointerClick size={13} className="text-brass" />
            Right-click any lecturer to assign their role or Full-Time / Part-Time status
          </span>
          <div className="ml-auto relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search lecturer, role, dept, course…"
              className="w-64 max-w-full rounded border border-rule bg-surface pl-8 pr-2 py-1.5 text-sm text-content placeholder:text-muted outline-none focus:border-brass"
            />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={shown}
          rowKey={(r) => r.lecturer}
          empty={q ? `No lecturer matches “${q}”.` : "No lecturers."}
          dense
          onRowContextMenu={(e, r) => menu.open(e, r.lecturer)}
          rowTitle={() => "Right-click to assign a role or employment type"}
        />
      </Card>

      <ContextMenu
        position={menu.state?.position ?? null}
        onClose={menu.close}
        title={menu.state?.target}
        entries={menu.state ? menuFor(menu.state.target) : []}
      />

      <FacultyAnalytics />
    </div>
  );
}

function DuplicateBanner() {
  const sessions = useStore((s) => s.sessions);
  const dedupeFaculty = useStore((s) => s.dedupeFaculty);
  const [merged, setMerged] = useState<number | null>(null);
  const dups = useMemo(() => detectDuplicateFaculty(sessions), [sessions]);

  if (dups.length === 0) {
    return merged !== null ? (
      <Card className="p-3 border-good/40 bg-good/10 text-sm text-content flex items-center gap-2">
        <Users2 size={15} className="text-good" /> Merged {merged} duplicate faculty spelling(s). Records are now clean.
      </Card>
    ) : null;
  }

  return (
    <Card className="p-4 border-warn/40 bg-warn/10 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-content">
          <Users2 size={16} className="text-warn shrink-0" />
          <span>
            <span className="font-medium">{dups.length}</span> possible duplicate faculty record
            {dups.length > 1 ? "s" : ""} detected (same person, different spellings).
          </span>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const n = dedupeFaculty();
            setMerged(n);
            toast.success(`Merged ${n} duplicate faculty record${n === 1 ? "" : "s"}.`, "Faculty cleaned", {
              action: { label: "Undo", onClick: () => useStore.getState().undo() },
              duration: 9000,
            });
          }}
        >
          Merge all duplicates
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {dups.slice(0, 8).map((d) => (
          <Badge key={d.key} tone="warn">
            {d.variants.join(" = ")}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

function FacultyDrilldown() {
  const termSessions = useTermSessions();
  const roleRegistry = useStore((s) => s.roleRegistry);
  const roleMaxHours = useStore((s) => s.roleMaxHours);
  const setRole = useStore((s) => s.setRole);
  const departmentRegistry = useStore((s) => s.departmentRegistry);
  const facultyTypeRegistry = useStore((s) => s.facultyTypeRegistry);
  const setFacultyType = useStore((s) => s.setFacultyType);
  const menuFor = useStaffRoleMenu();
  const menu = useContextMenu<string>();
  const lecturers = useMemo(
    () => [...new Set(termSessions.map((s) => s.lecturer).filter((x): x is string => !!x))].sort(),
    [termSessions],
  );
  const [pick, setPick] = useState("");
  const chosen = pick && lecturers.includes(pick) ? pick : lecturers[0] ?? "";
  const mine = useMemo(() => termSessions.filter((s) => s.lecturer === chosen), [termSessions, chosen]);

  const role = roleRegistry[chosen] ?? DEFAULT_ROLE;
  const facultyType = effectiveFacultyType(chosen, roleRegistry, facultyTypeRegistry);
  const ptAllowed = canBePartTime(role);
  const maxH = maxHoursFor(role, facultyType, roleMaxHours);
  const totalH = mine.reduce((a, s) => a + (s.workloadHours ?? 0), 0);
  const { status, reason } = workloadStatus(totalH, maxH, facultyType);
  const pct = maxH > 0 ? Math.min(100, (totalH / maxH) * 100) : 0;
  const barColor = status === "Unbalanced" ? "danger" : status === "Balanced" ? "good" : "info";
  const depts = [...new Set(mine.map((s) => departmentFor(s.programme, departmentRegistry)).filter((x): x is string => !!x))];
  const grid = useMemo(() => buildGrid(mine, ["unitCode", "unitName", "room", "programme", "cohort"]), [mine]);

  if (!lecturers.length) return <EmptyState>No lecturers in this term.</EmptyState>;

  return (
    <Card className="p-4 space-y-4 overflow-hidden" onContextMenu={(e) => chosen && menu.open(e, chosen)}>
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[0.68rem] uppercase tracking-wide text-muted mb-1">Inspect lecturer</label>
          <Select value={chosen} onChange={setPick} options={lecturers.map((l) => ({ value: l, label: l }))} className="w-full" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge tone="neutral">{role}</Badge>
          <FacultyTypeBadge type={facultyType} />
          <Badge tone="neutral">{mine.length} sessions</Badge>
          <StatusBadge status={status} />
        </div>
      </div>

      {/* Role + employment — assignable here or by right-clicking anywhere in this card */}
      <div className="rounded-card border border-rule bg-surface-2/20 px-3 py-2.5 space-y-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[0.68rem] uppercase tracking-wide text-muted">Staff role</div>
            <div className="text-sm text-content truncate">
              {ROLE_DESCRIPTIONS[role] ?? "Drives the weekly teaching cap"} · {maxH}h/week
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {ASSIGNABLE_ROLES.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={role === r ? "primary" : "outline"}
                title={ROLE_DESCRIPTIONS[r]}
                onClick={() => {
                  setRole(chosen, r);
                  toast.success(`${chosen} is now ${r}.`, "Role updated", undoToast);
                }}
                disabled={role === r}
              >
                {r}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap border-t border-rule/60 pt-2.5">
          <div className="min-w-0">
            <div className="text-[0.68rem] uppercase tracking-wide text-muted">Employment</div>
            <div className="text-sm text-content truncate">
              {ptAllowed
                ? "Controls workload status and the daily class limit"
                : `${role} is a full-time appointment — only Lecturers may be Part-Time`}
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {FACULTY_TYPE_OPTIONS.map((type) => {
              const blocked = type === "PT" && !ptAllowed;
              return (
                <Button
                  key={type}
                  size="sm"
                  variant={facultyType === type ? "primary" : "outline"}
                  onClick={() => setFacultyType(chosen, type)}
                  disabled={facultyType === type || blocked}
                  title={blocked ? `${role} must always be Full-Time` : undefined}
                >
                  {FACULTY_TYPE_LABEL[type]}
                </Button>
              );
            })}
          </div>
        </div>
        <p className="text-[0.68rem] text-muted flex items-center gap-1.5">
          <MousePointerClick size={12} className="text-brass" />
          Tip: right-click anywhere in this card (or on any row of the Faculty Report) for the same menu.
        </p>
      </div>

      {/* Workload card — fully self-contained, never overflows */}
      <div className="rounded-card border border-rule bg-surface-2/30 p-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-2xl font-semibold text-ink">{fmtHours(totalH)}</span>
            <span className="text-muted text-sm">/ {maxH}h weekly</span>
          </div>
          <div className="text-xs text-muted font-mono whitespace-nowrap">
            {totalH > maxH ? (
              <span className="text-danger">{fmtHours(totalH - maxH)}h over limit</span>
            ) : (
              <span>{fmtHours(maxH - totalH)}h remaining</span>
            )}
          </div>
        </div>
        <div className="mt-2 h-2.5 rounded-full bg-surface-2/70 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: `rgb(var(--${barColor}))` }}
          />
        </div>
        {reason && <p className="text-xs text-muted mt-1.5">{reason}</p>}
        {depts.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-xs text-muted">Department(s):</span>
            <DepartmentList codes={depts} />
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-4 min-w-0">
        <div className="min-w-0">
          <SectionTitle>Weekly timetable</SectionTitle>
          <GridView grid={grid} />
        </div>
        <div className="min-w-0 space-y-4">
          <SubjectAssignments lecturer={chosen} sessions={mine} />
        </div>
      </div>

      <TransferHours lecturer={chosen} sessions={mine} />

      <ContextMenu
        position={menu.state?.position ?? null}
        onClose={menu.close}
        title={menu.state?.target}
        entries={menu.state ? menuFor(menu.state.target) : []}
      />
    </Card>
  );
}

function SubjectAssignments({ lecturer, sessions }: { lecturer: string; sessions: { unitCode: string | null; unitName: string | null }[] }) {
  const allSessions = useStore((s) => s.sessions);
  const subjectAssignments = useStore((s) => s.subjectAssignments);
  const assignSubject = useStore((s) => s.assignSubject);
  const unassignSubject = useStore((s) => s.unassignSubject);
  const [add, setAdd] = useState("");

  const assigned = subjectAssignments[lecturer] ?? [];
  const units = useMemo(() => distinctUnits(allSessions), [allSessions]);
  const nameFor = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const u of units) m.set(u.code, u.name);
    return m;
  }, [units]);
  const addable = units.filter((u) => !assigned.includes(u.code));

  return (
    <div>
      <SectionTitle className="flex items-center gap-1.5">
        <BookOpen size={13} /> Assigned subjects
      </SectionTitle>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {assigned.length === 0 && <span className="text-xs text-muted">No subjects assigned yet.</span>}
        {assigned.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-full border border-rule bg-surface px-2 py-0.5 text-xs"
            title={nameFor.get(code) ?? ""}
          >
            <span className="font-mono text-ink">{code}</span>
            <button
              type="button"
              onClick={() => {
                unassignSubject(lecturer, code);
                toast.info(`Removed ${code} from ${lecturer}.`, undefined, {
                  action: { label: "Undo", onClick: () => useStore.getState().undo() },
                  duration: 9000,
                });
              }}
              className="text-muted hover:text-danger transition"
              aria-label={`Remove ${code}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Select
          value={add}
          onChange={setAdd}
          placeholder="Add a subject…"
          options={addable.map((u) => ({ value: u.code, label: u.name ? `${u.code} — ${u.name}` : u.code }))}
          className="flex-1 min-w-0 text-xs"
        />
        <Button
          size="sm"
          onClick={() => {
            if (add) {
              assignSubject(lecturer, add);
              toast.success(`Assigned ${add} to ${lecturer}.`, "Subject assigned", {
                action: { label: "Undo", onClick: () => useStore.getState().undo() },
                duration: 9000,
              });
              setAdd("");
            }
          }}
          disabled={!add}
        >
          <Plus size={13} />
        </Button>
      </div>
      <p className="text-[0.68rem] text-muted mt-1.5">
        Currently teaching{" "}
        {[...new Set(sessions.map((s) => s.unitCode).filter(Boolean))].length} unit(s) this term.
      </p>
    </div>
  );
}

function TransferHours({ lecturer, sessions }: { lecturer: string; sessions: { rowId: number; unitCode: string | null; unitName: string | null; day: string | null; timeRaw: string | null; room: string | null }[] }) {
  const liveSessions = useStore((s) => s.sessions);
  const [openRow, setOpenRow] = useState<number | null>(null);

  const courses = useMemo(() => {
    // one row per (unit) with its sessions, for compact display
    const byUnit = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const k = s.unitCode ?? `#${s.rowId}`;
      const arr = byUnit.get(k) ?? [];
      arr.push(s);
      byUnit.set(k, arr);
    }
    return [...byUnit.entries()];
  }, [sessions]);

  const active = openRow !== null ? liveSessions.find((s) => s.rowId === openRow) ?? null : null;

  if (sessions.length === 0) return null;

  return (
    <div className="rounded-card border border-rule bg-surface-2/20 p-3">
      <SectionTitle className="flex items-center gap-1.5">
        <ArrowRightLeft size={13} /> Transfer hours to another lecturer
      </SectionTitle>
      <p className="text-xs text-muted mb-2">
        Rebalance workload by moving any of {lecturer}&apos;s sessions to a colleague — the assistant
        ranks who&apos;s free and won&apos;t become overloaded.
      </p>
      <div
        className={`overflow-auto rounded border border-rule divide-y divide-rule/60 ${
          openRow !== null ? "max-h-[42rem]" : "max-h-64"
        }`}
      >
        {courses.map(([unit, list]) =>
          list.map((s) => (
            <div key={s.rowId}>
              <div className="flex items-center gap-2 px-2.5 py-2 text-xs">
                <span className="font-mono text-ink shrink-0">{unit}</span>
                <span className="text-muted truncate flex-1 min-w-0">
                  {s.day} · {s.timeRaw} · Rm {s.room ?? "—"}
                </span>
                <Button size="sm" variant={openRow === s.rowId ? "primary" : "outline"} onClick={() => setOpenRow(openRow === s.rowId ? null : s.rowId)}>
                  {openRow === s.rowId ? "Close" : "Transfer"}
                </Button>
              </div>
              {openRow === s.rowId && active && (
                <div className="px-2.5 pb-2.5 animate-fade">
                  <LecturerTransferPanel session={active} onDone={() => setOpenRow(null)} />
                </div>
              )}
            </div>
          )),
        )}
      </div>
    </div>
  );
}
