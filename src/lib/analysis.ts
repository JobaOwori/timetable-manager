// Analysis engine: clashes, workload, capacity, quality, reports. Ports src/analysis.py.
// Term isolation: clash detection is always scoped within a single term.
import {
  CapacityRow,
  Clash,
  ClashType,
  ConsecutiveViolation,
  DepartmentRegistry,
  DuplicateGroup,
  QualityIssue,
  RoleMaxHours,
  RoleRegistry,
  RoomRegistry,
  Session,
  Thresholds,
  WorkloadRow,
} from "./types";
import { formatTimeRange, isBlank, minutesToLabel } from "./clean";
import { DEFAULT_ROLE, maxHoursForRole, workloadStatus } from "./roles";
import { departmentFor } from "./departments";

function groupBy<T, K extends string | number>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

const display = (v: unknown): string => (isBlank(v) ? "" : String(v));

function scheduled(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.day !== null && s.startMin !== null && s.endMin !== null);
}

export function detectClashes(sessions: Session[], groupCol: ClashType): Clash[] {
  let valid = scheduled(sessions).filter((s) => s.term !== null);
  const value = (s: Session): string | null =>
    groupCol === "room" ? s.room : groupCol === "lecturer" ? s.lecturer : s.batchCode;
  valid = valid.filter((s) => value(s) !== null);
  if (groupCol === "room") valid = valid.filter((s) => !s.isVirtualRoom);

  const buckets = groupBy(valid, (s) => `${s.term}||${s.day}||${value(s)}`);
  const pairs: Clash[] = [];
  for (const [, subs] of buckets) {
    if (subs.length < 2) continue;
    for (let i = 0; i < subs.length; i++) {
      const a = subs[i];
      for (let j = i + 1; j < subs.length; j++) {
        const b = subs[j];
        if (a.startMin! < b.endMin! && b.startMin! < a.endMin!) {
          pairs.push({
            clashType: groupCol,
            term: a.term!,
            day: a.day!,
            groupValue: value(a)!,
            rowId1: a.rowId,
            rowId2: b.rowId,
            unit1: `${display(a.unitCode)} ${display(a.unitName)}`.trim(),
            unit2: `${display(b.unitCode)} ${display(b.unitName)}`.trim(),
            time1: formatTimeRange(a.startMin, a.endMin),
            time2: formatTimeRange(b.startMin, b.endMin),
            lecturer1: a.lecturer,
            lecturer2: b.lecturer,
            room1: a.room,
            room2: b.room,
          });
        }
      }
    }
  }
  return pairs;
}

export function allClashes(sessions: Session[]): Clash[] {
  return [
    ...detectClashes(sessions, "room"),
    ...detectClashes(sessions, "lecturer"),
    ...detectClashes(sessions, "batch_code"),
  ];
}

export function clashingRowIds(clashes: Clash[]): Set<number> {
  const s = new Set<number>();
  for (const c of clashes) {
    s.add(c.rowId1);
    s.add(c.rowId2);
  }
  return s;
}

export function lecturerWorkload(
  sessions: Session[],
  roleRegistry: RoleRegistry,
  roleMaxHours: RoleMaxHours,
  th: Pick<Thresholds, "nearMaxPct" | "farUnderPct">,
): WorkloadRow[] {
  const valid = sessions.filter((s) => s.lecturer !== null);
  const buckets = groupBy(valid, (s) => `${s.lecturer}||${s.term}`);
  const rows: WorkloadRow[] = [];
  for (const [, subs] of buckets) {
    const lecturer = subs[0].lecturer!;
    const term = subs[0].term ?? "";
    const totalHours = subs.reduce((acc, s) => acc + (s.workloadHours ?? 0), 0);
    const units = [...new Set(subs.map((s) => s.unitCode).filter((u): u is string => !!u))].sort();
    const role = roleRegistry[lecturer] ?? DEFAULT_ROLE;
    const maxHours = maxHoursForRole(role, roleMaxHours);
    const { status, reason } = workloadStatus(totalHours, maxHours, th.nearMaxPct, th.farUnderPct);
    rows.push({
      lecturer,
      term,
      totalHours: round(totalHours),
      sessions: subs.length,
      units: units.join(", "),
      role,
      maxHours,
      remainingHours: round(maxHours - totalHours),
      status,
      statusReason: reason,
    });
  }
  const rank: Record<string, number> = { Overloaded: 0, "Close to Maximum": 1, Balanced: 2 };
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || b.totalHours - a.totalHours);
}

