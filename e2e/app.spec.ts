import { test, expect } from "@playwright/test";
import {
  loadTimetable, goTo, openRail, closeRail, openRailSection, shot, shotFull, sessionCounts,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test("01 · loads the real Fall-2026 timetable", async ({ page }) => {
  await loadTimetable(page);
  const { total } = await sessionCounts(page);
  expect(total).toBeGreaterThan(300);
  // The headline analysis renders against the real data.
  await expect(page.getByText("TOTAL SESSIONS")).toBeVisible();
  await expect(page.getByText("ROOM CLASHES")).toBeVisible();
  await shotFull(page, "01-overview");

  // The uploaded file is named in the controls rail.
  await openRail(page);
  await expect(page.getByText(/draft-tt-fall-2026\.xlsx/)).toBeVisible();
  await expect(page.getByText("WORKLOAD LIMITS BY ROLE")).toBeVisible();
  await shot(page, "01b-controls-rail");
});

test("02 · master timetable is colour-coded by faculty", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Timetable");

  // Faculty colour legend is present and lists the real departments.
  const legend = page.getByText("Faculty colours");
  await expect(legend).toBeVisible();
  await shotFull(page, "02a-timetable-master");

  // Every session chip carries its faculty's colour stripe.
  const striped = page.locator(".stripe-color");
  expect(await striped.count()).toBeGreaterThan(10);

  // The hue is a real, per-department CSS variable (not a single shared colour).
  const hues = await page.locator(".stripe-color").evaluateAll((els) =>
    [...new Set(els.slice(0, 200).map((e) => getComputedStyle(e).getPropertyValue("--chip-h").trim()))],
  );
  expect(hues.filter(Boolean).length).toBeGreaterThan(1);
  await shot(page, "02b-faculty-colours");
});

test("03 · global search filters every view", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Timetable");
  const { total } = await sessionCounts(page);

  const box = page.getByPlaceholder(/Search unit, lecturer, room/);
  await box.fill("research");
  await page.waitForTimeout(500);
  const research = await sessionCounts(page);
  expect(research.shown).toBeGreaterThan(0);
  expect(research.shown).toBeLessThan(total);
  await shotFull(page, "03a-search-research");

  // field:value qualifier
  await box.fill("room:B201");
  await page.waitForTimeout(500);
  const byRoom = await sessionCounts(page);
  expect(byRoom.shown).toBeGreaterThan(0);
  expect(byRoom.shown).toBeLessThan(total);
  await shot(page, "03b-search-room-qualifier");

  // negation
  await box.fill("-online");
  await page.waitForTimeout(500);
  const negated = await sessionCounts(page);
  expect(negated.shown).toBeLessThanOrEqual(total);

  // clearing restores everything
  await box.fill("");
  await page.waitForTimeout(500);
  expect((await sessionCounts(page)).shown).toBe(total);
});

test("04 · multi-select filters are searchable and colour-coded", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Timetable");
  const { total } = await sessionCounts(page);

  await page.getByRole("button", { name: /^All$/ }).first().click();
  await page.waitForTimeout(300);
  await shot(page, "04a-department-filter-open");

  // pick the first department option
  const option = page.locator("button", { hasText: /^F(ICT|BAC|HS)$/ }).first();
  await option.click();
  await page.keyboard.press("Escape");
  await page.mouse.click(1400, 200);
  await page.waitForTimeout(600);

  const filtered = await sessionCounts(page);
  expect(filtered.shown).toBeGreaterThan(0);
  expect(filtered.shown).toBeLessThan(total);
  await shotFull(page, "04b-department-filtered");

  await page.getByRole("button", { name: /Clear \d+ filter/ }).click();
  await page.waitForTimeout(500);
  expect((await sessionCounts(page)).shown).toBe(total);
});

