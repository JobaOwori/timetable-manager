// Free-text search across sessions.
//
// One search box that matches ANY of the fields a scheduler actually looks for
// — unit code/name, lecturer, room, programme, cohort, day, time, term and
// notes — with support for multiple terms (all must match, in any field) and
// "field:value" qualifiers for precise queries such as `room:109 lecturer:tax`.
import { Session } from "./types";
import { departmentFor } from "./departments";
import { DepartmentRegistry } from "./types";

export type SearchField =
  | "unit"
  | "code"
  | "name"
  | "lecturer"
  | "room"
  | "programme"
  | "cohort"
  | "day"
  | "time"
  | "term"
  | "dept"
  | "notes";

export const SEARCH_FIELDS: SearchField[] = [
  "unit", "code", "name", "lecturer", "room", "programme",
  "cohort", "day", "time", "term", "dept", "notes",
];

const FIELD_ALIASES: Record<string, SearchField> = {
  unit: "unit", u: "unit",
  code: "code", unitcode: "code",
  name: "name", unitname: "name", title: "name",
  lecturer: "lecturer", l: "lecturer", staff: "lecturer", faculty: "lecturer",
  room: "room", r: "room", venue: "room",
  programme: "programme", program: "programme", p: "programme",
  cohort: "cohort", batch: "cohort", b: "cohort",
  day: "day", d: "day",
  time: "time", t: "time",
  term: "term",
  dept: "dept", department: "dept",
  note: "notes", notes: "notes", comment: "notes",
};

interface Token {
  field: SearchField | null; // null = match any field
  value: string;
  negated: boolean;
}

/** Split a raw query into tokens, honouring "field:value", quotes and a leading -. */
export function parseQuery(query: string): Token[] {
  const tokens: Token[] = [];
  // "quoted phrase" | field:"quoted phrase" | field:value | bareword
  const re = /(-)?(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi;
  for (const m of query.matchAll(re)) {
    const negated = m[1] === "-";
    const rawField = m[2]?.toLowerCase();
    const value = (m[3] ?? m[4] ?? "").trim().toLowerCase();
    if (!value) continue;
    const field = rawField ? FIELD_ALIASES[rawField] ?? null : null;
    // An unknown qualifier is treated as plain text so nothing silently vanishes.
    tokens.push({
      field,
      value: rawField && !FIELD_ALIASES[rawField] ? `${rawField}:${value}` : value,
      negated,
    });
  }
  return tokens;
}

function fieldValues(
  s: Session,
  field: SearchField,
  departmentRegistry?: DepartmentRegistry,
): string[] {
  switch (field) {
    case "unit": return [s.unitCode, s.unitName].filter(Boolean) as string[];
    case "code": return s.unitCode ? [s.unitCode] : [];
    case "name": return s.unitName ? [s.unitName] : [];
    case "lecturer": return s.lecturer ? [s.lecturer] : [];
    case "room": return s.room ? [s.room] : [];
    case "programme": return s.programme ? [s.programme] : [];
    case "cohort": return [s.batchCode, s.semCode].filter(Boolean) as string[];
    case "day": return [s.day, s.dayRaw].filter(Boolean) as string[];
    case "time": return s.timeRaw ? [s.timeRaw] : [];
    case "term": return s.term ? [s.term] : [];
    case "dept": {
      const d = departmentFor(s.programme, departmentRegistry);
      return d ? [d] : [];
    }
    case "notes": return s.notes ? [s.notes] : [];
  }
}

function haystack(s: Session, departmentRegistry?: DepartmentRegistry): string {
  return SEARCH_FIELDS.flatMap((f) => fieldValues(s, f, departmentRegistry))
    .join(" ")
    .toLowerCase();
}

/** True when `session` satisfies every token in the parsed query. */
export function matchesQuery(
  s: Session,
  tokens: Token[],
  departmentRegistry?: DepartmentRegistry,
): boolean {
  if (tokens.length === 0) return true;
  const all = haystack(s, departmentRegistry);
  return tokens.every((t) => {
    const hit = t.field
      ? fieldValues(s, t.field, departmentRegistry).some((v) => v.toLowerCase().includes(t.value))
      : all.includes(t.value);
    return t.negated ? !hit : hit;
  });
}

/** Filter sessions by a raw query string. An empty query returns everything. */
export function searchSessions(
  sessions: Session[],
  query: string,
  departmentRegistry?: DepartmentRegistry,
): Session[] {
  const q = query.trim();
  if (!q) return sessions;
  const tokens = parseQuery(q);
  if (tokens.length === 0) return sessions;
  return sessions.filter((s) => matchesQuery(s, tokens, departmentRegistry));
}

/** The plain (non-negated, non-qualified-away) terms, for highlighting matches. */
export function highlightTerms(query: string): string[] {
  return [
    ...new Set(
      parseQuery(query)
        .filter((t) => !t.negated && t.value.length > 1)
        .map((t) => t.value),
    ),
  ];
}
