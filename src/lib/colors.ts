// Colour coding for faculties (departments) and programmes.
//
// Every faculty gets a stable hue so the same department is always the same
// colour in tables, filters, the timetable grid and reports. Known faculties get
// hand-picked hues; anything else (custom department codes, individual
// programmes) is hashed deterministically, so a colour never changes between
// renders or reloads.
//
// Only the HUE is emitted inline (as the `--chip-h` custom property); lightness
// and alpha live in globals.css so the same chip reads correctly in BOTH the
// light and dark themes.
import type { CSSProperties } from "react";

/** Hand-picked hues for the institution's standing faculties. */
export const FACULTY_HUES: Record<string, number> = {
  FICT: 212, // blue — Information & Communication Technology
  FBAC: 34, // amber — Business & Commerce
  FHS: 152, // green — Health Science
};

/** Stable, well-distributed hue for any other label. */
function hashHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  // Golden-angle spacing keeps neighbouring labels visually distinct.
  return Math.abs(h * 137) % 360;
}

const cache = new Map<string, number>();

/** Deterministic hue (0–359) for any label — department, programme, room… */
export function hueFor(label: string | null | undefined): number | null {
  const key = (label ?? "").trim().toUpperCase();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const hue = FACULTY_HUES[key] ?? hashHue(key);
  cache.set(key, hue);
  return hue;
}

type HueStyle = CSSProperties & Record<"--chip-h", string>;

/**
 * Inline style carrying the label's hue. Pair with the `chip-color`,
 * `dot-color` or `stripe-color` class from globals.css.
 */
export function hueStyle(label: string | null | undefined): CSSProperties | undefined {
  const hue = hueFor(label);
  if (hue === null) return undefined;
  return { "--chip-h": String(hue) } as HueStyle;
}

/** Props to spread onto a coloured chip/badge element. */
export function chipProps(label: string | null | undefined): {
  style?: CSSProperties;
  className: string;
} {
  const hue = hueFor(label);
  return hue === null
    ? { className: "border-rule text-muted" }
    : { style: hueStyle(label), className: "chip-color" };
}
