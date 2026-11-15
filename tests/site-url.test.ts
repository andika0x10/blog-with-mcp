import { describe, expect, it } from "vitest";
import { resolveSiteUrl } from "../lib/site-url";

describe("SITE_URL configuration", () => {
  it.each(["production", "staging", undefined])("defaults to the main public domain in %s mode", (mode) => {
    expect(resolveSiteUrl(undefined, mode)).toBe("https://blog.andikadinata.workers.dev");
  });

  it("allows a normalized canonical domain override", () => {
    expect(resolveSiteUrl(" https://blog.example.com/ ", "production")).toBe("https://blog.example.com");
  });

  it("keeps localhost available only in development", () => {
    expect(resolveSiteUrl(undefined, "development")).toBe("http://localhost:5173");
    expect(resolveSiteUrl("http://127.0.0.1:8787/", "development")).toBe("http://127.0.0.1:8787");
  });

  it.each([
    "http://localhost:5173",
    "https://localhost",
    "https://localhost.",
    "https://app.localhost",
    "https://127.0.0.1",
    "https://127.1",
    "https://[::1]",
    "https://0.0.0.0",
    "http://blog.example.com",
  ])("rejects a non-public or insecure production URL: %s", (value) => {
    expect(() => resolveSiteUrl(value, "production")).toThrow("HTTPS dan domain publik");
  });

  it.each([
    "",
    "   ",
    "blog.example.com",
    "ftp://blog.example.com",
    "https://user:password@blog.example.com",
    "https://blog.example.com/mcp",
    "https://blog.example.com/?q=1",
    "https://blog.example.com/#preview",
  ])("rejects invalid canonical origins: %s", (value) => {
    expect(() => resolveSiteUrl(value, "production")).toThrow("SITE_URL");
  });
});
