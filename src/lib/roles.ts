// Faculty roles and role-based weekly workload limits.
//
// A person has BOTH a role (what they do besides teach — Lecturer, H.O.D.,
// Dean, DAA, AR…) and a faculty type (Full-Time or Part-Time). The role sets
// the weekly teaching cap for full-time staff; part-time staff are capped by
// the dedicated "Part-Time Lecturer" limit instead, because they are paid per
// teaching session rather than against a full-time contract.

import { FacultyType, RoleMaxHours, WorkloadStatus } from "./types";

export const DEFAULT_ROLE = "Lecturer";

/** The role whose limit governs every Part-Time member of staff. */
export const PART_TIME_ROLE = "Part-Time Lecturer";

export const ROLE_MAX_HOURS: RoleMaxHours = {
  Lecturer: 22,
  "H.O.D.": 16,
  Dean: 12,
  "Lab Assistant": 12,
  "Teaching Assistant": 12,
  DAA: 6,
  AR: 2,
  [PART_TIME_ROLE]: 12,
};

export const ROLE_OPTIONS = Object.keys(ROLE_MAX_HOURS);

/** Roles a person can be assigned (the Part-Time cap is not itself a role). */
export const ASSIGNABLE_ROLES = ROLE_OPTIONS.filter((r) => r !== PART_TIME_ROLE);

/**
 * Only classroom Lecturers may be engaged Part-Time. Every other academic role
 * (DAA, AR, H.O.D., Dean, Lab Assistant, Teaching Assistant) is a substantive
 * full-time appointment, so those staff are always Full-Time.
 */
export function canBePartTime(role: string | null | undefined): boolean {
  return role === null || role === undefined || role === DEFAULT_ROLE || role === PART_TIME_ROLE;
}

/** Roles that are locked to Full-Time, for messages and disabled controls. */
export const FULL_TIME_ONLY_ROLES = ASSIGNABLE_ROLES.filter((r) => !canBePartTime(r));

/** Short, human-friendly explanation of each role, used in menus and tooltips. */
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  Lecturer: "Teaching staff — the only role that may be Part-Time",
  "H.O.D.": "Head of Department — always Full-Time",
  Dean: "Faculty Dean — always Full-Time",
  "Lab Assistant": "Laboratory / practical support — always Full-Time",
  "Teaching Assistant": "Teaching support — always Full-Time",
  DAA: "Deputy Academic Affairs — always Full-Time",
  AR: "Academic Registrar — always Full-Time",
  [PART_TIME_ROLE]: "Weekly cap applied to every Part-Time lecturer",
};

/** Merge a (possibly stale, persisted) map over the current defaults. */
export function withRoleDefaults(map?: RoleMaxHours | null): RoleMaxHours {
  return { ...ROLE_MAX_HOURS, ...(map ?? {}) };
}

export function maxHoursForRole(role: string | null, roleMaxHours?: RoleMaxHours): number {
  const map = roleMaxHours ?? ROLE_MAX_HOURS;
  if (role === null || !(role in map)) {
    return map[DEFAULT_ROLE] ?? ROLE_MAX_HOURS[DEFAULT_ROLE];
  }
  return map[role];
}

/**
 * The weekly teaching cap that actually applies to a person: the Part-Time
 * limit when they are part-time, otherwise their role's limit.
 */
export function maxHoursFor(
  role: string | null,
  facultyType: FacultyType,
  roleMaxHours?: RoleMaxHours,
): number {
  if (facultyType === "PT") {
    const map = roleMaxHours ?? ROLE_MAX_HOURS;
    return map[PART_TIME_ROLE] ?? ROLE_MAX_HOURS[PART_TIME_ROLE];
  }
  return maxHoursForRole(role, roleMaxHours);
}

export const STATUS_TONE: Record<WorkloadStatus, "red" | "amber" | "green"> = {
  Balanced: "green",
  Unbalanced: "red",
  Flexible: "amber",
};
