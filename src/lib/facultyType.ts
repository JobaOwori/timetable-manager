// Faculty type (Full-Time / Part-Time), workload-status model, programme level,
// and the institution's scheduling-rule constants. Central home for the rules
// introduced on top of clash detection.
import { FacultyType, Session, WorkloadStatus } from "./types";

export const DEFAULT_FACULTY_TYPE: FacultyType = "FT";

export const FACULTY_TYPE_LABEL: Record<FacultyType, string> = {
  FT: "Full-Time",
  PT: "Part-Time",
};

export const FACULTY_TYPE_OPTIONS: FacultyType[] = ["FT", "PT"];

/** Seed every lecturer as Full-Time by default. */
export function seedFacultyTypes(sessions: Session[]): Record<string, FacultyType> {
  const out: Record<string, FacultyType> = {};
  for (const l of new Set(sessions.map((s) => s.lecturer).filter((x): x is string => !!x))) {
    out[l] = DEFAULT_FACULTY_TYPE;
  }
  return out;
}

export function facultyTypeOf(
  lecturer: string | null,
  registry?: Record<string, FacultyType>,
): FacultyType {
  if (!lecturer) return DEFAULT_FACULTY_TYPE;
  return registry?.[lecturer] ?? DEFAULT_FACULTY_TYPE;
}

/**
 * Workload status under the FT/PT model:
 *  - Part-Time: always "Flexible" — paid hourly, no minimum or maximum load.
 *  - Full-Time: "Balanced" only when at (≈) the weekly target (their role's max
 *    hours, 22h for a Lecturer); any other load is "Unbalanced" (over OR under).
 */
export function workloadStatus(
  hours: number,
  target: number,
  facultyType: FacultyType,
  tolerance = 0.5,
): { status: WorkloadStatus; reason: string } {
  if (facultyType === "PT") {
    return { status: "Flexible", reason: "Part-time — paid hourly, no fixed weekly load." };
  }
  const diff = hours - target;
  if (Math.abs(diff) <= tolerance) {
    return { status: "Balanced", reason: `On target (${fmt(target)}h/week).` };
  }
  if (diff > 0) {
    return { status: "Unbalanced", reason: `${fmt(diff)}h over the ${fmt(target)}h weekly target.` };
  }
  return { status: "Unbalanced", reason: `${fmt(-diff)}h under the ${fmt(target)}h weekly target.` };
}

// -------------------- Programme level (UG vs PG) --------------------

export type ProgLevel = "bachelor" | "diploma" | "hec" | "master" | "doctoral";

export const PROG_LEVEL_LABEL: Record<ProgLevel, string> = {
  bachelor: "Undergraduate (Bachelor's)",
  diploma: "Diploma",
  hec: "Higher Education Certificate",
  master: "Master's",
  doctoral: "Postgraduate / Doctoral",
};

export const PROG_LEVEL_SHORT: Record<ProgLevel, string> = {
  bachelor: "Bachelor's",
  diploma: "Diploma",
  hec: "HEC",
  master: "Master's",
  doctoral: "Doctoral",
};

/**
 * Classify a programme purely from its code prefix (standardized):
 *   HEC…            -> Higher Education Certificate
 *   B…  (BBA/BSc…)  -> Undergraduate (Bachelor's)
 *   D…              -> Diploma
 *   M…  (MSc/MBA…)  -> Master's
 *   P…  (PGD/PhD…)  -> Postgraduate / Doctoral
 * Anything else defaults to Bachelor's (the most permissive weekday programme).
 */
export function programmeLevel(programme: string | null): ProgLevel {
  if (!programme) return "bachelor";
  const code = programme.trim().toUpperCase();
  if (code.startsWith("HEC")) return "hec";
  switch (code[0]) {
    case "B": return "bachelor";
    case "D": return "diploma";
    case "M": return "master";
    case "P": return "doctoral";
    default: return "bachelor";
  }
}

/** Master's & Doctoral programmes are scheduled ONLY on Saturday. */
export function requiresSaturday(programme: string | null): boolean {
  const l = programmeLevel(programme);
  return l === "master" || l === "doctoral";
}

/** Bachelor's, Diploma and HEC programmes are never scheduled on Saturday. */
export function forbiddenOnSaturday(programme: string | null): boolean {
  return !requiresSaturday(programme);
}

// -------------------- Scheduling-rule constants --------------------

/** Full-time lecturers may not be scheduled in the Friday 4:00–6:00 PM slot. */
export const FRIDAY_BLOCK = { day: "FRI" as const, startMin: 16 * 60, endMin: 18 * 60 };

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
