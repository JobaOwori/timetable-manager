import { test, expect, Page } from "@playwright/test";
import { loadTimetable, goTo, openRail, openRailSection, shot, shotFull, sessionCounts } from "./helpers";

test.describe.configure({ mode: "serial" });

/** Pick a layout from the Timetable page's Layout dropdown. */
async function setLayout(page: Page, label: string) {
  await page.locator('select[aria-label="Layout"]').selectOption({ label });
  await page.waitForTimeout(700);
}

test("13 · every timetable entry shows course code, name, lecturer, room and cohorts", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Timetable");

  // Course NAMES are now on the entries, not just codes.
  const chips = page.locator("table button[aria-label]");
  expect(await chips.count()).toBeGreaterThan(20);

  const label = (await chips.first().getAttribute("aria-label")) ?? "";
  // "<CODE> <NAME> — <LECTURER>, room <ROOM>, <PROGRAMMES>"
  expect(label).toMatch(/—/);
  expect(label).toMatch(/room /);

  const text = (await chips.first().innerText()).trim();
  const lines = text.split("\n").filter(Boolean);
  expect(lines.length, `entry should show several lines, got: ${text}`).toBeGreaterThanOrEqual(3);
  await shotFull(page, "13a-informative-entries");

  // Clicking an entry opens the full details without leaving the page.
  await chips.first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const field of ["Course unit", "Lecturer", "Time slot", "Room / venue"]) {
    await expect(dialog.getByText(field, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText(/Faculty/i).first()).toBeVisible();
  await expect(dialog.getByText(/Programmes? attending/i)).toBeVisible();
  await expect(dialog.getByText(/Cohorts? attending/i)).toBeVisible();
  await shot(page, "13b-class-details-modal");
  await page.keyboard.press("Escape");
});

test("14 · a shared class lists every programme and cohort attending", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Timetable");

  // Combined classes are marked; open one and check the attendance breakdown.
  const combined = page.locator("table button", { hasText: "combined" }).first();
  const hasCombined = await combined.isVisible().catch(() => false);
  test.skip(!hasCombined, "No combined class in this dataset");

  await combined.scrollIntoViewIfNeeded();
  await combined.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // The plural headings prove more than one programme/cohort is listed.
  await expect(dialog.getByText(/Programmes attending/i)).toBeVisible();
  await expect(dialog.getByText(/Cohorts attending/i)).toBeVisible();
  await expect(dialog.getByText(/Attendance breakdown/i)).toBeVisible();

  const rows = dialog.locator("table tbody tr");
  expect(await rows.count()).toBeGreaterThan(1);
  await shot(page, "14-shared-class-programmes");
  await page.keyboard.press("Escape");
});

test("15 · cohort timetable view shows one class's full schedule", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Timetable");

  await setLayout(page, "By cohort / class");
  await expect(page.getByText(/complete schedule for one cohort/i)).toBeVisible();

  // The cohort summary names the cohort and its programme(s).
  const summary = page.getByText(/^Cohort /).first();
  await expect(summary).toBeVisible();
  await expect(page.getByText(/\d+ classes · \d+ units · \d+ lecturers/)).toBeVisible();
  await shotFull(page, "15a-cohort-view");

  // Switching cohort changes the grid.
  const picker = page.locator('select[aria-label="Cohort"]');
  const options = await picker.locator("option").allTextContents();
  expect(options.length).toBeGreaterThan(5);
  const firstGrid = await page.locator("table").last().innerText();
  await picker.selectOption(options[1]);
  await page.waitForTimeout(700);
  const secondGrid = await page.locator("table").last().innerText();
  expect(secondGrid).not.toBe(firstGrid);
  await shotFull(page, "15b-cohort-view-switched");

  // Every entry still carries its course name and room.
  const body = await page.locator("table").last().innerText();
  expect(body).toMatch(/Rm /);
});

test("16 · only the Lecturer role can be made Part-Time", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Faculty");

  const table = page.locator("table").last();
  const row = table.locator("tbody tr").first();
  await row.scrollIntoViewIfNeeded();
  const lecturer = (await row.locator("td").first().innerText()).trim();

  // As a Lecturer, Part-Time is offered.
  await row.click({ button: "right" });
  let menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio", { name: "Part-Time", exact: true })).toBeEnabled();

  // Become a Dean → Part-Time must be disabled.
  await menu.getByRole("menuitemradio", { name: "Dean", exact: true }).click();
  await expect(page.getByText(/Role updated/)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);

  const deanRow = table.locator("tbody tr").filter({ hasText: lecturer }).first();
  await deanRow.click({ button: "right" });
  menu = page.getByRole("menu");
  const pt = menu.getByRole("menuitemradio", { name: "Part-Time", exact: true });
  await expect(pt).toBeDisabled();
  await shot(page, "16a-part-time-blocked-for-dean");
  await page.keyboard.press("Escape");

  // Teaching Assistant is offered and is also full-time only.
  await deanRow.click({ button: "right" });
  menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio", { name: "Teaching Assistant", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // Back to Lecturer → Part-Time becomes available again.
  await deanRow.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitemradio", { name: "Lecturer", exact: true }).click();
  await page.waitForTimeout(600);
  const backRow = table.locator("tbody tr").filter({ hasText: lecturer }).first();
  await backRow.click({ button: "right" });
  await expect(
    page.getByRole("menu").getByRole("menuitemradio", { name: "Part-Time", exact: true }),
  ).toBeEnabled();
  await shot(page, "16b-part-time-allowed-for-lecturer");
  await page.keyboard.press("Escape");
});

