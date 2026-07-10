// Normalization helpers for messy, real-world timetable data.
// Ports src/clean.py from the original Streamlit app.

import { DAY_ORDER, DayCode, TimeError } from "./types";

const DAY_ALIASES: Record<string, DayCode> = {
  MON: "MON", MONDAY: "MON",
  TUE: "TUE", TUES: "TUE", TUESDAY: "TUE",
  WED: "WED", WEDS: "WED", WEDNESDAY: "WED",
  THU: "THU", THUR: "THU", THURS: "THU", THURSDAY: "THU",
  FRI: "FRI", FRIDAY: "FRI",
  SAT: "SAT", SATURDAY: "SAT",
  SUN: "SUN", SUNDAY: "SUN",
};

const UNASSIGNED_TOKENS = new Set(["X", "TBA", "N/A", "NA", "-", "NONE", "TBD", ""]);
const VIRTUAL_ROOM_TOKENS = new Set(["ONLINE", "VIRTUAL", "REMOTE", "TBA", "N/A", "-", ""]);

const TIME_TOKEN_RE = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])/g;

/** True for null/undefined/NaN/empty — the JS analogue of the Python isBlank guard. */
export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number" && Number.isNaN(v)) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

export function normalizeDay(raw: unknown): DayCode | null {
  if (isBlank(raw)) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  return DAY_ALIASES[s] ?? null;
}

function tokenToMinutes(h: string, m: string, ap: string): number {
  let hour = parseInt(h, 10);
  const min = parseInt(m, 10);
  const period = ap.toUpperCase();
  if (hour === 12) hour = 0;
  if (period === "PM") hour += 12;
  return (hour % 24) * 60 + min;
}

export interface ParsedTime {
  startMin: number | null;
  endMin: number | null;
  error: TimeError;
}

export function parseTimeRange(raw: unknown): ParsedTime {
  if (isBlank(raw)) return { startMin: null, endMin: null, error: "missing" };
  const s = String(raw).trim();
  if (!s) return { startMin: null, endMin: null, error: "missing" };
  const tokens = [...s.matchAll(TIME_TOKEN_RE)];
  if (tokens.length !== 2) return { startMin: null, endMin: null, error: "unparseable" };
  const startMin = tokenToMinutes(tokens[0][1], tokens[0][2], tokens[0][3]);
  const endMin = tokenToMinutes(tokens[1][1], tokens[1][2], tokens[1][3]);
  if (endMin <= startMin) return { startMin, endMin, error: "end_before_start" };
  return { startMin, endMin, error: null };
}

export function minutesToLabel(mins: number | null): string {
  if (mins === null) return "";
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatTimeRange(startMin: number | null, endMin: number | null): string {
  if (startMin === null || endMin === null) return "";
  return `${minutesToLabel(startMin)} - ${minutesToLabel(endMin)}`;
}

export function normalizeText(raw: unknown): string | null {
  if (isBlank(raw)) return null;
  const s = String(raw).replace(/\s+/g, " ").trim();
  return s || null;
}

export function normalizeLecturer(raw: unknown): string | null {
  const n = normalizeText(raw);
  if (n === null) return null;
  if (UNASSIGNED_TOKENS.has(n.toUpperCase())) return null;
  return n;
}

export function normalizeCode(raw: unknown, upper = true): string | null {
  if (isBlank(raw)) return null;
  let val = raw;
  if (typeof val === "number" && Number.isInteger(val)) {
    val = String(val);
  }
  let s = String(val).trim();
  if (!s) return null;
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
  return upper ? s.toUpperCase() : s;
}

export function normalizeRoom(raw: unknown): { room: string | null; isVirtual: boolean } {
  const code = normalizeCode(raw);
  if (code === null) return { room: null, isVirtual: false };
  if (VIRTUAL_ROOM_TOKENS.has(code)) return { room: code, isVirtual: true };
  return { room: code, isVirtual: false };
}

export function toNumber(raw: unknown): number | null {
  if (isBlank(raw)) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    const v = Number(t);
    return Number.isNaN(v) ? null : v;
  }
  if (typeof raw === "number") return Number.isNaN(raw) ? null : raw;
  const v = Number(raw);
  return Number.isNaN(v) ? null : v;
}

export function daySortKey(day: string | null): number {
  const idx = DAY_ORDER.indexOf(day as DayCode);
  return idx === -1 ? DAY_ORDER.length : idx;
}
