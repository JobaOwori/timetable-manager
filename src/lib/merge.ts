// Merging duplicate course-unit rows.
//
// Timetable sheets routinely list ONE physical teaching session more than once —
// the same lecturer, the same room and the same slot, but a slightly different
// unit title per programme ("Research Methods" / "Business Research Methods").
// Clash detection already refuses to flag these (see sharedClass.ts), but the
// rows themselves remain duplicated, which inflates counts and keeps re-raising
// the question. Merging collapses such a group into ONE canonical session that
// carries the combined enrolment and a record of what it absorbed, so the
// corresponding conflict disappears for good.
import { MergeInfo, Session } from "./types";
import { sameOrRelatedUnit } from "./sharedClass";
import { subjectSimilarity } from "./subjectGroup";
import { formatTimeRange } from "./clean";
import { finalizeSession } from "./ingest";

export interface MergeGroup {
  key: string;
  term: string | null;
  day: string | null;
  time: string;
  room: string | null;
  lecturer: string | null;
  rowIds: number[];
  unitCodes: string[];
  unitNames: string[];
  programmes: string[];
  batchCodes: string[];
  headCount: number;
  /** Plain-language justification shown next to the Merge button. */
  reason: string;
}

/** The row that survives a merge: the lowest rowId (earliest in the sheet). */
function canonicalRow(members: Session[]): Session {
  return [...members].sort((a, b) => a.rowId - b.rowId)[0];
}

/**
 * Every group of rows that can safely be merged into one session: same term,
 * day and exact slot, same physical room, same lecturer, and the same or a
 * closely-related course unit.
 *
 * Clustering is done over the "same-or-related unit" relation itself rather
 * than over whole combined-class groups: a room can legitimately hold one
 * combined class made of SEVERAL distinct subjects, and only the rows that
 * describe the *same* unit may be collapsed.
 */
export function mergeableGroups(sessions: Session[]): MergeGroup[] {
  // Rows that could possibly be one session: identical term, day, slot, room
  // and lecturer. Virtual/unassigned rows can never be merged.
  const buckets = new Map<string, Session[]>();
  for (const s of sessions) {
    if (s.term === null || s.day === null || s.startMin === null || s.endMin === null) continue;
    if (s.lecturer === null || s.room === null || s.isVirtualRoom) continue;
    const k = `${s.term}||${s.day}||${s.startMin}||${s.endMin}||${s.room}||${s.lecturer}`;
    const arr = buckets.get(k);
    if (arr) arr.push(s);
    else buckets.set(k, [s]);
  }

  const groups: MergeGroup[] = [];
  for (const [key, rows] of buckets) {
    if (rows.length < 2) continue;

    // Union rows describing the same/related unit (transitively).
    const parent = rows.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (sameOrRelatedUnit(rows[i], rows[j])) parent[find(i)] = find(j);
      }
    }
    const clusters = new Map<number, Session[]>();
    rows.forEach((s, i) => {
      const r = find(i);
      const arr = clusters.get(r);
      if (arr) arr.push(s);
      else clusters.set(r, [s]);
    });

    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      const canonical = canonicalRow(members);
      const names = [...new Set(members.map((m) => m.unitName).filter((n): n is string => !!n))];
      const codes = [...new Set(members.map((m) => m.unitCode).filter((c): c is string => !!c))];
      const batches = [...new Set(members.map((m) => m.batchCode).filter((b): b is string => !!b))];
      const programmes = [...new Set(members.map((m) => m.programme).filter((p): p is string => !!p))];

      groups.push({
        key: `${key}||${canonical.rowId}`,
        term: canonical.term,
        day: canonical.day,
        time: formatTimeRange(canonical.startMin, canonical.endMin),
        room: canonical.room,
        lecturer: canonical.lecturer,
        rowIds: members.map((m) => m.rowId).sort((a, b) => a - b),
        unitCodes: codes,
        unitNames: names,
        programmes,
        batchCodes: batches,
        headCount: combinedHeadCount(members) ?? 0,
        reason: mergeReason(canonical, members, names, codes),
      });
    }
  }

  return groups.sort((a, b) => b.rowIds.length - a.rowIds.length || a.key.localeCompare(b.key));
}

/**
 * Enrolment of a merged session: distinct cohorts really do sit in the room
 * together and add up; repeated rows for one cohort are the same students.
 */
function combinedHeadCount(members: Session[]): number | null {
  if (!members.some((m) => m.headCount !== null)) return null;
  const byBatch = new Map<string, number>();
  let unlabelled = 0;
  for (const m of members) {
    const hc = m.headCount ?? 0;
    if (m.batchCode === null) unlabelled = Math.max(unlabelled, hc);
    else byBatch.set(m.batchCode, Math.max(byBatch.get(m.batchCode) ?? 0, hc));
  }
  return [...byBatch.values()].reduce((a, b) => a + b, 0) + unlabelled;
}

