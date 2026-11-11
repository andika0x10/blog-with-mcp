/** Only web links leaving the configured blog origin open another tab. */
export function isExternalLink(href: string | undefined, siteOrigin: string): boolean {
  if (!href) return false;
  try {
    const site = new URL(siteOrigin);
    const target = new URL(href, site);
    return ["http:", "https:"].includes(target.protocol) && target.origin !== site.origin;
  } catch {
    return false;
  }
}