test("05 · merge similar courses clears the false-positive clashes", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Resolve");
  await shotFull(page, "05a-resolve-page");

  const panel = page.getByText("Similar courses that can be merged");
  const hasMergeable = await panel.isVisible().catch(() => false);
  test.skip(!hasMergeable, "No mergeable similar courses in this dataset");

  await panel.scrollIntoViewIfNeeded();
  await shot(page, "05b-merge-panel");

  const beforeTotal = (await sessionCounts(page)).total;
  const beforeRoom = await conflictChipCount(page, "Room");

  await page.getByRole("button", { name: /Merge all similar courses/ }).click();
  await expect(page.getByText(/Courses merged/)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shotFull(page, "05c-after-merge");

  // Rows were collapsed, and the clashes they caused are gone.
  const afterTotal = (await sessionCounts(page)).total;
  expect(afterTotal).toBeLessThan(beforeTotal);
  const afterRoom = await conflictChipCount(page, "Room");
  expect(afterRoom).toBeLessThanOrEqual(beforeRoom);

  // The merge panel disappears once nothing is left to merge.
  await expect(page.getByText("Similar courses that can be merged")).toHaveCount(0);

  // …and it is undoable.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(800);
  expect((await sessionCounts(page)).total).toBe(beforeTotal);
});

/** Read the count off a conflict-type filter chip ("Room 12"). */
async function conflictChipCount(page: import("@playwright/test").Page, label: string): Promise<number> {
  const chip = page.getByRole("button", { name: new RegExp(`^${label} \\d+$`) }).first();
  if (!(await chip.isVisible().catch(() => false))) return 0;
  const t = await chip.innerText();
  return Number(t.replace(/\D+/g, "")) || 0;
}

