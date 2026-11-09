import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function animationChunk() {
  if (process.env.PLAYWRIGHT_PRODUCTION !== "1") return "**/components/motion.tsx*";
  const manifest = JSON.parse(await readFile(".cloudflare/output/v0/workers/default/assets/.vite/manifest.json", "utf8"));
  return `**/${manifest["components/motion.tsx"].file}*`;
}
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
      {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeHidden();
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
  await page.getByRole("button", { name: "Tampilan", exact: true }).click();
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

test("menu reverses safely and closed links leave the keyboard order", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Menu", exact: true });
  await toggle.click();
  await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Tampilan", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#site-menu a").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(page.locator("#site-menu")).toHaveAttribute("inert", "");
  await expect(page.locator("#site-menu")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(page.locator("#site-menu a").first()).not.toBeFocused();
});

test("query changes, pagination, and history preserve usable content", async ({ page }) => {
  await page.goto("/search?q=roti");
  await expect(page.locator(".post-list h2")).toHaveCount(1);
  await page.getByRole("searchbox").fill("meja");
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Menyisakan ruang untuk berpikir" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Tentang memperhatikan hal-hal kecil" })).toBeVisible();
  await page.goto("/?page=2");
  await expect(page.getByText("Tidak ada tulisan di halaman ini.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Lebih baru", exact: true }).click();
  await expect(page.locator(".post-list h2").first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 450));
  const scroll = await page.evaluate(() => scrollY);
  await page.locator(".post-list h2 a").nth(2).click();
  await expect(page.locator(".article-header h1")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".post-list h2").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, -1);
  await expect(page.locator(".motion-line")).toHaveCount(0);
});

test("motion preference changes keep the open menu and headings usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/posts/tentang-memperhatikan");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".motion-line")).toHaveCount(0);
  await expect(page.locator(".article-header h1")).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#site-menu")).toBeHidden();
});

test("multiline title links respond to keyboard focus without changing layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const link = page.locator(".post-list h2 a").first();
  const initial = await link.boundingBox();
  await link.focus();
  await expect(link).toBeFocused();
  await expect.poll(() => link.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--link-reveal")))).toBe(100);
  const focused = await link.boundingBox();
  expect(focused?.height).toBe(initial?.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".site-name").focus();
  await expect.poll(() => link.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--link-reveal")))).toBe(0);
});

test("server content remains readable without JavaScript and at article anchors", async ({ browser, page }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await context.newPage();
  await staticPage.goto("/posts/tentang-memperhatikan");
  await expect(staticPage.locator(".article-header h1")).toBeVisible();
  await expect(staticPage.locator(".prose")).toBeVisible();
  await context.close();
  await page.goto("/posts/tentang-memperhatikan#waktu-yang-tidak-diisi");
  await expect(page.locator("#waktu-yang-tidak-diisi")).toBeInViewport();
  await expect(page.locator(".motion-line")).toHaveCount(0);
});

test("title reveal settles, reflows on resize, and stays readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Warm the font cache so this checks the reveal rather than its slow-font fallback.
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.goto("/posts/tentang-memperhatikan");
  await expect.poll(() => page.locator(".motion-line").count()).toBeGreaterThan(1);
  await expect.poll(() => page.locator(".motion-line").evaluateAll((lines) => lines.every((line) => getComputedStyle(line).transform === "none"))).toBe(true);
  await expect(page.locator(".article-summary")).toHaveCSS("visibility", "visible");
  await page.setViewportSize({ width: 520, height: 844 });
  await expect(page.locator(".article-header h1")).toBeVisible();
  await expect.poll(() => page.locator(".motion-line").evaluateAll((lines) => lines.every((line) => getComputedStyle(line).transform === "none"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("late animation chunks never hide already visible headings", async ({ page }) => {
  let delayed = false;
  await page.route(await animationChunk(), async (route) => {
    delayed = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto("/posts/tentang-memperhatikan");
  await expect(page.locator(".article-header h1")).toBeVisible();
  await expect(page.getByLabel("Tema tampilan")).toBeEnabled();
  await page.waitForLoadState("networkidle");
  expect(delayed).toBe(true);
  await expect(page.locator(".motion-line")).toHaveCount(0);
  await expect(page.locator(".article-header h1")).toBeVisible();
});

test("failed animation chunks preserve reading and the mobile menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let blocked = false;
  await page.route(await animationChunk(), (route) => {
    blocked = true;
    return route.abort();
  });
  await page.goto("/posts/tentang-memperhatikan");
  await expect(page.locator(".article-header h1")).toBeVisible();
  await expect(page.locator(".prose")).toBeVisible();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Navigasi utama" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#site-menu")).toBeHidden();
  expect(blocked).toBe(true);
});

test("blog task markers render as ordinary nested lists", async ({ page }) => {
  await page.goto("/uji-responsif");
  const prose = page.locator(".prose");
  await expect(prose.locator('input[type="checkbox"], .task-list-item, .contains-task-list')).toHaveCount(0);
  await expect(prose.locator("li").filter({ hasText: /^Catatan untuk tulisan berikutnya\.$/ })).toBeVisible();
  await expect(prose.locator("li li")).toHaveText("Detail tambahan.");
  await expect(prose.locator("li").filter({ hasText: "Catatan yang sudah ditulis." }).first()).toBeVisible();
  await expect(prose.locator("li").first()).not.toContainText("[ ]");
  await expect(prose.locator("li").nth(1)).not.toContainText("[x]");
  await expect(prose.locator("blockquote")).toBeVisible();
  await expect(prose.locator("table")).toBeVisible();
  await expect(prose.locator(".hljs-keyword").first()).toBeVisible();
});
