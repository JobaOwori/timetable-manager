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
  // "Research Methodology" and "Research Methods" are the same subject.
  methodology: "method",
  methodologies: "method",
};

/**
 * The distinguishing tokens of a unit name: lower-cased, punctuation stripped,
 * abbreviations expanded, qualifier/level words removed and simple plurals
 * folded. Returns an empty set when the name carries no distinguishing tokens.
 */
export function subjectTokens(name: string | null | undefined): Set<string> {
  if (!name) return new Set();
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!cleaned) return new Set();

  const tokens: string[] = [];
  for (const t of cleaned.split(/\s+/)) {
    if (ABBR[t]) tokens.push(...ABBR[t].split(" "));
    else tokens.push(t);
  }

  const meaningful = tokens
    .filter((t) => !STOP.has(t) && !/^\d+$/.test(t))
    // fold simple plurals so "Methods" == "Method", "Systems" == "System"
    .map((t) => (t.endsWith("s") && !t.endsWith("ss") && t.length > 3 ? t.slice(0, -1) : t));

  return new Set(meaningful);
}

/**
 * Canonical "subject family" key for a unit name, or null when the name carries
 * no distinguishing tokens. Two unit names with the same non-null key are the
 * same underlying subject.
 */
export function subjectFamilyKey(name: string | null | undefined): string | null {
  const tokens = [...subjectTokens(name)].sort();
  return tokens.length > 0 ? tokens.join(" ") : null;
}

/** True when two unit names belong to the same equivalent subject group. */
export function sameSubjectFamily(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = subjectFamilyKey(a);
  return ka !== null && ka === subjectFamilyKey(b);
}

export interface SubjectSimilarity {
  /** Jaccard overlap of the distinguishing tokens (0–1). */
  jaccard: number;
  /** Share of the SHORTER name's tokens that also appear in the other (0–1). */
  containment: number;
  /** Overall 0–1 score — the stronger of the two measures. */
  score: number;
  /** True when one name's tokens are entirely contained in the other's. */
  subset: boolean;
}

/**
 * Token-overlap similarity between two unit names. Used (only ever alongside a
 * shared lecturer, room and exact time slot) to recognise near-identical unit
 * titles such as "Research Methods" vs "Business Research Methods" that the
 * strict family key may not collapse.
 */
export function subjectSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): SubjectSimilarity {
  const ta = subjectTokens(a);
  const tb = subjectTokens(b);
  if (ta.size === 0 || tb.size === 0) {
    return { jaccard: 0, containment: 0, score: 0, subset: false };
  }
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = ta.size + tb.size - shared;
  const jaccard = union === 0 ? 0 : shared / union;
  const containment = shared / Math.min(ta.size, tb.size);
  return { jaccard, containment, score: Math.max(jaccard, containment), subset: containment === 1 };
}

/** Minimum token overlap for two differently-titled units to count as related. */
export const SIMILAR_SUBJECT_THRESHOLD = 0.6;

/**
 * True when two unit names are the same subject or a close variant of it —
 * identical family key, one title fully contained in the other, or a token
 * overlap at/above SIMILAR_SUBJECT_THRESHOLD.
 */
export function similarSubject(
  a: string | null | undefined,
  b: string | null | undefined,
  threshold = SIMILAR_SUBJECT_THRESHOLD,
): boolean {
  if (sameSubjectFamily(a, b)) return true;
  const sim = subjectSimilarity(a, b);
  return sim.subset || sim.jaccard >= threshold;
}
