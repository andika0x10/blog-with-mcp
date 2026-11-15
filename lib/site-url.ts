const productionSiteUrl = "https://blog.andikadinata.workers.dev";

export function resolveSiteUrl(value: string | undefined, mode: string | undefined): string {
  const development = mode === "development";
  const configured = value === undefined ? (development ? "http://localhost:5173" : productionSiteUrl) : value.trim();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("SITE_URL harus berupa URL utama blog yang valid, misalnya https://blog.andikadinata.workers.dev.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SITE_URL harus berupa origin HTTP(S) tanpa kredensial, path, query, atau fragment.");
  }
  const hostname = url.hostname.replace(/\.$/, "");
  const local = ["localhost", "0.0.0.0", "[::]", "[::1]"].includes(hostname) || hostname.endsWith(".localhost") || hostname.startsWith("127.");
  if (!development && (url.protocol !== "https:" || local)) {
    throw new Error("SITE_URL di luar mode development harus memakai HTTPS dan domain publik, bukan localhost atau alamat loopback.");
  }
  return url.origin;
}
