import { test, expect, devices, type BrowserContext, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";

async function authorization(context: BrowserContext, base: string, existingClient?: string) {
  let client = existingClient;
  if (!client) {
    const registered = await context.request.post(base + "/oauth/register", {
      data: {
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    });
    expect(registered.status()).toBe(201);
    client = (await registered.json()).client_id as string;
  }
  const verifier = "a".repeat(64);
  const params = new URLSearchParams({
    client_id: client,
    response_type: "code",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    scope: "blog:manage offline_access",
    state: randomUUID(),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: base + "/mcp",
  });
  const page = await context.newPage();
  await page.goto(base + "/authorize?" + params);
  await expect(page.getByRole("heading", { name: "Masuk ke blog." })).toBeVisible();
  return { page, client };
}
async function login(page: Page) {
  await page.getByLabel("Username", { exact: true }).fill("browser-test-owner");
  await page.getByLabel("Password", { exact: true }).fill("browser-only-password");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Izinkan akses ke blog?" })).toBeVisible();
}

for (const javaScriptEnabled of [true, false]) {
  test(`Android emulation: cross-site entry, touch approval and MCP token exchange (JavaScript: ${javaScriptEnabled})`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"], javaScriptEnabled, extraHTTPHeaders: { "CF-Connecting-IP": randomUUID() } });
    try {
      await context.route(
        (url) => url.origin === "https://claude.ai" && url.pathname === "/api/mcp/auth_callback",
        (route) => route.fulfill({ body: "Connected" })
      );
      const { page, client } = await authorization(context, baseURL!);
      const authUrl = page.url();
      await context.route("https://claude.ai/connect-test", (route) =>
        route.fulfill({ contentType: "text/html", body: `<a href="${authUrl.replace(/&/g, "&amp;")}">Hubungkan blog</a>` })
      );
      await page.goto("https://claude.ai/connect-test");
      await page.getByRole("link", { name: "Hubungkan blog" }).tap();
      await login(page);
      await page.getByRole("button", { name: "Izinkan akses", exact: true }).tap();
      await expect(page).toHaveURL(/claude\.ai.*code=/);
      const callback = new URL(page.url());
      expect(callback.searchParams.get("state")).toBe(new URL(authUrl).searchParams.get("state"));
      const exchanged = await context.request.post(baseURL + "/oauth/token", {
        form: {
          grant_type: "authorization_code",
          client_id: client,
          redirect_uri: "https://claude.ai/api/mcp/auth_callback",
          code: callback.searchParams.get("code")!,
          code_verifier: "a".repeat(64),
          resource: baseURL + "/mcp",
        },
      });
      expect(exchanged.status()).toBe(200);
      const { access_token } = await exchanged.json();
      const tools = await context.request.post(baseURL + "/mcp", {
        headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      });
      expect(tools.status()).toBe(200);
      expect(await tools.text()).toContain("write_content");
    } finally {
      await context.close();
    }
  });
}

for (const width of [320, 390, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${width}px ${theme}: login, error, consent and cancel without JavaScript`, async ({ browser, baseURL }, info) => {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        colorScheme: theme,
        viewport: { width, height: 900 },
        extraHTTPHeaders: { "CF-Connecting-IP": randomUUID() },
      });
      try {
        const { page } = await authorization(context, baseURL!);
        const violations: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error" && /Content Security Policy|Refused/.test(message.text())) violations.push(message.text());
        });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.locator("h1").evaluate((element) => document.fonts.check('600 30px "Public Sans"') && getComputedStyle(element).fontFamily.includes("Public Sans"))).toBe(
          true
        );
        expect(await page.locator("main").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(440);
        await page.getByLabel("Username", { exact: true }).focus();
        await expect(page.getByLabel("Username", { exact: true })).toHaveCSS("outline-style", "solid");
        await page.screenshot({ path: info.outputPath("login.png"), fullPage: true });
        await page.getByLabel("Username", { exact: true }).fill("browser-test-owner");
        await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
        await page.getByRole("button", { name: "Masuk", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("Username atau password tidak sesuai");
        await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
        await page.screenshot({ path: info.outputPath("login-error.png"), fullPage: true });
        await login(page);
        await expect(page.locator(".permissions li")).toHaveCount(5);
        await expect(page.locator(".destination")).toContainText("claude.ai");
        await expect(page.locator(".hint")).toContainText("tidak memutus");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath("consent.png"), fullPage: true });
        await page.getByRole("button", { name: "Batalkan", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Koneksi dibatalkan" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Kembali ke blog" })).toBeVisible();
        expect((await context.cookies()).filter((cookie) => cookie.name.startsWith("blog_auth_"))).toHaveLength(0);
        expect(violations).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}

test("two browser tabs can independently authorize the same client", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: { "CF-Connecting-IP": randomUUID() } });
  try {
    await context.route(
      (url) => url.origin === "https://claude.ai" && url.pathname === "/api/mcp/auth_callback",
      (route) => route.fulfill({ body: "Connected" })
    );
    const first = await authorization(context, baseURL!);
    const second = await authorization(context, baseURL!, first.client);
    await login(first.page);
    await login(second.page);
    await first.page.getByRole("button", { name: "Izinkan akses", exact: true }).click();
    await expect(first.page).toHaveURL(/claude\.ai.*code=/);
    await second.page.getByRole("button", { name: "Izinkan akses", exact: true }).click();
    await expect(second.page).toHaveURL(/claude\.ai.*code=/);
  } finally {
    await context.close();
  }
});

test("expired sessions and login limits keep the auth layout without JavaScript", async ({ browser, baseURL }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "CF-Connecting-IP": randomUUID() } });
  try {
    const expired = await authorization(context, baseURL!);
    await context.clearCookies();
    await expired.page.getByLabel("Username", { exact: true }).fill("browser-test-owner");
    await expired.page.getByLabel("Password", { exact: true }).fill("browser-only-password");
    await expired.page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(expired.page.getByRole("heading", { name: "Sesi berakhir" })).toBeVisible();
    await expired.page.screenshot({ path: info.outputPath("session-expired.png"), fullPage: true });
    const limited = await authorization(context, baseURL!, expired.client);
    for (let attempt = 0; attempt < 6; attempt++) {
      await limited.page.getByLabel("Username", { exact: true }).fill("browser-test-owner");
      await limited.page.getByLabel("Password", { exact: true }).fill("incorrect-password");
      await limited.page.getByRole("button", { name: "Masuk", exact: true }).click();
      if (attempt < 5) await expect(limited.page.getByRole("alert")).toBeVisible();
    }
    await expect(limited.page.getByRole("heading", { name: "Terlalu banyak percobaan" })).toBeVisible();
    await expect(limited.page.locator("main")).toContainText("15 menit");
    await limited.page.screenshot({ path: info.outputPath("login-limited.png"), fullPage: true });
  } finally {
    await context.close();
  }
});