export function capacityAnalysis(
  sessions: Session[],
  roomRegistry: RoomRegistry,
  underutilRatio: number,
  tolerance: number,
): CapacityRow[] {
  const valid = sessions.filter((s) => s.room !== null && !s.isVirtualRoom);
  return valid.map((s) => {
    const registryCap = roomRegistry[s.room!];
    let trueCapacity: number | null;
    let source: string;
    if (registryCap !== undefined) {
      trueCapacity = registryCap;
      source = "Room registry";
    } else if (s.capacityListed !== null) {
      trueCapacity = s.capacityListed;
      source = "Sheet value (unverified)";
    } else {
      trueCapacity = null;
      source = "Unknown";
    }
    const hc = s.headCount;
    let status: CapacityRow["capacityStatus"];
    if (hc === null) status = "No Headcount Data";
    else if (trueCapacity === null) status = "Unknown Capacity";
    else if (hc > trueCapacity + tolerance) status = "Over Capacity";
    else if (hc > trueCapacity) status = "Within Tolerance";
    else if (hc < trueCapacity * underutilRatio) status = "Underutilized";
    else status = "OK";
    const overBy = hc !== null && trueCapacity !== null ? Math.max(0, hc - trueCapacity) : 0;
    return {
      rowId: s.rowId,
      term: s.term,
      day: s.day,
      room: s.room!,
      unitCode: s.unitCode,
      unitName: s.unitName,
      lecturer: s.lecturer,
      headCount: hc,
      capacityListed: s.capacityListed,
      trueCapacity,
      capacitySource: source,
      capacityStatus: status,
      overBy: round(overBy),
      capacityMismatch:
        s.capacityListed !== null && trueCapacity !== null && s.capacityListed !== trueCapacity,
    };
  });
}

export function consecutiveViolations(
  sessions: Session[],
  maxConsecutiveHours: number,
  maxGapMinutes: number,
): ConsecutiveViolation[] {
  const valid = sessions.filter(
    (s) => s.lecturer !== null && s.day !== null && s.term !== null && s.startMin !== null && s.endMin !== null,
  );
  const buckets = groupBy(valid, (s) => `${s.term}||${s.day}||${s.lecturer}`);
  const out: ConsecutiveViolation[] = [];
  for (const [, subs] of buckets) {
    const recs = [...subs].sort((a, b) => a.startMin! - b.startMin!);
    let block: Session[] = [recs[0]];
    const flush = () => {
      if (!block.length) return;
      const elapsed = (block[block.length - 1].endMin! - block[0].startMin!) / 60;
      if (elapsed > maxConsecutiveHours) {
        out.push({
          lecturer: block[0].lecturer!,
          term: block[0].term!,
          day: block[0].day!,
          blockStart: minutesToLabel(block[0].startMin),
          blockEnd: minutesToLabel(block[block.length - 1].endMin),
          consecutiveHours: round(elapsed),
          sessions: block.length,
          rowIds: block.map((s) => s.rowId),
        });
      }
    };
    for (let i = 1; i < recs.length; i++) {
      const gap = recs[i].startMin! - block[block.length - 1].endMin!;
      if (gap <= maxGapMinutes) block.push(recs[i]);
      else {
        flush();
        block = [recs[i]];
      }
    }
    flush();
  }
  return out;
}

export function duplicateSchedules(sessions: Session[]): DuplicateGroup[] {
  const valid = sessions.filter(
    (s) =>
      s.term !== null && s.day !== null && s.startMin !== null && s.endMin !== null &&
      s.room !== null && s.lecturer !== null && s.unitCode !== null,
  );
  const buckets = groupBy(
    valid,
    (s) => `${s.term}||${s.day}||${s.startMin}||${s.endMin}||${s.room}||${s.lecturer}||${s.unitCode}`,
  );
  const out: DuplicateGroup[] = [];
  for (const [, subs] of buckets) {
    if (subs.length < 2) continue;
    const f = subs[0];
    out.push({
      term: f.term!,
      day: f.day!,
      time: formatTimeRange(f.startMin, f.endMin),
      room: f.room!,
      lecturer: f.lecturer!,
      unitCode: f.unitCode!,
      count: subs.length,
      rowIds: subs.map((s) => s.rowId).sort((a, b) => a - b),
    });
  }
  return out;
}

