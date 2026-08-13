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
- **🔗 Merge similar courses** — one physical class is often listed once per programme
  under a slightly different title ("Research Methods" / "Business Research Methods" /
  "Research Methodology"). Those rows are never reported as clashes, and a **Merge**
  button (per conflict, or *Merge all similar courses*) collapses each group into a
  single session carrying the combined enrolment — clearing the conflict for good.
  Merging is refused for anything that is a genuine double-booking, and is undoable.
- **Term isolation** — a mandatory Active-Term switch; Term 1 and Term 2 are analysed
  completely independently (clash detection is term-scoped even internally).
- **Role-based workload** — tag staff (Lecturer / H.O.D. / Dean / Lab Assistant /
  Teaching Assistant / DAA / AR) and their Full-Time / Part-Time status. **Right-click
  any lecturer** on the Faculty page to assign both in place. **Only a Lecturer may be
  Part-Time** — every other academic role is a substantive full-time appointment, so
  the Part-Time option is disabled for them and promoting a part-timer to H.O.D. moves
  them back to Full-Time automatically. Every role's weekly-hour cap is adjustable in
  *Workload Limits by Role* and persists across reloads.
- **📐 Official teaching periods** — teaching runs in fixed two-hour periods with
  lunch kept free: **Mon–Fri 9–11, 11–1, 2–4, 4–6** and **Saturday 9–11, 11–1, 2–4**.
  Imported times are folded onto the period they mean ("9:00AM - 10:55AM", "11:05AM
  - 1:00PM", even an unambiguous "2:00 AM - 3:55 PM" AM/PM slip), and anything that
  genuinely isn't a period — a lunch-hour class, a 5:45 PM start — is reported rather
  than silently moved. Rescheduling only ever offers official periods.
- **Daily class limits** — a lecturer may take up to **4 classes on a weekday** and
  **3 on Saturday**, back to back if need be; that is simply every period the day has.
  The weekly hour cap per role is **never** relaxed.
- **📅 Informative timetable entries** — every class shows its **course code, course
  name, lecturer, room, and all attending programmes and cohorts** right in the grid,
  colour-coded by faculty. Click any entry for the full details (including a per-cohort
  attendance breakdown for shared lectures) without leaving the page.
- **Cohort / class timetables** — view the complete weekly schedule for any single
  cohort, alongside the by-lecturer, by-room, by-programme and by-faculty views, with a
  summary of their classes, units, lecturers and weekly hours.
- **🔁 Reliable rescheduling** — the planner searches every day, time slot, room and
  (as a last resort) lecturer, validating each combination against *all* rules before
  offering it, so only genuinely conflict-free options appear. It prefers the smallest
  change (same room and lecturer first), never lets a pre-existing, unrelated breach
  veto a valid fix, and when nothing works it names the exact blocker.
- **Saturday** — three periods, finishing at **4:00 PM**. There is no Saturday 4–6.
- **Search & filtering** — one search box across unit code/name, lecturer, room,
  programme, cohort, day, time and notes, with `field:value` qualifiers
  (`room:109`, `lecturer:tax`), `"quoted phrases"` and `-exclusions`; plus searchable,
  colour-coded multi-select filters.
- **Faculty colour coding** — every faculty/department keeps one stable hue across
  tables, filters, badges and the timetable grid, in both light and dark themes.
- **Capacity with tolerance**, **consecutive-teaching-hours**, **duplicate schedules**,
  **invalid/AM-PM-typo hours**, and full **data-quality** checks.
- **Visual timetable grid** (weekly / by day / department / programme / lecturer /
  room) with clash highlighting; **Faculty** and **Room** drill-downs; and
  **Faculty / Room / Programme reports**.
- **Export** to CSV, Excel (multi-sheet), and PDF.
- **Vercel Web Analytics** — anonymous page-view counts only (`@vercel/analytics`).
  The uploaded timetable is still parsed entirely in the browser and never leaves the
  device, so no schedule, staff or student data is ever sent anywhere.
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
pnpm test:e2e  # playwright end-to-end run (needs pnpm dev running)
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
│   ├── roles.ts          Role -> max-hours; only a Lecturer may be Part-Time
│   ├── facultyType.ts    FT/PT model, programme level, Friday block
│   ├── slots.ts          The official teaching periods + snapping messy times
│   ├── classDetails.ts   Full class description: programmes + cohorts attending
│   ├── subjectGroup.ts   Equivalent-subject families + title similarity
│   ├── sharedClass.ts    Combined/shared-class detection (clash suppression)
│   ├── merge.ts          * Mergeable duplicate-row groups + merge application
│   ├── search.ts         Free-text search with field:value qualifiers
│   ├── colors.ts         Stable faculty/department hues
│   ├── departments.ts    Programme -> Department (FICT/FBAC/FHS) seed
│   ├── validate.ts       Single source of truth for "can this session live here?"
│   ├── analysis.ts       Term-scoped clashes, workload, capacity, consecutive,
│   │                     duplicates, data quality, Faculty/Room/Programme reports
│   ├── transfer.ts       * Candidate ranking + the fully-validated reschedule planner
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

This is a from-scratch Next.js rewrite of an earlier Streamlit prototype (since
removed). The analysis engine was ported to TypeScript and validated for
**parity against the original Python engine** using the same real Fall-2026 dataset —
including term-isolation invariants and a cross-check against the source scheduler's
own hand-written "LECTURER TIME CLASHING" annotations (see `tests/sample.test.ts`).

## Testing

`pnpm test` runs 156 vitest tests: normalization edge cases, clash/workload/capacity
logic, equivalent-subject and merge behaviour, the scheduling policies (Saturday
window, per-role caps, full-time vs part-time daily limits), search parsing, the
transfer/candidate ranking, the reschedule planner (validity, minimal-change ranking
and blocker explanations), cohort views and class-detail aggregation, and an
integration suite that loads the real sample xlsx and asserts parity with the Python
engine's outputs.

`pnpm test:e2e` runs 22 Playwright end-to-end tests against a running server. They
upload the **real 980-session Fall-2026 workbook** (`e2e/fixtures/`) and drive the app
as a scheduler would — search and filtering, faculty colour coding, merging similar
courses, right-click role assignment, the Part-Time restriction, the configurable role
and daily limits, the Saturday 9 AM–4 PM policy, informative timetable entries, class
details, cohort timetables, rescheduling, analytics wiring and dark mode — writing a
screenshot of each step to `e2e/shots/`.

```bash
pnpm build && npx next start -p 3210      # terminal 1 (fastest, most representative)
E2E_BASE_URL=http://localhost:3210 pnpm test:e2e   # terminal 2
```

`pnpm dev` works too, but a production build makes the suite roughly 20x faster.
