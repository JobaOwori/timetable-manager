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

export function workloadStatus(
  hours: number,
  maxHours: number,
  nearMaxPct = 0.85,
  farUnderPct = 0.4,
): { status: WorkloadStatus; reason: string } {
  if (maxHours <= 0) {
    if (hours > 0) return { status: "Overloaded", reason: "role has no weekly-hours allowance" };
    return { status: "Balanced", reason: "" };
  }
  if (hours > maxHours) {
    return { status: "Overloaded", reason: `${fmt(hours)}h exceeds the ${fmt(maxHours)}h role limit` };
  }
  if (hours >= nearMaxPct * maxHours) {
    return { status: "Close to Maximum", reason: `nearing the ${fmt(maxHours)}h role limit` };
  }
  if (hours < farUnderPct * maxHours) {
    return { status: "Close to Maximum", reason: "significantly under the recommended load" };
  }
  return { status: "Balanced", reason: "" };
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export const STATUS_TONE: Record<WorkloadStatus, "red" | "amber" | "green"> = {
  Overloaded: "red",
  "Close to Maximum": "amber",
  Balanced: "green",
};
