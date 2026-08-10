# End-to-end tests

These specs drive the real app in Chromium via Playwright and assert the
scheduling behaviour end to end.

## The test fixture is not in the repository

The suite runs against a **real university timetable**, which contains staff
names, room assignments and student head counts. That file is deliberately
**not committed** (`e2e/fixtures/` is git-ignored) because this repository is
public.

To run the suite, drop a timetable workbook here:

```
e2e/fixtures/draft-tt-fall-2026.xlsx
```

Any CSV/XLSX the app accepts will do — see the column names in `src/lib/ingest.ts`
(`Programm`, `BATCHCODE`, `UNITCODE`, `UNITNAME`, `TERM`, `WDAY`, `Time`,
`Hours`, `ROOMCODE`, `CAPACITY`, `Faculty`, `Head Count`). The bundled
`public/sample/sample_timetable.xlsx` works too:

```bash
cp public/sample/sample_timetable.xlsx e2e/fixtures/draft-tt-fall-2026.xlsx
```

Note that a few tests assert on richer conditions (combined classes, Saturday
overruns) and will *skip* rather than fail if the supplied file doesn't contain
those cases.

## Running

A production build is roughly 20x faster than `next dev` and is what the
deployed app actually serves:

```bash
pnpm build
npx next start -p 3210                              # terminal 1
E2E_BASE_URL=http://localhost:3210 pnpm test:e2e    # terminal 2
```

`pnpm test:e2e` alone targets `http://localhost:3001` (the default `pnpm dev`
port).

## Screenshots

Each test writes a screenshot to `e2e/shots/`, which is also git-ignored — it is
regenerated output, and the images show real names from the fixture.
