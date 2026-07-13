// Faculty hygiene: duplicate-record detection/merging and subject (course-unit)
// assignment tracking. "Faculty records" here are the distinct lecturer names
// that appear across sessions; messy source data routinely produces near-
// duplicates ("JAMES KAWUKI", "James  Kawuki", "Kawuki, James") that must be
// collapsed so workload, clashes and reports are computed against one person.
import { Session } from "./types";
import { finalizeSession } from "./ingest";

/**
 * Order-independent identity key for a lecturer name: uppercased, punctuation
 * stripped, tokens sorted. This deliberately collapses "Last, First" and
 * "First Last" plus whitespace/case variants onto the same key.
 */
export function lecturerKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export interface DuplicateFacultyGroup {
  key: string;
  canonical: string;
  variants: string[]; // all display spellings, canonical first
  sessionCount: number;
}

/** Pick the "best" spelling for a key. */
function chooseCanonical(counts: Map<string, number>): string {
  const isAllCaps = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();
  const hasComma = (s: string) => s.includes(",");
  return [...counts.entries()].sort((a, b) => {
    // most sessions wins
    if (b[1] !== a[1]) return b[1] - a[1];
    // prefer proper mixed-case over ALL CAPS
    const capA = isAllCaps(a[0]) ? 1 : 0;
    const capB = isAllCaps(b[0]) ? 1 : 0;
    if (capA !== capB) return capA - capB;
    // prefer "First Last" over "Last, First"
    const comA = hasComma(a[0]) ? 1 : 0;
    const comB = hasComma(b[0]) ? 1 : 0;
    if (comA !== comB) return comA - comB;
    // then the fuller spelling, then alphabetical
    return b[0].length - a[0].length || a[0].localeCompare(b[0]);
  })[0][0];
}

/** Groups of lecturer spellings that resolve to the same identity (>1 spelling). */
export function detectDuplicateFaculty(sessions: Session[]): DuplicateFacultyGroup[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const s of sessions) {
    if (!s.lecturer) continue;
    const key = lecturerKey(s.lecturer);
    if (!key) continue;
    const counts = byKey.get(key) ?? new Map<string, number>();
    counts.set(s.lecturer, (counts.get(s.lecturer) ?? 0) + 1);
    byKey.set(key, counts);
  }
  const groups: DuplicateFacultyGroup[] = [];
  for (const [key, counts] of byKey) {
    if (counts.size < 2) continue;
    const canonical = chooseCanonical(counts);
    const variants = [...counts.keys()].sort(
      (a, b) => (a === canonical ? -1 : b === canonical ? 1 : a.localeCompare(b)),
    );
    const sessionCount = [...counts.values()].reduce((x, y) => x + y, 0);
    groups.push({ key, canonical, variants, sessionCount });
  }
  return groups.sort((a, b) => b.sessionCount - a.sessionCount);
}

/** variant-spelling -> canonical spelling, for every name that needs remapping. */
export function facultyDedupMap(sessions: Session[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const g of detectDuplicateFaculty(sessions)) {
    for (const v of g.variants) if (v !== g.canonical) map[v] = g.canonical;
  }
  return map;
}

/** Rewrite every lecturer spelling in `map` to its canonical form, immutably. */
export function applyFacultyMerge(sessions: Session[], map: Record<string, string>): Session[] {
  if (Object.keys(map).length === 0) return sessions;
  return sessions.map((s) => {
    if (!s.lecturer || !(s.lecturer in map)) return s;
    const canonical = map[s.lecturer];
    return finalizeSession({ ...s, lecturer: canonical, lecturerRaw: canonical });
  });
}

/** Merge one lecturer spelling into another (used for manual merges). */
export function mergeLecturer(sessions: Session[], from: string, to: string): Session[] {
  return applyFacultyMerge(sessions, { [from]: to });
}

/**
 * Seed subject (course-unit) assignments from what each lecturer already teaches.
 * Returns lecturer -> sorted distinct unit codes.
 */
export function subjectAssignmentsFromSessions(sessions: Session[]): Record<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const s of sessions) {
    if (!s.lecturer || !s.unitCode) continue;
    const set = map.get(s.lecturer) ?? new Set<string>();
    set.add(s.unitCode);
    map.set(s.lecturer, set);
  }
  const out: Record<string, string[]> = {};
  for (const [lect, set] of map) out[lect] = [...set].sort();
  return out;
}

export interface UnitInfo {
  code: string;
  name: string | null;
}

/** Distinct course units present in the data, code -> best-known name. */
export function distinctUnits(sessions: Session[]): UnitInfo[] {
  const map = new Map<string, string | null>();
  for (const s of sessions) {
    if (!s.unitCode) continue;
    if (!map.has(s.unitCode) || (!map.get(s.unitCode) && s.unitName)) {
      map.set(s.unitCode, s.unitName);
    }
  }
  return [...map.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
}
