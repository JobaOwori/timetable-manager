# TimetableLite

An intelligent university-timetable scheduling assistant — **rebuilt as a modern,
fully client-side Next.js app**. Upload a CSV/XLSX timetable and instantly see room
clashes, lecturer overload/underload, capacity problems and data-quality issues,
then **resolve conflicts in place by transferring sessions to another lecturer or
room**, and export a clean schedule.

Everything runs in your browser — the file never leaves your device, and there is no
backend, no database, and no server round-trips (so no refresh lag).

## Highlights

- **⚡ Instant & private** — the entire analysis engine runs client-side in TypeScript.
  The production build prerenders to static HTML and can be hosted anywhere.
- **🔀 Conflict resolution with lecturer transfer (the headline feature)** — for every
  clash, pick a replacement lecturer from a ranked candidate list. Candidates are
  scored by **availability** (no new clash at that slot), **teaching fit** (already
  teaches the same unit / department), and **remaining workload headroom**, and each
  shows a live *now → after* hours projection and projected status so you never trade
  one clash for another. Room double-bookings can be resolved the same way (move to a
  free, fitting room). One-click **Unassign (TBA)** too.
- **Term isolation** — a mandatory Active-Term switch; Term 1 and Term 2 are analysed
  completely independently (clash detection is term-scoped even internally).
- **Role-based workload** — tag lecturers (Lecturer / H.O.D. / Dean / Lab Assistant /
  DAA / AR) with configurable weekly-hour caps; a 3-tier status (Overloaded /
  Close to Maximum / Balanced).
- **Capacity with tolerance**, **consecutive-teaching-hours**, **duplicate schedules**,
  **invalid/AM-PM-typo hours**, and full **data-quality** checks.
- **Visual timetable grid** (weekly / by day / department / programme / lecturer /
  room) with clash highlighting; **Faculty** and **Room** drill-downs; and
  **Faculty / Room / Programme reports**.
- **Export** to CSV, Excel (multi-sheet), and PDF.
- **Light & dark mode** — an "Academic Ledger" aesthetic (ink-navy + parchment +
  brass; Fraunces serif, JetBrains Mono figures, Public Sans UI) that reads perfectly
  in both themes.

## Getting started

> **Note:** on this machine plain `npm install` hangs at the reify phase — use pnpm
> via corepack instead (it completes in seconds).

```bash
corepack pnpm@9.15.0 install     # or: pnpm install / npm install elsewhere
pnpm dev                          # http://localhost:3000
```

Then click "Load the Fall-2026 sample" to explore immediately with the bundled real
dataset (`public/sample/sample_timetable.xlsx`), or upload your own file from the left
rail.

```bash
pnpm build     # production build (static)
pnpm start     # serve the production build
pnpm test      # vitest engine + parity tests
```

## Architecture

Fully client-side. No API layer — the whole engine is pure TypeScript that the React
components call directly, with a single Zustand store holding state.

```
src/
├── app/                 Next.js App Router (layout, page, globals.css)
├── lib/                 The engine (framework-agnostic, unit-tested)
│   ├── types.ts          Canonical Session + result types, thresholds
│   ├── clean.ts          Normalization (days, times, codes, isBlank)
│   ├── ingest.ts         SheetJS parsing, column auto-map, room-registry parse,
│   │                     canonical Session build, edit finalize
│   ├── roles.ts          Role -> max-hours, 3-tier workload status
│   ├── departments.ts    Programme -> Department (FICT/FBAC/FHS) seed
│   ├── analysis.ts       Term-scoped clashes, workload, capacity, consecutive,
│   │                     duplicates, data quality, Faculty/Room/Programme reports
│   ├── transfer.ts       * Candidate ranking + apply for lecturer/room transfer
│   ├── grid.ts           Day x time grid builder
│   └── export.ts         CSV / Excel (SheetJS) / PDF (jsPDF)
├── store/
│   ├── useStore.ts       Zustand store (sessions, registries, term, filters)
│   └── selectors.ts      Memoized term-scoped + filtered analysis hooks
└── components/
    ├── app-shell.tsx     Nav + landing + page router
    ├── config-rail.tsx   Left rail: upload, term, roles, depts, rooms, thresholds, filters
    ├── theme-*.tsx        next-themes light/dark
    ├── ui/               Card, Button, Badge, Select, DataTable, StatCard, GridView...
    └── pages/            overview - resolve - timetable - faculty - rooms - data
```

### The transfer engine (`lib/transfer.ts`)

`transferCandidates(session, sessions, opts)` returns, for a given session, every
other lecturer ranked for taking it over:

- **available** — has no other session overlapping that term/day/time (a hard filter
  by default; unavailable ones can be revealed with a reason).
- **teachesSameUnit / sameDepartment** — capability heuristics.
- **projectedHours / projectedStatus** — their workload *after* accepting the session,
  using role-based caps; overloading is penalised in the score.

`applyTransfer` / `applyRoomChange` return a new immutable session array (with derived
fields re-finalized), so a transfer that resolves a clash is reflected everywhere
instantly.

## Provenance

This is a from-scratch Next.js rewrite of an earlier Streamlit prototype (kept at
`../TimetableLite`). The analysis engine was ported to TypeScript and validated for
**parity against the original Python engine** using the same real Fall-2026 dataset —
including term-isolation invariants and a cross-check against the source scheduler's
own hand-written "LECTURER TIME CLASHING" annotations (see `tests/sample.test.ts`).

## Testing

`pnpm test` runs 25 vitest tests: normalization edge cases, clash/workload/capacity
logic, the transfer/candidate ranking and clash-resolution behaviour, and an
integration suite that loads the real sample xlsx and asserts parity with the Python
engine's known outputs.
