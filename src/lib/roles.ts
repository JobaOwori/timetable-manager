// Faculty roles and role-based weekly workload limits. Ports src/roles.py.

import { RoleMaxHours, WorkloadStatus } from "./types";

export const DEFAULT_ROLE = "Lecturer";

export const ROLE_MAX_HOURS: RoleMaxHours = {
  Lecturer: 22,
  "H.O.D.": 16,
  Dean: 12,
  "Lab Assistant": 12,
  DAA: 6,
  AR: 2,
};

export const ROLE_OPTIONS = Object.keys(ROLE_MAX_HOURS);

export function maxHoursForRole(role: string | null, roleMaxHours?: RoleMaxHours): number {
  const map = roleMaxHours ?? ROLE_MAX_HOURS;
  if (role === null || !(role in map)) {
    return map[DEFAULT_ROLE] ?? ROLE_MAX_HOURS[DEFAULT_ROLE];
  }
  return map[role];
}

export const STATUS_TONE: Record<WorkloadStatus, "red" | "amber" | "green"> = {
  Balanced: "green",
  Unbalanced: "red",
  Flexible: "amber",
};
