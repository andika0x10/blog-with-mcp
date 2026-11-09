import { test, expect } from "@playwright/test";

const widths = [320, 390, 768, 959, 960, 1440];
for (const width of widths) {
  for (const theme of ["light", "dark"] as const) {
    test(`${width}px ${theme}: all page layouts stay contained`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const route of [
        "/",
        "/?page=2",
        "/archive",
        "/search",
        "/search?q=roti",
        "/search?q=" + "panjang".repeat(28),
        "/posts/tentang-memperhatikan",
        "/uji-responsif",
        "/preview/" + "a".repeat(64),
        "/halaman-tidak-ada",
      ]) {
        await page.goto(route);
        await expect(page.locator("main h1").first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
        if (width < 960) {
          const before = await page.locator("main").boundingBox();
          const menu = page.getByRole("button", { name: "Menu", exact: true });
          await expect(menu).toBeVisible();
          await menu.click();
          await expect(page.getByRole("navigation", { name: "Navigasi mobile" })).toBeVisible();
          const after = await page.locator("main").boundingBox();
          expect(after!.y).toBeGreaterThan(before!.y);
          await page.getByRole("button", { name: "Tampilan", exact: true }).click();
          const panel = await page.locator("#appearance-panel").boundingBox();
          expect(panel!.x).toBeGreaterThanOrEqual(0);
          expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
          await expect(page.getByLabel("Tema tampilan")).toHaveCSS("font-size", "16px");
          await page.keyboard.press("Escape");
          await expect(page.getByRole("button", { name: "Tampilan", exact: true })).toBeFocused();
          await expect(page.locator("#mobile-menu")).toBeHidden();
        } else {
          await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeHidden();
          await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
        }
        if (["/", "/uji-responsif"].includes(route)) {
          await page.screenshot({ path: info.outputPath(route === "/" ? "home.png" : "content.png"), fullPage: true });
        }
        if (route === "/uji-responsif") {
          for (const selector of [".table-scroll", ".code-block pre", ".katex-display"]) {
            await expect(page.locator(selector)).toHaveCount(1);
            await expect(page.locator(selector)).toHaveCSS("overflow-x", "auto");
          }
        }
        if (route.startsWith("/preview/")) await expect(page.locator(".preview-notice")).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }
}

test("menu handles outside clicks, navigation, and breakpoint changes without stale focus", async ({ page }) => {
  await page.setViewportSize({ width: 959, height: 900 });
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.click();
  await page.getByRole("button", { name: "Tampilan", exact: true }).click();
  await page.getByLabel("Font", { exact: true }).focus();
  await page.setViewportSize({ width: 960, height: 900 });
  await expect(page.locator("#appearance-panel")).toBeHidden();
  await expect(page.getByRole("button", { name: "Tampilan", exact: true })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
  await page.getByRole("link", { name: "Arsip", exact: true }).focus();
  await page.setViewportSize({ width: 959, height: 900 });
  await expect(menu).toBeFocused();
  await expect(page.locator("#mobile-menu")).toBeHidden();
  await page.setViewportSize({ width: 960, height: 900 });
  await expect(page.getByRole("link", { name: "Arsip", exact: true })).toBeFocused();
  await page.setViewportSize({ width: 959, height: 900 });
  await expect(menu).toBeFocused();
  await menu.click();
  await page.locator("main").click({ position: { x: 1, y: 1 } });
  await expect(page.locator("#mobile-menu")).toBeHidden();
  await menu.click();
  await page.getByRole("link", { name: "Arsip", exact: true }).click();
  await expect(page).toHaveURL(/\/archive$/);
  await expect(page.locator("#mobile-menu")).toBeHidden();
});

test("long names, navigation labels, and footer text wrap at every breakpoint", async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.locator(".site-name").evaluate((element) => (element.textContent = "Nama blog panjang ".repeat(7)));
    if (width < 960) await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.locator(".header-panel nav").evaluate((element) => {
      element.replaceChildren(
        ...Array.from({ length: 12 }, () => {
          const link = document.createElement("a");
          link.href = "/archive";
          link.textContent = "Navigasi".repeat(10);
          return link;
        })
      );
    });
    await page.locator(".site-footer p").evaluate((element) => (element.textContent = "Footer".repeat(100)));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
