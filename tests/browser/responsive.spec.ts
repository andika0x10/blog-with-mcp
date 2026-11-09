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
        {
          const before = await page.locator("main").boundingBox();
          const menu = page.getByRole("button", { name: "Menu", exact: true });
          await expect(menu).toBeVisible();
          await menu.click();
          await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
          const after = await page.locator("main").boundingBox();
          expect(after!.y).toBe(before!.y);
          await page.getByRole("button", { name: "Tampilan", exact: true }).click();
          const panel = await page.locator("#appearance-panel").boundingBox();
          expect(panel!.x).toBeGreaterThanOrEqual(0);
          expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
          await expect(page.getByLabel("Tema tampilan")).toHaveCSS("font-size", "16px");
          await page.keyboard.press("Escape");
          await expect(page.getByRole("button", { name: "Tampilan", exact: true })).toBeFocused();
          await expect(page.locator("#site-menu")).toBeHidden();
        }
        if (!route.includes("?")) {
          const name = route === "/" ? "home" : route.startsWith("/preview/") ? "preview" : route.replaceAll("/", "-").slice(1);
          await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
        }
        if (route === "/uji-responsif") {
          for (const selector of [".table-scroll", ".code-block pre", ".katex-display"]) {
            await expect(page.locator(selector)).toHaveCount(selector === ".code-block pre" ? 4 : 1);
            for (const element of await page.locator(selector).all()) await expect(element).toHaveCSS("overflow-x", "auto");
          }
        }
        if (route.startsWith("/preview/")) await expect(page.locator(".preview-notice")).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }
}

test("menu preserves focus through resize and handles panel switching and navigation", async ({ page }) => {
  await page.setViewportSize({ width: 959, height: 900 });
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  const appearance = page.getByRole("button", { name: "Tampilan", exact: true });
  await menu.click();
  await appearance.click();
  await expect(page.locator("#site-menu")).toBeHidden();
  await page.getByLabel("Font", { exact: true }).focus();
  await page.setViewportSize({ width: 960, height: 900 });
  await expect(page.locator("#appearance-panel")).toBeVisible();
  await expect(page.getByLabel("Font", { exact: true })).toBeFocused();
  await menu.click();
  await expect(page.locator("#appearance-panel")).toBeHidden();
  const archive = page.getByRole("link", { name: "Arsip", exact: true });
  await archive.focus();
  for (const width of [959, 960, 1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(archive).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(page.locator("#site-menu")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(appearance).toBeFocused();
  await menu.click();
  await page.locator("main").click({ position: { x: 1, y: 1 } });
  await expect(page.locator("#site-menu")).toBeHidden();
  await menu.click();
  await archive.click();
  await expect(page).toHaveURL(/\/archive$/);
  await expect(page.locator("#site-menu")).toBeHidden();
});

test("long names, navigation labels, and footer text wrap at every breakpoint", async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Tampilan", exact: true })).toBeEnabled();
    await page.locator(".site-name").evaluate((element) => (element.textContent = "Nama blog panjang ".repeat(7)));
    await page.getByRole("button", { name: "Menu", exact: true }).click();
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
    const dock = (await page.locator(".site-header").boundingBox())!;
    expect(dock.height).toBeLessThanOrEqual(120);
    expect((await page.locator(".site-name").boundingBox())!.width).toBeGreaterThan(40);
    {
      const panel = (await page.locator("#site-menu").boundingBox())!;
      expect(panel.y).toBeGreaterThanOrEqual(12);
      await page.locator("#site-menu a").last().scrollIntoViewIfNeeded();
      await expect(page.locator("#site-menu a").last()).toBeInViewport();
    }
  }
});

for (const width of widths) {
  test(`${width}px: dock stays fixed and panels fit a short viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 480 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Tampilan", exact: true })).toBeEnabled();
    const dock = page.locator(".site-header");
    await expect(dock).toHaveCSS("position", "fixed");
    const before = (await dock.boundingBox())!;
    expect(before.x).toBeGreaterThanOrEqual(12);
    expect(before.x + before.width).toBeLessThanOrEqual(width - 12);
    expect(before.height).toBeLessThanOrEqual(120);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const after = (await dock.boundingBox())!;
    expect(after.y).toBeCloseTo(before.y);
    const footer = (await page.locator(".site-footer").boundingBox())!;
    // The browser rounds the final scroll position to a device pixel.
    expect(footer.y + footer.height).toBeLessThanOrEqual(after.y - 23);
    {
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      const menu = (await page.locator("#site-menu").boundingBox())!;
      expect(menu.y).toBeGreaterThanOrEqual(12);
      expect(menu.y + menu.height).toBeLessThanOrEqual(after.y - 9);
    }
    await page.getByRole("button", { name: "Tampilan", exact: true }).click();
    const panel = (await page.locator("#appearance-panel").boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(12);
    expect(panel.y + panel.height).toBeLessThanOrEqual(after.y - 9);
    expect(panel.x).toBeGreaterThanOrEqual(12);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width - 12);
    await page.getByLabel("Font", { exact: true }).selectOption("literata");
    await page.getByLabel("Font", { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByLabel("Font", { exact: true })).toBeInViewport();
  });
}
