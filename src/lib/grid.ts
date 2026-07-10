// Day x Time-slot grid builder for the Timetable views.
import { DAY_ORDER, DayCode, Session } from "./types";
import { formatTimeRange, isBlank } from "./clean";

export interface GridCell {
  text: string;
  clash: boolean;
  rowIds: number[];
}

export interface Grid {
  slots: string[]; // row labels (time ranges), time-ordered
  days: DayCode[]; // column labels present
  cells: Record<string, Record<string, GridCell>>; // slot -> day -> cell
}

export type CellField = "unitCode" | "room" | "lecturer" | "programme";

function cellText(s: Session, fields: CellField[]): string {
  const parts: string[] = [];
  if (fields.includes("unitCode") && !isBlank(s.unitCode)) parts.push(String(s.unitCode));
  if (fields.includes("room") && !isBlank(s.room)) parts.push(`Rm ${s.room}`);
  if (fields.includes("lecturer") && !isBlank(s.lecturer)) parts.push(String(s.lecturer));
  if (fields.includes("programme") && !isBlank(s.programme)) parts.push(String(s.programme));
  return parts.length ? parts.join(" \u00b7 ") : "(unlabeled)";
}

export function buildGrid(
  sessions: Session[],
  fields: CellField[] = ["unitCode", "room", "lecturer"],
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
    for (const day of days) cells[slot][day] = { text: "", clash: false, rowIds: [] };
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
    const clash = subs.length > 1;
    cells[slot][day] = {
      text: subs.map((s) => cellText(s, fields)).join("\n"),
      clash,
      rowIds: subs.map((s) => s.rowId),
    };
  }
  return { slots, days, cells };
}