function mergeReason(
  canonical: Session,
  members: Session[],
  names: string[],
  codes: string[],
): string {
  const where = `${canonical.lecturer} · Rm ${canonical.room} · ${canonical.day ?? ""} ${
    canonical.timeRaw ?? ""
  }`.trim();
  if (names.length < 2) {
    return `${members.length} identical rows for the same unit (${where}) — one teaching session listed ${members.length} times.`;
  }
  const sim = subjectSimilarity(names[0], names[1]);
  const pct = Math.round(sim.score * 100);
  const codeNote = codes.length > 1 ? ` (${codes.join(" / ")})` : "";
  return `“${names.join("” and “")}”${codeNote} are ${pct}% name-identical, taught by the same lecturer in the same room at the same time — the same teaching session.`;
}

/** The mergeable group containing every one of `rowIds`, if there is one. */
export function mergeableGroupFor(sessions: Session[], rowIds: number[]): MergeGroup | null {
  if (rowIds.length < 2) return null;
  const wanted = new Set(rowIds);
  return (
    mergeableGroups(sessions).find((g) => [...wanted].every((id) => g.rowIds.includes(id))) ?? null
  );
}

/** Every mergeable group that overlaps the given rows (a conflict card's rows). */
export function mergeableGroupsTouching(sessions: Session[], rowIds: number[]): MergeGroup[] {
  const wanted = new Set(rowIds);
  return mergeableGroups(sessions).filter(
    (g) => g.rowIds.filter((id) => wanted.has(id)).length >= 2,
  );
}

/**
 * Collapse `rowIds` into their lowest-numbered row, immutably. The survivor
 * keeps its own identity but gains the combined enrolment and a `merged` record
 * of every absorbed row, so the merge is fully explainable and undoable.
 *
 * Refuses to merge rows that are not a genuine duplicate group (same lecturer,
 * room, slot and a same/related unit) — merging a real double-booking would
 * silently delete a class that still needs to be taught.
 */
export function applyMerge(sessions: Session[], rowIds: number[]): Session[] {
  const ids = new Set(rowIds);
  const members = sessions.filter((s) => ids.has(s.rowId));
  if (members.length < 2) return sessions;
  if (!mergeableGroupFor(sessions, [...ids])) return sessions;

  const canonical = canonicalRow(members);
  const absorbed = members.filter((m) => m.rowId !== canonical.rowId);
  const headCount = combinedHeadCount(members);

  const prior = canonical.merged;
  const merged: MergeInfo = {
    rowIds: [...new Set([...(prior?.rowIds ?? []), ...absorbed.map((m) => m.rowId)])].sort((a, b) => a - b),
    unitCodes: [
      ...new Set([...(prior?.unitCodes ?? []), ...absorbed.map((m) => m.unitCode).filter((x): x is string => !!x)]),
    ],
    unitNames: [
      ...new Set([...(prior?.unitNames ?? []), ...absorbed.map((m) => m.unitName).filter((x): x is string => !!x)]),
    ],
    programmes: [
      ...new Set([...(prior?.programmes ?? []), ...absorbed.map((m) => m.programme).filter((x): x is string => !!x)]),
    ],
    batchCodes: [
      ...new Set([...(prior?.batchCodes ?? []), ...absorbed.map((m) => m.batchCode).filter((x): x is string => !!x)]),
    ],
  };

  const noteParts = [
    canonical.notes,
    `Merged ${absorbed.length} duplicate row${absorbed.length === 1 ? "" : "s"}: ${
      merged.unitCodes.length ? merged.unitCodes.join(", ") : `#${merged.rowIds.join(", #")}`
    }`,
  ].filter((x): x is string => !!x);

  return sessions
    .filter((s) => !ids.has(s.rowId) || s.rowId === canonical.rowId)
    .map((s) =>
      s.rowId === canonical.rowId
        ? finalizeSession({ ...s, headCount, notes: noteParts.join("; "), merged })
        : s,
    );
}

/** Merge every mergeable group in one pass. Returns the count of merges made. */
export function mergeAllSimilar(sessions: Session[]): { sessions: Session[]; merged: number; removed: number } {
  let working = sessions;
  let merged = 0;
  let removed = 0;
  // Re-detect after each merge: collapsing one group can reveal/settle another.
  for (let i = 0; i < 500; i++) {
    const groups = mergeableGroups(working);
    if (groups.length === 0) break;
    const before = working.length;
    working = applyMerge(working, groups[0].rowIds);
    if (working.length === before) break; // nothing changed — avoid spinning
    merged += 1;
    removed += before - working.length;
  }
  return { sessions: working, merged, removed };
}