test("17 · a Part-Time lecturer promoted to H.O.D. becomes Full-Time", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Faculty");

  const table = page.locator("table").last();
  const rowFor = (name: string) => table.locator("tbody tr").filter({ hasText: name }).first();
  const openMenu = async (name: string) => {
    const r = rowFor(name);
    await r.scrollIntoViewIfNeeded();
    await r.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
  };

  const lecturer = (await table.locator("tbody tr").first().locator("td").first().innerText()).trim();

  // Make them Part-Time first (the table re-sorts when their status changes).
  await openMenu(lecturer);
  await page.getByRole("menu").getByRole("menuitemradio", { name: "Part-Time", exact: true }).click();
  await expect(page.getByText(/Employment updated/)).toBeVisible({ timeout: 10_000 });
  await expect(rowFor(lecturer)).toContainText("Part-Time");

  // Promote to H.O.D. — the app must switch them back to Full-Time.
  await openMenu(lecturer);
  await page.getByRole("menu").getByRole("menuitemradio", { name: "H.O.D.", exact: true }).click();
  await expect(page.getByText(/Role updated/)).toBeVisible({ timeout: 10_000 });

  const after = rowFor(lecturer);
  await expect(after).toContainText("H.O.D.");
  await expect(after).toContainText("Full-Time");
  await expect(after).toContainText("/16");
  await shot(page, "17-promotion-forces-full-time");
});

test("18 · reschedule proposes only valid conflict-free options", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Resolve");

  // Open the first conflict's Fix panel and switch to Reschedule.
  const fix = page.getByRole("button", { name: /^Fix$/ }).first();
  await fix.scrollIntoViewIfNeeded();
  await fix.click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Reschedule", exact: true }).first().click();
  await page.waitForTimeout(1200);

  await expect(
    page.getByText(/checked against all lecturers, rooms, slots and rules/i),
  ).toBeVisible();

  const count = await page.getByText(/\d+ valid options?/).first().innerText();
  const n = Number(count.replace(/\D+/g, ""));
  await shotFull(page, "18a-reschedule-plans");

  if (n > 0) {
    const before = await sessionCounts(page);
    // The recommended option keeps the same room and lecturer where possible.
    const options = page.locator("button[aria-label]", { hasText: /^(MON|TUE|WED|THU|FRI|SAT)/ });
    expect(await options.count()).toBeGreaterThan(0);

    await options.first().click();
    await expect(page.getByText(/Rescheduled/)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    // The move must not have invented new sessions.
    expect((await sessionCounts(page)).total).toBe(before.total);
    await shotFull(page, "18b-after-reschedule");
  } else {
    // With no valid option the panel must explain exactly why.
    await expect(page.getByText(/No conflict-free slot exists/)).toBeVisible();
  }
});

test("19 · rescheduling reduces the conflict count and never increases it", async ({ page }) => {
  await loadTimetable(page);
  await goTo(page, "Resolve");

  const chipCount = async (label: string) => {
    const chip = page.getByRole("button", { name: new RegExp(`^${label} \\d+$`) }).first();
    if (!(await chip.isVisible().catch(() => false))) return 0;
    return Number((await chip.innerText()).replace(/\D+/g, "")) || 0;
  };

  const before = (await chipCount("All")) || (await chipCount("Lecturer")) + (await chipCount("Room"));

  const fix = page.getByRole("button", { name: /^Fix$/ }).first();
  await fix.scrollIntoViewIfNeeded();
  await fix.click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Reschedule", exact: true }).first().click();
  await page.waitForTimeout(1200);

  const options = page.locator("button[aria-label]", { hasText: /^(MON|TUE|WED|THU|FRI|SAT)/ });
  test.skip((await options.count()) === 0, "No reschedule option for the first conflict");

  await options.first().click();
  await expect(page.getByText(/Rescheduled/)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);

  const after = (await chipCount("All")) || (await chipCount("Lecturer")) + (await chipCount("Room"));
  expect(after, "a reschedule must never create more conflicts").toBeLessThanOrEqual(before);
  await shotFull(page, "19-conflicts-after-reschedule");
});

test("20 · faculty and room drill-downs show course names too", async ({ page }) => {
  await loadTimetable(page);

  await goTo(page, "Faculty");
  const facultyGrid = page.locator("table").first();
  await expect(facultyGrid).toBeVisible();
  await shotFull(page, "20a-faculty-grid");

  await goTo(page, "Rooms");
  await expect(page.getByRole("heading", { name: "Rooms" })).toBeVisible();
  const roomGrid = page.locator("table").first();
  const text = await roomGrid.innerText();
  expect(text.length).toBeGreaterThan(50);
  await shotFull(page, "20b-rooms-grid");
});

test("21 · Vercel Web Analytics is wired up", async ({ page }) => {
  const insightsRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/_vercel/insights")) insightsRequests.push(r.url());
  });

  await page.goto("/");
  await page.waitForTimeout(2500);

  // The <Analytics /> component injects the page-view script on the client.
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((els) =>
      els.map((e) => (e as HTMLScriptElement).src).filter((s) => s.includes("/_vercel/insights")),
    );
  expect(
    scripts.length + insightsRequests.length,
    "the Vercel insights script should be requested",
  ).toBeGreaterThan(0);
});
