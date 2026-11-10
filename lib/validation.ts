import { z } from "zod";
export const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Gunakan slug huruf kecil dengan tanda hubung.");
export const reserved = new Set(["posts", "search", "archive", "media", "mcp", "authorize", "oauth", "preview", "api", "_next", "robots", "sitemap", "favicon", "rss"]);
export const contentInput = z.object({
  title: z.string().trim().min(1).max(250),
  slug: slugSchema,
  summary: z.string().max(1000).default(""),
  markdown: z.string().max(200000),
  seoTitle: z.string().max(250).default(""),
  seoDescription: z.string().max(1000).default(""),
  image: z.string().max(500).default(""),
});
export type ContentInput = z.infer<typeof contentInput>;
// Do not reuse .partial() over defaulted fields: omitted edits must stay omitted.
export const contentPatch = contentInput
  .extend({
    summary: contentInput.shape.summary.removeDefault(),
    seoTitle: contentInput.shape.seoTitle.removeDefault(),
    seoDescription: contentInput.shape.seoDescription.removeDefault(),
    image: contentInput.shape.image.removeDefault(),
  })
  .partial()
  .strict();
const href = z
  .string()
  .max(1000)
  .refine(
    (v) =>
      /^\/(?!\/)[^\\\s]*$/.test(v) ||
      (() => {
        try {
          const u = new URL(v);
          return u.protocol === "https:" && !u.username && !u.password;
        } catch {
          return false;
        }
      })(),
    "Gunakan path internal atau URL HTTPS."
  );
export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000),
  author: z.string().trim().min(1).max(120),
  language: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("id", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }),
  navbar: z.array(z.object({ label: z.string().trim().min(1).max(80), href })).max(12),
  footer: z.string().max(1000),
  defaultTheme: z.enum(["system", "light", "dark"]),
  pageSize: z.literal(10),
});
export type SiteSettings = z.infer<typeof settingsSchema>;
export function pathFor(kind: string, slug: string) {
  return kind === "post" ? `/posts/${slug}` : `/${slug}`;
}
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}
