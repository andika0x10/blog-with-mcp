import { test, expect } from "@playwright/test";

for (const width of [320, 390, 1440]) {
  test(`${width}px: only the name text links home`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/archive");
    const name = page.locator(".site-name");
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeEnabled();
    const points = await name.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return [
        { x: rect.left - 3, y: rect.top + rect.height / 2 },
        { x: rect.right + 3, y: rect.top + rect.height / 2 },
        { x: rect.left + 10, y: rect.top - 3 },
        { x: rect.left + 10, y: rect.bottom + 3 },
      ];
    });
    for (const point of points) {
      expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("a"), point)).toBe(false);
      await page.mouse.click(point.x, point.y);
      await expect(page).toHaveURL(/\/archive$/);
    }
    await name.focus();
    await expect(name).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/archive");
    await name.click();
    await expect(page).toHaveURL(/\/$/);
  });
}

test("dock spacing stays stable through gradual resize", async ({ page }) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  const settings = page.getByRole("button", { name: "Tampilan", exact: true });
  await menu.click();
  await page.locator("#site-menu a").first().focus();
  for (const width of [...Array.from({ length: 71 }, (_, i) => 320 + i * 16), 958, 959, 960, 961, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dock = (await page.locator(".site-header").boundingBox())!;
    const left = (await menu.boundingBox())!;
    const right = (await settings.boundingBox())!;
    expect(left.width).toBe(44);
    expect(right.width).toBe(44);
    expect(right.x - left.x - left.width).toBeCloseTo(8, 1);
    expect(dock.x + dock.width - right.x - right.width).toBeCloseTo(11, 1);
    expect(dock.height).toBe(62);
    expect(dock.y).toBe(826);
    expect(dock.x).toBeGreaterThanOrEqual(12);
    expect(dock.x + dock.width).toBeLessThanOrEqual(width - 12);
    await expect(page.locator("#site-menu a").first()).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

for (const width of [390, 1440]) {
  for (const count of [2, 10, 12]) {
    test(`${width}px: ${count} navigation links fit a short viewport`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 480 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeEnabled();
      await page.locator(".header-panel nav").evaluate((nav, count) => {
        nav.replaceChildren(
          ...Array.from({ length: count }, (_, i) => {
            const a = document.createElement("a");
            a.href = "/archive";
            a.textContent = `Halaman ${i + 1}`;
            return a;
          })
        );
      }, count);
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      const panel = page.locator("#site-menu");
      await expect(panel).toBeVisible();
      const rect = (await panel.boundingBox())!;
      const dock = (await page.locator(".site-header").boundingBox())!;
      expect(rect.y).toBeGreaterThanOrEqual(12);
      expect(dock.y - rect.y - rect.height).toBeCloseTo(10, 1);
      expect(rect.width).toBeCloseTo(dock.width, 1);
      await panel.locator("a").last().scrollIntoViewIfNeeded();
      await expect(panel.locator("a").last()).toBeInViewport();
      await page.screenshot({ path: info.outputPath("menu.png") });
    });
  }
}
