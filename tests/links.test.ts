import { describe, expect, it } from "vitest";
import { isExternalLink } from "../lib/links";

describe("blog links", () => {
  it.each(["/archive", "#bagian", "?page=2", "posts/catatan", "https://blog.example.com/archive", "mailto:hello@example.com", "tel:123", undefined])(
    "keeps %s in the current context",
    (href) => {
      expect(isExternalLink(href, "https://blog.example.com")).toBe(false);
    }
  );
  it.each(["https://example.com", "http://example.com", "//example.com/path", "https://blog.example.com:8443", "http://blog.example.com"])(
    "identifies external web link %s",
    (href) => {
      expect(isExternalLink(href, "https://blog.example.com")).toBe(true);
    }
  );
});
