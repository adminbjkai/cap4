import { test, expect } from "@playwright/test";
import { mockApiRoutes, MOCK_VIDEO_ID } from "./mock-api";

const VIDEO_URL = `/video/${MOCK_VIDEO_ID}`;

test.describe("Responsive layout", () => {
  test.beforeEach(async ({ page }) => {
    await mockApiRoutes(page);
  });

  test("desktop 1440px — chapter sidebar visible alongside video", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(VIDEO_URL);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800); // allow React to settle

    // ChapterList sidebar heading (exact match to avoid strict-mode violation)
    await expect(page.getByRole("heading", { name: "Chapters", exact: true })).toBeVisible();

    // Screenshot: full desktop layout
    await page.screenshot({
      path: ".playwright/snapshots/desktop-1440-full-layout.png",
      fullPage: false
    });
  });

  test("tablet 1024px — chapter sidebar appears (lg breakpoint)", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(VIDEO_URL);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);

    await expect(page.getByRole("heading", { name: "Chapters", exact: true })).toBeVisible();

    await page.screenshot({
      path: ".playwright/snapshots/tablet-1024-sidebar-visible.png",
      fullPage: false
    });
  });

  test("mobile 375px — single column layout", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(VIDEO_URL);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);

    // The grid collapses on mobile — chapter sidebar stacks below
    await page.screenshot({
      path: ".playwright/snapshots/mobile-375-stacked.png",
      fullPage: false
    });
  });

  test("just below lg breakpoint (1023px) — single column", async ({ page }) => {
    await page.setViewportSize({ width: 1023, height: 768 });
    await page.goto(VIDEO_URL);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);

    await page.screenshot({
      path: ".playwright/snapshots/below-lg-1023-single-col.png",
      fullPage: false
    });
  });
});

test.describe("Home page", () => {
  test.beforeEach(async ({ page }) => {
    await mockApiRoutes(page);
  });

  test("home page renders at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    await page.screenshot({
      path: ".playwright/snapshots/home-1440.png",
      fullPage: false
    });
  });
});
