// Programme -> Department (faculty) mapping. Ports src/departments.py.

import { DepartmentRegistry } from "./types";

export const DEPARTMENT_LABELS: Record<string, string> = {
  FICT: "Faculty of Information and Communication Technology",
  FBAC: "Faculty of Business and Commerce",
  FHS: "Faculty of Health Science",
};

export const DEPARTMENT_OPTIONS = Object.keys(DEPARTMENT_LABELS);

// Best-effort seed from the real Fall-2026 programme codes.
export const DEFAULT_PROGRAMME_DEPARTMENT: DepartmentRegistry = {
  "BE.EC": "FICT", "BE.RAI": "FICT", "BS.CE": "FICT", "BSCAI&ML": "FICT",
  BSCAIT: "FICT", BSCCS: "FICT", BSCNCS: "FICT", BSCVFX: "FICT",
  DIT: "FICT", "MSC.CSF": "FICT", "MSC.DFT": "FICT", MSCIT: "FICT",
  PGDIT: "FICT", PHDICT: "FICT",
  BBAIB: "FBAC", BBAIM: "FBAC", BHM: "FBAC", BSCAE: "FBAC",
  BSCAF: "FBAC", HEC: "FBAC", MBA: "FBAC", PHDBM: "FBAC",
  BMIT: "FHS", BMLT: "FHS", "HEC-HS": "FHS", MPH: "FHS",
};

export function departmentFor(
  programme: string | null,
  mapping?: DepartmentRegistry,
): string | null {
  const map = mapping ?? DEFAULT_PROGRAMME_DEPARTMENT;
  if (programme === null) return null;
  return map[String(programme).trim().toUpperCase()] ?? null;
}
