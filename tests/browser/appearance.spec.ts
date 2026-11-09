import { test, expect } from "@playwright/test";
import { fonts } from "../../lib/fonts";

const toggle = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Tampilan", exact: true });

async function openAppearance(page: import("@playwright/test").Page) {
  await toggle(page).click();
}

test("menu contexts clean up without recursion across breakpoints and motion changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Navigasi mobile" })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

for (const width of [320, 1440]) {
  test(`${width}px: retired size preferences no longer change article typography`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("blog-font-size", "120");
      localStorage.setItem("blog-font-size-px", "12");
    });
    await page.goto("/posts/tentang-memperhatikan");
    await openAppearance(page);
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByText("Ukuran teks (px)", { exact: true })).toHaveCount(0);
    await expect(page.locator(".prose")).toHaveCSS("font-size", width < 641 ? "18px" : "19px");
    await page.getByLabel("Font", { exact: true }).selectOption("literata");
    await expect(page.locator(".prose")).toHaveCSS("font-size", width < 641 ? "18px" : "19px");
    await page.reload();
    await expect(page.locator(".prose")).toHaveCSS("font-size", width < 641 ? "18px" : "19px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`${width}px ${theme}: every font works on home and article`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const route of ["/", "/posts/tentang-memperhatikan"]) {
        await page.goto(route);
        const codeFont =
          route !== "/"
            ? await page
                .locator("pre code")
                .first()
                .evaluate((el) => getComputedStyle(el).fontFamily)
            : null;
        const mathFont =
          route !== "/"
            ? await page
                .locator(".katex .mord")
                .first()
                .evaluate((el) => getComputedStyle(el).fontFamily)
            : null;
        await openAppearance(page);
        await expect(page.locator(".font-preview, .font-reset")).toHaveCount(0);
        for (const font of fonts) {
          await page.getByLabel("Font", { exact: true }).selectOption(font.id);
          await page.evaluate(() => document.fonts.ready);
          await expect(page.locator("html")).toHaveAttribute("data-font", font.id);
          await expect(page.locator("body")).toHaveCSS("font-family", new RegExp(font.family));
          expect(await page.evaluate((family) => [...document.fonts].some((face) => face.family.replace(/["']/g, "") === family && face.status === "loaded"), font.family)).toBe(true);
          await expect(page.getByLabel("Font", { exact: true })).toHaveCSS("font-family", new RegExp(font.family));
          await expect(page.locator("main h1").first()).toHaveCSS("font-family", new RegExp(font.family));
          if (font.id !== "public-sans") {
            await expect(page.locator("main h1").first()).toHaveCSS("letter-spacing", "normal");
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await expect(page.getByRole("heading").first()).toBeVisible();
          await expect(page.locator(".motion-line")).toHaveCount(0);
          const panel = await page.locator("#appearance-panel").boundingBox();
          expect(panel!.x).toBeGreaterThanOrEqual(0);
          expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
          if (font.id === "public-sans") {
            await page.keyboard.press("Escape");
            await page.screenshot({ path: testInfo.outputPath(`${route === "/" ? "home" : "article"}-public-sans.png`), fullPage: true });
            await openAppearance(page);
          }
          if (codeFont) {
            await expect(page.locator("pre code").first()).toHaveCSS("font-family", codeFont);
            await expect(page.locator(".katex .mord").first()).toHaveCSS("font-family", mathFont!);
          }
        }
        await page.screenshot({ path: testInfo.outputPath(`${route === "/" ? "home" : "article"}-literata.png`), fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
}

test("font persists, resets independently of theme, and restores before hydration", async ({ page }) => {
  await page.goto("/");
  await openAppearance(page);
  await page.getByLabel("Tema tampilan").selectOption("dark");
  await page.getByLabel("Font", { exact: true }).selectOption("source-serif-4");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-font", "source-serif-4");
  await openAppearance(page);
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue("source-serif-4");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Tentang memperhatikan hal-hal kecil", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-font", "source-serif-4");
  await openAppearance(page);
  await page.getByLabel("Font", { exact: true }).selectOption("public-sans");
  await expect(page.locator("html")).toHaveAttribute("data-font", "public-sans");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("blog-font"))).toBe("public-sans");
  await page.evaluate(() => localStorage.setItem("blog-font", "invalid-font"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-font", "public-sans");
});

test("keyboard, outside clicks, and mobile menu dismiss the panel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Tema tampilan")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Font", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle(page)).toBeFocused();
  await expect(page.locator("#appearance-panel")).toBeHidden();
  await expect(page.locator("#mobile-menu")).toBeHidden();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
  await expect(page.locator("#mobile-menu")).toBeHidden();
  await openAppearance(page);
  await page.locator("main").click({ position: { x: 1, y: 1 } });
  await expect(page.locator("#appearance-panel")).toBeHidden();
  await expect(page.locator("#mobile-menu")).toBeHidden();
});

test("blocked storage still allows font and system theme changes", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await openAppearance(page);
  await page.getByLabel("Font", { exact: true }).selectOption("ibm-plex-sans");
  await expect(page.locator("html")).toHaveAttribute("data-font", "ibm-plex-sans");
  await page.getByLabel("Tema tampilan").selectOption("dark");
  await page.getByLabel("Tema tampilan").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("only used fonts download and failed fonts keep content readable", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") requests.push(request.url());
  });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await openAppearance(page);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((url) => url.includes("public-sans"))).toBe(true);
  await page.route("**/*source-serif-4*.woff2", (route) => route.abort());
  await page.getByLabel("Font", { exact: true }).selectOption("source-serif-4");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue("source-serif-4");
  await expect(page.getByRole("heading").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test("saved font renders before hydration when application scripts are blocked", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("blog-font", "source-serif-4"));
  await page.route("**/*", (route) => route.request().resourceType() === "script" ? route.abort() : route.continue());
  await page.goto("/posts/tentang-memperhatikan");
  await expect(page.locator(".prose")).toHaveCSS("font-family", /Source Serif 4 Variable/);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("html")).toHaveAttribute("data-font", "source-serif-4");
  await expect(page.getByRole("heading").first()).toBeVisible();
});

test("serif and sans choices use different glyph metrics", async ({ page }) => {
  await page.goto("/posts/tentang-memperhatikan");
  await openAppearance(page);
  const widths: number[] = [];
  for (const font of ["public-sans", "source-serif-4"]) {
    await page.getByLabel("Font", { exact: true }).selectOption(font);
    await page.evaluate(() => document.fonts.ready);
    widths.push(await page.locator(".prose").evaluate((element) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.font = `400 19px ${getComputedStyle(element).fontFamily}`;
      return context.measureText("Memperhatikan huruf kecil, garis, dan ruang.").width;
    }));
  }
  expect(Math.abs(widths[0] - widths[1])).toBeGreaterThan(1);
});

test("light syntax palette covers JavaScript, HTML, and CSS without changing dark mode", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/uji-responsif");
  const js = page.locator("code.language-javascript");
  const html = page.locator("code.language-html");
  const css = page.locator("code.language-css");
  await expect(js.locator(".hljs-keyword").first()).toHaveCSS("color", "rgb(1, 86, 146)");
  await expect(js.locator(".hljs-title").first()).toHaveCSS("color", "rgb(183, 85, 1)");
  await expect(js.locator(".hljs-string").first()).toHaveCSS("color", "rgb(84, 121, 13)");
  await expect(js.locator(".hljs-comment").first()).toHaveCSS("color", "rgb(101, 110, 119)");
  await expect(html.locator(".hljs-name").first()).toHaveCSS("color", "rgb(183, 85, 1)");
  await expect(html.locator(".hljs-attr").first()).toHaveCSS("color", "rgb(1, 86, 146)");
  await expect(css.locator(".hljs-selector-class")).toHaveCSS("color", "rgb(1, 86, 146)");
  await expect(css.locator(".hljs-attribute").first()).toHaveCSS("color", "rgb(128, 51, 120)");
  await expect(page.locator(".code-block pre").first()).toHaveCSS("padding-top", "48px");
  await page.screenshot({ path: testInfo.outputPath("syntax-light.png"), fullPage: true });
  const block = js.locator("../..");
  const code = await js.textContent();
  await block.getByRole("button", { name: "Salin kode" }).click();
  await expect(block.getByRole("button", { name: "Salin kode" })).toHaveText("Tersalin");
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(code?.replace(/\r\n/g, "\n"));
  await openAppearance(page);
  await page.getByLabel("Tema tampilan").selectOption("dark");
  await expect(js.locator(".hljs-keyword").first()).toHaveCSS("color", "rgb(200, 162, 231)");
  await expect(js.locator(".hljs-string").first()).toHaveCSS("color", "rgb(155, 199, 174)");
  await expect(js.locator(".hljs-title").first()).toHaveCSS("color", "rgb(232, 232, 232)");
});
