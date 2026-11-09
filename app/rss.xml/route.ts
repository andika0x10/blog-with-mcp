import { contentService, origin } from "../../lib/runtime";
import { xml } from "../../lib/feeds";
export async function GET() {
  const service = contentService(),
    s = await service.settings(),
    posts = await service.publicList({ limit: 50 }),
    base = origin();
  const items = posts
    .map(
      (p) =>
        `<item><title>${xml(p.title)}</title><link>${xml(base + p.url)}</link><guid isPermaLink="true">${xml(base + p.url)}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate><description>${xml(p.summary)}</description></item>`
    )
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(s.name)}</title><link>${xml(base)}</link><description>${xml(s.description)}</description><language>${xml(s.language)}</language>${items}</channel></rss>`,
    { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } }
  );
}
