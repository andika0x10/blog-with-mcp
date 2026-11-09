import { test, expect } from "@playwright/test";
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${viewport.width}px ${theme}: reading and navigation`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole("heading", { name: "Tentang memperhatikan hal-hal kecil" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("html")).toHaveCSS("background-color", theme === "dark" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)");
      await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}-${theme}.png`), fullPage: true });
      if (viewport.width < 640) {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await expect(page.getByRole("navigation", { name: "Navigasi mobile" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("navigation", { name: "Navigasi mobile" })).toBeHidden();
      }
      await page.getByRole("link", { name: "Tentang memperhatikan hal-hal kecil", exact: true }).click();
      await expect(page.locator(".katex-display")).toBeVisible();
      await expect(page.locator(".hljs-keyword").first()).toBeVisible();
      await expect(page.locator("#waktu-yang-tidak-diisi")).toBeVisible();
      await expect(page.locator(".prose script")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`post-${viewport.width}-${theme}.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
test("search, feeds, keyboard focus, theme persistence, and reduced motion", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/search");
  await page.getByRole("searchbox").fill("roti");
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tentang memperhatikan hal-hal kecil" })).toBeVisible();
  await page.getByLabel("Tema tampilan").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Langsung ke isi" })).toBeFocused();
  expect((await request.get("/rss.xml")).headers()["content-type"]).toContain("application/rss+xml");
  expect(await (await request.get("/sitemap.xml")).text()).toContain("tentang-memperhatikan");
  expect((await request.get("/not-a-real-page")).status()).toBe(404);
  const mcp = await request.post("/mcp", { data: {} });
  expect(mcp.status()).toBe(401);
});
