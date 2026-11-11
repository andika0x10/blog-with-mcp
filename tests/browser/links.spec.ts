import { test, expect } from "@playwright/test";

for (const route of ["/uji-responsif", "/preview/" + "a".repeat(64)]) {
  test(`external and internal links behave consistently on ${route}`, async ({ page }) => {
    await page.goto(route);
    const external = page.getByRole("link", { name: "Situs external (dibuka di tab baru)", exact: true });
    await expect(external).toHaveAttribute("target", "_blank");
    await expect(external).toHaveAttribute("rel", "noopener noreferrer");
    await expect(external.locator(".external-icon")).toHaveCount(1);
    for (const label of ["Arsip internal", "Bagian tabel", "Email"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).not.toHaveAttribute("target");
    }
    await page.route("https://example.com/**", (route) => route.fulfill({ body: "External destination" }));
    const [popup] = await Promise.all([page.waitForEvent("popup"), external.click()]);
    await expect(popup).toHaveURL("https://example.com/");
    await expect(page).toHaveURL(new RegExp(route + "$"));
    await popup.close();
    await page.getByRole("link", { name: "Bagian tabel", exact: true }).click();
    await expect(page).toHaveURL(/#tabel-dan-kode$/);
  });
}

for (const width of [320, 390, 1440]) {
  test(`${width}px: menu external link and symmetric insets`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 480 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const external = page.getByRole("link", { name: "Mau jadi hengker? (dibuka di tab baru)", exact: true });
    await expect(external).toHaveAttribute("target", "_blank");
    await expect(external).toHaveAttribute("rel", "noopener noreferrer");
    const checkInsets = async () => {
      const insets = await page.locator("#site-menu").evaluate((panel) => {
        const a = panel.querySelector("a")!.getBoundingClientRect(),
          p = panel.getBoundingClientRect();
        return [a.left - p.left, p.right - a.right];
      });
      expect(Math.abs(insets[0] - insets[1])).toBeLessThan(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    };
    await checkInsets();
    await page.screenshot({ path: info.outputPath("menu-external.png") });
    await page.locator("#site-menu nav").evaluate((nav) => {
      for (let i = 0; i < 12; i++) {
        const a = document.createElement("a");
        a.href = "/archive";
        a.textContent = "Navigasi panjang ".repeat(5);
        nav.appendChild(a);
      }
    });
    await checkInsets();
    await page.locator("#site-menu a").last().scrollIntoViewIfNeeded();
    await expect(page.locator("#site-menu a").last()).toBeInViewport();
  });
}
