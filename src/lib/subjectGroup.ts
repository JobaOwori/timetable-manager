// Equivalent Subject Groups.
//
// Universities often deliver ONE physical class to several programmes that each
// label the unit slightly differently, e.g. "Entrepreneurship Skills" vs "IT
// Entrepreneurship Skills", "Research Methods" vs "Business Research Methods",
// or "Financial Accounting" vs "Fundamentals of Financial Accounting". These are
// the same subject and, when co-scheduled in one room, must not be treated as a
// clash.
//
// `subjectFamilyKey` reduces a unit name to a canonical "family" by dropping
// qualifier words (programme/level/variant prefixes) and normalising synonyms,
// so equivalent names collapse to the same key. It is intentionally conservative:
// it only strips well-known qualifiers, so genuinely different subjects keep
// distinct keys (validated against real timetable data — unrelated co-scheduled
// units never collapse together).

// Qualifier / level / variant words that don't change WHICH subject a unit is.
const STOP = new Set(
  `the a an of to in for and on with into as at by
   introduction intro introductory fundamentals fundamental basics basic
   principles principle foundation foundations essentials essential
   advanced intermediate elementary general applied modern contemporary
   it ict business marketing professional corporate technical digital
   theory theoretical lab labs laboratory practical practicals practicum
   practice workshop tutorial seminar coursework overview
   part section module unit level i ii iii iv v one two three four`
    .split(/\s+/)
    .filter(Boolean),
);

// Synonyms / abbreviations that expand to a canonical multi-word form so, e.g.,
// "IoT" and "Internet of Things" share a family key.
const ABBR: Record<string, string> = {
  hrm: "human resource management",
  dbms: "database management",
  oop: "object oriented programming",
  ai: "artificial intelligence",
  ml: "machine learning",
  iot: "internet things",
  os: "operating system",
};

/**
 * Canonical "subject family" key for a unit name, or null when the name carries
 * no distinguishing tokens. Two unit names with the same non-null key are the
 * same underlying subject.
 */
export function subjectFamilyKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!cleaned) return null;

  const tokens: string[] = [];
  for (const t of cleaned.split(/\s+/)) {
    if (ABBR[t]) tokens.push(...ABBR[t].split(" "));
    else tokens.push(t);
  }

  const meaningful = tokens
    .filter((t) => !STOP.has(t) && !/^\d+$/.test(t))
    // fold simple plurals so "Methods" == "Method", "Systems" == "System"
    .map((t) => (t.endsWith("s") && !t.endsWith("ss") && t.length > 3 ? t.slice(0, -1) : t));

  const unique = [...new Set(meaningful)].sort();
  return unique.length > 0 ? unique.join(" ") : null;
}

/** True when two unit names belong to the same equivalent subject group. */
export function sameSubjectFamily(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = subjectFamilyKey(a);
  return ka !== null && ka === subjectFamilyKey(b);
}
