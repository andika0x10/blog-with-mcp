import { origin } from "../../lib/runtime";
export function GET() {
  return new Response(
    `User-agent: *\nAllow: /\nDisallow: /preview/\nDisallow: /authorize\nDisallow: /oauth/\nDisallow: /mcp\nDisallow: /search\nSitemap: ${origin()}/sitemap.xml\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}