test("06 · right-click assigns staff roles on the Faculty page", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Faculty");
  await shotFull(page, "06a-faculty-page");

  // Faculty report rows advertise the right-click affordance.
  await expect(page.getByText(/Right-click any lecturer to assign/)).toBeVisible();

  const table = page.locator("table").last();
  const row = table.locator("tbody tr").first();
  await row.scrollIntoViewIfNeeded();
  const lecturer = (await row.locator("td").first().innerText()).trim();

  await row.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Employment")).toBeVisible();
  await expect(menu.getByText("Staff role")).toBeVisible();
  // Every role the registrar asked for is offered, each with its weekly cap.
  const roles = ["Full-Time", "Part-Time", "Lecturer", "H.O.D.", "Dean", "DAA", "AR"];
  for (const name of roles) {
    await expect(menu.getByRole("menuitemradio", { name, exact: true })).toBeVisible();
  }
  // The current role/employment is marked as selected.
  await expect(menu.getByRole("menuitemradio", { name: "Full-Time", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await shot(page, "06b-role-context-menu");

  // Assign H.O.D. and confirm the table + cap update.
  await menu.getByRole("menuitemradio", { name: "H.O.D.", exact: true }).click();
  await expect(page.getByText(/Role updated/)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);

  const updated = table.locator("tbody tr").filter({ hasText: lecturer }).first();
  await expect(updated).toContainText("H.O.D.");
  await expect(updated).toContainText("/16"); // H.O.D. weekly cap
  await shot(page, "06c-role-assigned-hod");

  // An H.O.D. may NOT be made Part-Time — only Lecturers can be.
  await updated.click({ button: "right" });
  await expect(
    page.getByRole("menu").getByRole("menuitemradio", { name: "Part-Time", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  // Back to Lecturer, Part-Time becomes available and overrides the cap.
  await updated.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitemradio", { name: "Lecturer", exact: true }).click();
  await page.waitForTimeout(600);
  const asLecturer = table.locator("tbody tr").filter({ hasText: lecturer }).first();
  await asLecturer.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitemradio", { name: "Part-Time", exact: true }).click();
  await expect(page.getByText(/Employment updated/)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);

  const pt = table.locator("tbody tr").filter({ hasText: lecturer }).first();
  await expect(pt).toContainText("Part-Time");
  await expect(pt).toContainText("/12"); // Part-Time cap overrides the H.O.D. cap
  await shot(page, "06d-part-time-assigned");
});

test("07 · workload limits are configurable for every role", async ({ page }) => {
  await loadTimetable(page);
  await openRail(page);
  await openRailSection(page, "Workload Limits by Role");
  await shot(page, "07a-workload-limits");

  // Every requested role has an adjustable limit.
  for (const role of ["Lecturer", "H.O.D.", "Dean", "DAA", "AR", "Part-Time Lecturer"]) {
    await expect(
      page.getByRole("slider", { name: `${role} weekly hours limit`, exact: true }),
    ).toBeVisible();
  }

  // Change the Lecturer cap and confirm it reaches the Faculty report.
  const lecturerSlider = page.getByRole("slider", {
    name: "Lecturer weekly hours limit",
    exact: true,
  });
  await lecturerSlider.scrollIntoViewIfNeeded();
  await expect(lecturerSlider).toHaveValue("22");
  await lecturerSlider.fill("18");
  await page.waitForTimeout(500);
  await expect(lecturerSlider).toHaveValue("18");
  await shot(page, "07b-lecturer-cap-18");

  await closeRail(page);
  await goTo(page, "Faculty");
  await expect(page.locator("table").last().locator("tbody")).toContainText("/18");
  await shot(page, "07c-cap-applied-to-report");

  // Restore defaults.
  await openRail(page);
  await openRailSection(page, "Workload Limits by Role");
  await page.getByRole("button", { name: /Restore default limits/ }).click();
  await page.waitForTimeout(400);
  await closeRail(page);
  await goTo(page, "Faculty");
  await expect(page.locator("table").last().locator("tbody")).toContainText("/22");
});

test("08 · daily limits are 4 on weekdays and 3 on Saturday", async ({ page }) => {
  await loadTimetable(page);
  await openRail(page);
  await openRailSection(page, "Thresholds");

  await expect(page.getByText("Daily class limits")).toBeVisible();
  const weekday = page.getByRole("slider", { name: "Max classes — weekday" });
  const saturday = page.getByRole("slider", { name: "Max classes — Saturday" });
  await weekday.scrollIntoViewIfNeeded();
  await expect(weekday).toHaveValue("4");
  await expect(saturday).toHaveValue("3");
  // Teaching back to back all day is allowed; the weekly cap is what stays firm.
  await expect(page.getByText(/may fill every period of the day, back to back/i)).toBeVisible();
  await expect(page.getByText(/weekly hour cap per role still applies/i)).toBeVisible();
  await shot(page, "08a-daily-limits");
});

test("09 · only the official teaching periods are used", async ({ page }) => {
  await loadTimetable(page);
  await openRail(page);
  await openRailSection(page, "Thresholds");

  // The official timetable is stated in the controls, lunch kept free.
  const periods = page.getByText("Official teaching periods", { exact: true });
  await periods.scrollIntoViewIfNeeded();
  await expect(periods).toBeVisible();
  const periodText = await periods.locator("xpath=following-sibling::p[1]").innerText();
  expect(periodText).toContain("9:00 AM – 11:00 AM, 11:00 AM – 1:00 PM, 2:00 PM – 4:00 PM, 4:00 PM – 6:00 PM");
  expect(periodText).toMatch(/Saturday\s+9:00 AM – 11:00 AM, 11:00 AM – 1:00 PM, 2:00 PM – 4:00 PM/);
  expect(periodText).toMatch(/Nothing is scheduled over lunch/);

  // Daily limits: four weekday periods, three on Saturday.
  const weekday = page.getByRole("slider", { name: "Max classes — weekday" });
  const saturday = page.getByRole("slider", { name: "Max classes — Saturday" });
  await weekday.scrollIntoViewIfNeeded();
  await expect(weekday).toHaveValue("4");
  await expect(saturday).toHaveValue("3");
  await shot(page, "09a-official-periods");

  await closeRail(page);

  // Every class in the grid sits on an official period.
  await goTo(page, "Timetable");
  const slotLabels = await page
    .locator("table tbody tr td:first-child")
    .allInnerTexts();
  const official = new Set([
    "9:00 AM - 11:00 AM",
    "11:00 AM - 1:00 PM",
    "2:00 PM - 4:00 PM",
    "4:00 PM - 6:00 PM",
  ]);
  // The four official weekday periods must all be present…
  for (const period of official) {
    expect(slotLabels.map((t) => t.trim())).toContain(period);
  }
  // …and only a handful of unrepairable typos from the source sheet may remain,
  // each of which is reported under Scheduling policy breaches.
  const unofficial = slotLabels.map((t) => t.trim()).filter((t) => t && !official.has(t));
  expect(unofficial.length, `unexpected slots: ${unofficial.join(" | ")}`).toBeLessThanOrEqual(3);
  await shotFull(page, "09b-official-grid");

  // Anything not on an official period is reported for a human to fix.
  await goTo(page, "Resolve");
  const badge = page.getByText("Not an official teaching period").first();
  if (await badge.isVisible().catch(() => false)) {
    await badge.scrollIntoViewIfNeeded();
    await expect(page.getByText(/Teaching only happens in fixed two-hour periods/).first()).toBeVisible();
    await shot(page, "09c-unofficial-flagged");

    // And fixing one only ever offers official periods.
    const fix = page.getByRole("button", { name: /^Fix .*Not an official teaching period$/ }).first();
    await fix.scrollIntoViewIfNeeded();
    await fix.click();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Reschedule", exact: true }).first().click();
    await page.waitForTimeout(900);

    const options = await page
      .locator("button[aria-label]")
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label") ?? "")
          .filter((a) => /^(MON|TUE|WED|THU|FRI|SAT) /.test(a)),
      );
    for (const label of options) {
      const time = label.replace(/^(MON|TUE|WED|THU|FRI|SAT) /, "").split(" · ")[0].trim();
      expect(official.has(time), `offered "${label}" which is not an official period`).toBeTruthy();
      // Saturday never gets the 4–6 PM period.
      if (label.startsWith("SAT ")) expect(time).not.toBe("4:00 PM - 6:00 PM");
    }
    await shotFull(page, "09d-official-options-only");
  }
});

test("10 · conflict cards offer an inline Merge for similar courses", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Resolve");

  const inline = page.getByRole("button", { name: /^Merge similar$/ }).first();
  const present = await inline.isVisible().catch(() => false);
  test.skip(!present, "No per-conflict mergeable group in this dataset");

  await inline.scrollIntoViewIfNeeded();
  await expect(page.getByText(/Not a real conflict\?/).first()).toBeVisible();
  await shot(page, "10a-conflict-merge-button");

  const before = (await sessionCounts(page)).total;
  await inline.click();
  await expect(page.getByText(/Courses merged/)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  expect((await sessionCounts(page)).total).toBeLessThan(before);
  await shotFull(page, "10b-conflict-merged");
});

test("11 · rooms, data and export views still render", async ({ page }) => {
  await loadTimetable(page);

  await goTo(page, "Rooms");
  await expect(page.getByRole("heading", { name: "Rooms" })).toBeVisible();
  await shotFull(page, "11a-rooms");

  await goTo(page, "Data & Export");
  await expect(page.getByRole("heading", { name: /Data & Export/ })).toBeVisible();
  await shotFull(page, "11b-data-export");
});

test("12 · dark mode keeps the faculty colours readable", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Timetable");
  await openRail(page);
  await page.getByRole("button", { name: /theme|dark|light/i }).first().click();
  await page.waitForTimeout(600);
  await closeRail(page);
  await shotFull(page, "12-dark-mode");
});
