import { Page, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const FIXTURE = path.join(__dirname, "fixtures", "draft-tt-fall-2026.xlsx");
export const SHOTS = path.join(__dirname, "shots");

/** Upload the real Fall-2026 timetable and wait for the analysis to appear. */
export async function loadTimetable(page: Page) {
  if (!fs.existsSync(FIXTURE)) {
    throw new Error(
      `Missing e2e fixture: ${FIXTURE}\n` +
        "It is git-ignored because it contains real staff/student data. " +
        "See e2e/README.md — e.g. `cp public/sample/sample_timetable.xlsx " +
        `${FIXTURE}\``,
    );
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  // The nav only renders once sessions are in the store.
  await expect(
    page.locator("header").getByRole("button", { name: "Resolve", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("text=/Term \\d+ · \\d+\\/\\d+ sessions/")).toBeVisible();
}

/** Switch to a top-level tab. Scoped to the header so it never collides with
 *  in-page controls that happen to share a label (e.g. the "Resolve" action on
 *  a clashing class in the master timetable). */
export async function goTo(page: Page, tab: string) {
  await page.locator("header").getByRole("button", { name: tab, exact: true }).click();
  await page.waitForTimeout(600);
}

/** Open (pin) the left controls rail. */
export async function openRail(page: Page) {
  const tab = page.getByRole("button", { name: /controls sidebar/i });
  if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click();
  await expect(page.getByPlaceholder("Search everything…")).toBeVisible();
}

export async function closeRail(page: Page) {
  const tab = page.getByRole("button", { name: /controls sidebar/i });
  if ((await tab.getAttribute("aria-expanded")) === "true") await tab.click();
  await page.mouse.move(1200, 600);
  await page.waitForTimeout(400);
}

/** Expand a collapsible section in the controls rail (idempotent). */
export async function openRailSection(page: Page, title: string) {
  const header = page.getByRole("button", { name: new RegExp(title, "i") }).first();
  await header.scrollIntoViewIfNeeded();
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(300);
}

export async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

export async function shotFull(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** The "N/M sessions" counter in the top-right of the nav. */
export async function sessionCounts(page: Page): Promise<{ shown: number; total: number }> {
  const text = (await page.locator("text=/Term .* sessions/").first().innerText()).trim();
  const m = text.match(/(\d+)\/(\d+) sessions/);
  if (!m) throw new Error(`Could not parse session counter from "${text}"`);
  return { shown: Number(m[1]), total: Number(m[2]) };
}