export function dataQualityIssues(
  sessions: Session[],
  minValidHours = 0.5,
  maxValidHours = 6,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const s of sessions) {
    const problems: string[] = [];
    if (isBlank(s.dayRaw)) problems.push("Missing day");
    else if (isBlank(s.day)) problems.push(`Unrecognized day value: '${s.dayRaw}'`);
    if (s.timeError === "missing") problems.push("Missing/blank time");
    else if (s.timeError === "unparseable") problems.push(`Unparseable time string: '${s.timeRaw}'`);
    else if (s.timeError === "end_before_start")
      problems.push(`Time range ends before it starts: '${s.timeRaw}'`);
    if (isBlank(s.room)) problems.push("No room assigned");
    if (isBlank(s.lecturer)) problems.push("No lecturer assigned (TBA)");
    if (isBlank(s.programme)) problems.push("Missing programme");
    if (isBlank(s.headCount)) problems.push("Missing head count / enrollment");
    if (isBlank(s.term)) problems.push("Missing term (Term 1/Term 2 required for isolation)");
    const hl = s.hoursListed;
    if (!isBlank(hl)) {
      if (hl! < 0) problems.push(`Invalid teaching hours: negative value (${fmtNum(hl!)}h)`);
      else if (hl === 0 && !isBlank(s.startMin) && !isBlank(s.endMin))
        problems.push("Hours listed as 0 but a time slot is scheduled");
      else if (hl! > 0 && hl! < minValidHours) problems.push(`Unusually low teaching hours: ${fmtNum(hl!)}h`);
      else if (hl! > maxValidHours)
        problems.push(`Unusually high teaching hours: ${fmtNum(hl!)}h (check for a data-entry error)`);
    }
    const span = s.durationHours;
    if (
      !isBlank(hl) && !isBlank(span) && hl! > 0 &&
      Math.abs(span! - hl!) > 2 && span! > maxValidHours
    ) {
      problems.push(
        `Time range spans ${span!.toFixed(1)}h but listed Hours is ${fmtNum(hl!)}h (check for an AM/PM typo in the time)`,
      );
    }
    if (!isBlank(s.notes)) problems.push(`Scheduler note: ${s.notes}`);
    if (problems.length) {
      issues.push({
        rowId: s.rowId,
        programme: s.programme,
        unitCode: s.unitCode,
        day: s.dayRaw,
        time: s.timeRaw,
        issues: problems.join("; "),
        existingNote: isBlank(s.notes) ? null : s.notes,
      });
    }
  }
  return issues;
}

export interface Summary {
  totalSessions: number;
  roomClashes: number;
  lecturerClashes: number;
  cohortClashes: number;
  overloadedLecturers: number;
  closeToMaxLecturers: number;
  overCapacitySessions: number;
  withinToleranceSessions: number;
  dataQualityIssues: number;
  consecutiveViolations: number;
  duplicateScheduleGroups: number;
}

export function summaryCounts(
  sessions: Session[],
  clashes: Clash[],
  workload: WorkloadRow[],
  capacity: CapacityRow[],
  quality: QualityIssue[],
  consecutive: ConsecutiveViolation[],
  duplicates: DuplicateGroup[],
): Summary {
  return {
    totalSessions: sessions.length,
    roomClashes: clashes.filter((c) => c.clashType === "room").length,
    lecturerClashes: clashes.filter((c) => c.clashType === "lecturer").length,
    cohortClashes: clashes.filter((c) => c.clashType === "batch_code").length,
    overloadedLecturers: workload.filter((w) => w.status === "Overloaded").length,
    closeToMaxLecturers: workload.filter((w) => w.status === "Close to Maximum").length,
    overCapacitySessions: capacity.filter((c) => c.capacityStatus === "Over Capacity").length,
    withinToleranceSessions: capacity.filter((c) => c.capacityStatus === "Within Tolerance").length,
    dataQualityIssues: quality.length,
    consecutiveViolations: consecutive.length,
    duplicateScheduleGroups: duplicates.length,
  };
}

// -------------------- Reports --------------------

export interface FacultyReportRow {
  lecturer: string; role: string; departments: string; courses: string;
  sessions: number; totalHours: number; maxHours: number; remainingHours: number;
  status: string; clashes: number;
}

export function facultyReport(
  sessions: Session[],
  roleRegistry: RoleRegistry,
  roleMaxHours: RoleMaxHours,
  departmentRegistry: DepartmentRegistry,
  th: Pick<Thresholds, "nearMaxPct" | "farUnderPct">,
): FacultyReportRow[] {
  const valid = sessions.filter((s) => s.lecturer !== null);
  const clashes = allClashes(sessions).filter((c) => c.clashType === "lecturer");
  const clashCount = new Map<string, number>();
  for (const c of clashes) clashCount.set(c.groupValue, (clashCount.get(c.groupValue) ?? 0) + 1);

  const buckets = groupBy(valid, (s) => s.lecturer!);
  const rows: FacultyReportRow[] = [];
  for (const [lecturer, subs] of buckets) {
    const role = roleRegistry[lecturer] ?? DEFAULT_ROLE;
    const maxHours = maxHoursForRole(role, roleMaxHours);
    const totalHours = subs.reduce((a, s) => a + (s.workloadHours ?? 0), 0);
    const { status } = workloadStatus(totalHours, maxHours, th.nearMaxPct, th.farUnderPct);
    const depts = [
      ...new Set(
        subs.map((s) => departmentFor(s.programme, departmentRegistry)).filter((d): d is string => !!d),
      ),
    ].sort();
    const courses = [...new Set(subs.map((s) => s.unitCode).filter((u): u is string => !!u))].sort();
    rows.push({
      lecturer, role,
      departments: depts.length ? depts.join(", ") : "\u2014",
      courses: courses.join(", "),
      sessions: subs.length,
      totalHours: round(totalHours),
      maxHours,
      remainingHours: round(maxHours - totalHours),
      status,
      clashes: clashCount.get(lecturer) ?? 0,
    });
  }
  const rank: Record<string, number> = { Overloaded: 0, "Close to Maximum": 1, Balanced: 2 };
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || b.totalHours - a.totalHours);
}

