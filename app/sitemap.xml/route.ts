import { contentService, origin } from "../../lib/runtime";
import { xml } from "../../lib/feeds";
export async function GET() {
  const rows = await contentService()
      .db.prepare("SELECT c.kind,r.slug,r.created_at FROM contents c JOIN revisions r ON r.id=c.published_id WHERE c.trashed_at IS NULL")
      .all<{ kind: string; slug: string; created_at: string }>(),
    base = origin();
  const pages = ["/", "/archive"].map((p) => `<url><loc>${xml(base + p)}</loc></url>`).join("");
  const items = rows.results.map((p) => `<url><loc>${xml(base + (p.kind === "post" ? "/posts/" : "/") + p.slug)}</loc><lastmod>${xml(p.created_at)}</lastmod></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages}${items}</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
