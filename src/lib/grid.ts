// Day x Time-slot grid builder for the Timetable views.
//
// A cell holds structured ENTRIES rather than a blob of text, so each view can
// lay out the course code, course name and the supporting detail (lecturer,
// room, programmes/cohorts) properly instead of cramming them onto one line.
import { DAY_ORDER, DayCode, Session } from "./types";
import { formatTimeRange, isBlank } from "./clean";
import { summarise } from "./classDetails";

export type CellField = "unitCode" | "unitName" | "room" | "lecturer" | "programme" | "cohort";

export interface GridEntry {
  rowId: number;
  unitCode: string | null;
  unitName: string | null;
  programme: string | null;
  /** Everything else worth showing, already formatted: "Rm 301 · J KAWUKI · BSCCS". */
  secondary: string;
  /** Full one-line description, used for tooltips and plain-text renderers. */
  text: string;
}

export interface GridCell {
  text: string; // newline-joined entries (kept for simple/legacy renderers)
  clash: boolean;
  rowIds: number[];
  entries: GridEntry[];
}

export interface Grid {
  slots: string[]; // row labels (time ranges), time-ordered
  days: DayCode[]; // column labels present
  cells: Record<string, Record<string, GridCell>>; // slot -> day -> cell
}

/** All programmes attending a session, including any merged into it. */
function programmesOf(s: Session): string[] {
  return [
    ...new Set([s.programme, ...(s.merged?.programmes ?? [])].filter((x): x is string => !!x)),
  ].sort();
}

/** All cohorts attending a session, including any merged into it. */
function cohortsOf(s: Session): string[] {
  return [
    ...new Set([s.batchCode, ...(s.merged?.batchCodes ?? [])].filter((x): x is string => !!x)),
  ].sort();
}

function buildEntry(s: Session, fields: CellField[]): GridEntry {
  const secondary: string[] = [];
  if (fields.includes("room") && !isBlank(s.room)) secondary.push(`Rm ${s.room}`);
  if (fields.includes("lecturer")) secondary.push(String(s.lecturer ?? "TBA"));
  if (fields.includes("programme")) {
    const progs = programmesOf(s);
    if (progs.length) secondary.push(summarise(progs));
  }
  if (fields.includes("cohort")) {
    const cohorts = cohortsOf(s);
    if (cohorts.length) secondary.push(summarise(cohorts));
  }

  const head: string[] = [];
  if (fields.includes("unitCode") && !isBlank(s.unitCode)) head.push(String(s.unitCode));
  if (fields.includes("unitName") && !isBlank(s.unitName)) head.push(String(s.unitName));

  const text = [...head, ...secondary].join(" \u00b7 ") || "(unlabeled)";
  return {
    rowId: s.rowId,
    unitCode: s.unitCode,
    unitName: s.unitName,
    programme: s.programme,
    secondary: secondary.join(" \u00b7 "),
    text,
  };
}

export function buildGrid(
  sessions: Session[],
  fields: CellField[] = ["unitCode", "unitName", "room", "lecturer"],
): Grid {
  const valid = sessions.filter((s) => s.day !== null && s.startMin !== null && s.endMin !== null);
  const slotOrder: { slot: string; start: number }[] = [];
  const seen = new Set<string>();
  for (const s of valid) {
    const slot = formatTimeRange(s.startMin, s.endMin);
    if (!seen.has(slot)) {
      seen.add(slot);
      slotOrder.push({ slot, start: s.startMin! });
    }
  }
  slotOrder.sort((a, b) => a.start - b.start);
  const slots = slotOrder.map((s) => s.slot);
  const days = DAY_ORDER.filter((d) => valid.some((s) => s.day === d));

  const cells: Record<string, Record<string, GridCell>> = {};
  for (const slot of slots) {
    cells[slot] = {};
    for (const day of days) cells[slot][day] = { text: "", clash: false, rowIds: [], entries: [] };
  }
  const buckets = new Map<string, Session[]>();
  for (const s of valid) {
    const slot = formatTimeRange(s.startMin, s.endMin);
    const key = `${slot}||${s.day}`;
    const arr = buckets.get(key);
    if (arr) arr.push(s);
    else buckets.set(key, [s]);
  }
  for (const [key, subs] of buckets) {
    const [slot, day] = key.split("||");
    const entries = subs.map((s) => buildEntry(s, fields));
    cells[slot][day] = {
      text: entries.map((e) => e.text).join("\n"),
      clash: subs.length > 1,
      rowIds: subs.map((s) => s.rowId),
      entries,
    };
  }
  return { slots, days, cells };
}