export interface RoomReportRow {
  room: string; capacity: number | null; classes: number; avgHeadCount: number | null;
  utilizationPct: number | null; overCapacity: number; withinTolerance: number;
  underutilized: number; doubleBookings: number;
}

export function roomReport(
  sessions: Session[],
  roomRegistry: RoomRegistry,
  underutilRatio: number,
  tolerance: number,
): RoomReportRow[] {
  const valid = sessions.filter((s) => s.room !== null && !s.isVirtualRoom);
  const cap = capacityAnalysis(sessions, roomRegistry, underutilRatio, tolerance);
  const roomClashes = detectClashes(sessions, "room");
  const clashCount = new Map<string, number>();
  for (const c of roomClashes) clashCount.set(c.groupValue, (clashCount.get(c.groupValue) ?? 0) + 1);

  const buckets = groupBy(valid, (s) => s.room!);
  const rows: RoomReportRow[] = [];
  for (const [room, subs] of buckets) {
    const trueCap = roomRegistry[room] ?? null;
    const hcVals = subs.map((s) => s.headCount).filter((h): h is number => h !== null);
    const avgHc = hcVals.length ? hcVals.reduce((a, b) => a + b, 0) / hcVals.length : null;
    const util = trueCap && avgHc !== null ? (avgHc / trueCap) * 100 : null;
    const capSub = cap.filter((c) => c.room === room);
    rows.push({
      room,
      capacity: trueCap,
      classes: subs.length,
      avgHeadCount: avgHc === null ? null : round(avgHc, 1),
      utilizationPct: util === null ? null : round(util, 1),
      overCapacity: capSub.filter((c) => c.capacityStatus === "Over Capacity").length,
      withinTolerance: capSub.filter((c) => c.capacityStatus === "Within Tolerance").length,
      underutilized: capSub.filter((c) => c.capacityStatus === "Underutilized").length,
      doubleBookings: clashCount.get(room) ?? 0,
    });
  }
  return rows.sort((a, b) => a.room.localeCompare(b.room));
}

export interface ProgrammeReportRow {
  programme: string; department: string; courses: number; sessions: number;
  avgEnrollment: number | null; assignedRooms: string; capacityWarnings: number;
}

export function programmeReport(
  sessions: Session[],
  departmentRegistry: DepartmentRegistry,
  roomRegistry: RoomRegistry,
): ProgrammeReportRow[] {
  const valid = sessions.filter((s) => s.programme !== null);
  const cap = capacityAnalysis(sessions, roomRegistry, 0.4, 20);
  const buckets = groupBy(valid, (s) => s.programme!);
  const rows: ProgrammeReportRow[] = [];
  for (const [programme, subs] of buckets) {
    const dept = departmentFor(programme, departmentRegistry) ?? "\u2014";
    const rooms = [...new Set(subs.map((s) => s.room).filter((r): r is string => !!r))].sort();
    const rowIds = new Set(subs.map((s) => s.rowId));
    const hcVals = subs.map((s) => s.headCount).filter((h): h is number => h !== null);
    const warn = cap.filter(
      (c) => rowIds.has(c.rowId) && (c.capacityStatus === "Over Capacity" || c.capacityStatus === "Within Tolerance"),
    ).length;
    rows.push({
      programme,
      department: dept,
      courses: new Set(subs.map((s) => s.unitCode).filter(Boolean)).size,
      sessions: subs.length,
      avgEnrollment: hcVals.length ? round(hcVals.reduce((a, b) => a + b, 0) / hcVals.length, 1) : null,
      assignedRooms: rooms.length ? rooms.join(", ") : "\u2014",
      capacityWarnings: warn,
    });
  }
  return rows.sort((a, b) => a.programme.localeCompare(b.programme));
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}
