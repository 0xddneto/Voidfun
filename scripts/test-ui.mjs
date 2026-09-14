import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3050");
  await page
    .getByRole("heading", { name: "Small beginnings. Big possibilities." })
    .waitFor();
  await page.screenshot({
    path: "verification/explore-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create your token" }).click();
  await page.getByLabel("Token name", { exact: true }).fill("My token");
  await page.getByLabel("Ticker", { exact: true }).fill("TEST");
  await page.getByRole("checkbox").check();
  await expect(
    page.getByRole("button", { name: "Create token ↗", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await expect(page.getByText("0 ETH", { exact: true })).toBeVisible();
  await expect(page.getByText("1%", { exact: true })).toBeVisible();
  assert(
    !(await page.getByText("No opening penalty", { exact: false }).count()),
  );
  await page.screenshot({
    path: "verification/create-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "verification/create-mobile.png",
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS desktop/mobile UI, no overflow or runtime errors, live on-chain fees and creation button enabled",
  );
} finally {
  await browser.close();
}
