// Canonical domain types for Timetable Manager.

export type DayCode = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export const DAY_ORDER: DayCode[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Full day names, for messages that should read like plain English. */
export const DAY_NAME: Record<DayCode, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

export type TimeError = "missing" | "unparseable" | "end_before_start" | null;

/** Record of the duplicate rows a session absorbed via "merge similar courses". */
export interface MergeInfo {
  rowIds: number[];
  unitCodes: string[];
  unitNames: string[];
  programmes: string[];
  batchCodes: string[];
}

/** One scheduled teaching session, fully normalized. */
export interface Session {
  rowId: number;
  programme: string | null;
  semCode: string | null;
  batchCode: string | null;
  unitCode: string | null;
  unitName: string | null;
  term: string | null;
  day: DayCode | null;
  dayRaw: string | null;
  timeRaw: string | null;
  startMin: number | null; // minutes from midnight
  endMin: number | null;
  timeError: TimeError;
  hoursListed: number | null;
  durationHours: number | null;
  workloadHours: number | null;
  room: string | null;
  isVirtualRoom: boolean;
  capacityListed: number | null;
  lecturer: string | null; // null == unassigned/placeholder
  lecturerRaw: string | null;
  headCount: number | null;
  notes: string | null;
  /** Present when duplicate rows were merged into this one. */
  merged?: MergeInfo;
}

export type CanonicalField =
  | "programme"
  | "semCode"
  | "batchCode"
  | "unitCode"
  | "unitName"
  | "term"
  | "day"
  | "timeRaw"
  | "hours"
  | "room"
  | "capacityListed"
  | "lecturer"
  | "headCount"
  | "notes";

export type ColumnMapping = Partial<Record<CanonicalField, string>>;

export type RoomRegistry = Record<string, number>;
export type RoleRegistry = Record<string, string>;
export type RoleMaxHours = Record<string, number>;
export type DepartmentRegistry = Record<string, string>;

/** Full-Time vs Part-Time. FT have a fixed weekly target; PT are paid hourly. */
export type FacultyType = "FT" | "PT";
export type FacultyTypeRegistry = Record<string, FacultyType>;

export interface Thresholds {
  nearMaxPct: number; // e.g. 0.85
  farUnderPct: number; // e.g. 0.4
  underutilPct: number; // e.g. 0.4
  capacityTolerance: number; // students over capacity allowed
  maxConsecutiveHours: number;
  maxGapMinutes: number;
  maxSessionsPerDay: number; // per-lecturer daily session cap (full-time)
  /** Part-time staff are paid per session, so they may teach more per day. */
  maxSessionsPerDayPartTime: number;
  /** Saturday teaching window (minutes from midnight) — 9:00 AM to 4:00 PM. */
  saturdayStartMin: number;
  saturdayEndMin: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  nearMaxPct: 0.85,
  farUnderPct: 0.4,
  underutilPct: 0.4,
  capacityTolerance: 20,
  maxConsecutiveHours: 6,
  maxGapMinutes: 15,
  maxSessionsPerDay: 3,
  maxSessionsPerDayPartTime: 4,
  saturdayStartMin: 9 * 60,
  saturdayEndMin: 16 * 60,
};

export type ClashType = "room" | "lecturer" | "batch_code";

export interface Clash {
  clashType: ClashType;
  term: string;
  day: DayCode;
  groupValue: string;
  rowId1: number;
  rowId2: number;
  unit1: string;
  unit2: string;
  time1: string;
  time2: string;
  lecturer1: string | null;
  lecturer2: string | null;
  room1: string | null;
  room2: string | null;
}

// Balanced = FT at target; Unbalanced = FT off target (red); Flexible = PT (hourly).
export type WorkloadStatus = "Balanced" | "Unbalanced" | "Flexible";

export interface WorkloadRow {
  lecturer: string;
  term: string;
  totalHours: number;
  sessions: number;
  units: string;
  role: string;
  facultyType: FacultyType;
  maxHours: number;
  remainingHours: number;
  status: WorkloadStatus;
  statusReason: string;
}


export type CapacityStatus =
  | "Over Capacity"
  | "Within Tolerance"
  | "Underutilized"
  | "OK"
  | "Unknown Capacity"
  | "No Headcount Data";

export interface CapacityRow {
  rowId: number;
  term: string | null;
  day: DayCode | null;
  room: string;
  unitCode: string | null;
  unitName: string | null;
  lecturer: string | null;
  headCount: number | null;
  capacityListed: number | null;
  trueCapacity: number | null;
  capacitySource: string;
  capacityStatus: CapacityStatus;
  overBy: number;
  capacityMismatch: boolean;
}

export interface ConsecutiveViolation {
  lecturer: string;
  term: string;
  day: DayCode;
  blockStart: string;
  blockEnd: string;
  consecutiveHours: number;
  sessions: number;
  rowIds: number[];
}

export interface DuplicateGroup {
  term: string;
  day: DayCode;
  time: string;
  room: string;
  lecturer: string;
  unitCode: string;
  count: number;
  rowIds: number[];
}

export interface QualityIssue {
  rowId: number;
  programme: string | null;
  unitCode: string | null;
  day: string | null;
  time: string | null;
  issues: string;
  existingNote: string | null;
}
