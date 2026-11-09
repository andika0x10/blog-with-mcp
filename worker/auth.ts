import type { OAuthHelpers, ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { equalSecret, hash, randomToken } from "../lib/crypto";
import type { LoginLimiter } from "./login-limiter";
import { AppError } from "../lib/validation";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const cookieValue = (r: Request, name: string) =>
  r.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
async function readLoginBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8192) throw new AppError("Permintaan terlalu besar.", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
function page(body: string, status = 200, cookie?: string) {
  return new Response(
    `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Hubungkan blog</title><style>body{font:18px/1.6 system-ui;max-width:30rem;margin:12vh auto;padding:24px;color:#202020;background:#fff}h1{font-size:30px;letter-spacing:-.04em}label{display:block;margin:20px 0}input{display:block;box-sizing:border-box;width:100%;padding:12px;font:inherit;border:1px solid #888;border-radius:4px}button{font:inherit;padding:10px 18px;cursor:pointer;background:#202020;color:#fff;border:0;border-radius:4px}button+button{margin-left:10px}small{overflow-wrap:anywhere}a{color:inherit}@media(prefers-color-scheme:dark){body{background:#000;color:#e8e8e8}input{background:#000;color:#e8e8e8}button{background:#e8e8e8;color:#000}}</style><body>${body}</body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        ...(cookie ? { "Set-Cookie": cookie } : {}),
      },
    }
  );
}
export async function authorize(request: Request, env: Env, oauth: OAuthHelpers) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.SITE_URL) return page("<h1>Login belum dikonfigurasi</h1><p>Lengkapi environment Worker terlebih dahulu.</p>", 503);
  const url = new URL(request.url),
    secure = url.protocol === "https:",
    cookieName = secure ? "__Host-blog_auth" : "blog_auth";
  if (url.origin !== new URL(env.SITE_URL).origin) return page("<h1>Origin tidak valid</h1>", 400);
  const authRequest = await oauth.parseAuthRequest(new Request(request.url));
  if (!authRequest.codeChallenge || authRequest.codeChallengeMethod !== "S256") return page("<h1>Koneksi memerlukan PKCE S256</h1>", 400);
  const scope = authRequest.scope.length ? authRequest.scope : ["blog:manage"];
  if (scope.some((s) => !["blog:manage", "offline_access"].includes(s))) return page("<h1>Izin tidak dikenal</h1>", 400);
  const consent = await oauth.describeConsent(authRequest);
  const cookie = cookieValue(request, cookieName);
  const session = cookie ? await env.OAUTH_KV.get<{ csrf: string; authenticated: boolean; requestUrl: string }>(`login:${await hash(cookie)}`, "json") : null;
  if (request.method === "POST") {
    if (request.headers.get("origin") !== url.origin || Number(request.headers.get("content-length")) > 8192) return page("<h1>Permintaan tidak valid</h1>", 403);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") return page("<h1>Format permintaan tidak valid</h1>", 415);
    const body = await readLoginBody(request);
    const form = new URLSearchParams(body);
    if (!session || session.requestUrl !== request.url || !(await equalSecret(form.get("csrf") ?? "", session.csrf)))
      return page("<h1>Sesi berakhir</h1><p>Buka kembali koneksi dari Claude.</p>", 403);
    if (!session.authenticated) {
      const ip = request.headers.get("cf-connecting-ip") ?? "local";
      const rate = await (env.LOGIN_LIMITER as DurableObjectNamespace<LoginLimiter>).getByName(await hash(ip)).attempt();
      if (!rate.allowed) return page("<h1>Terlalu banyak percobaan</h1><p>Coba lagi dalam 15 menit.</p>", 429);
      const [userOk, passwordOk] = await Promise.all([equalSecret(form.get("username") ?? "", env.ADMIN_USERNAME), equalSecret(form.get("password") ?? "", env.ADMIN_PASSWORD)]);
      if (!userOk || !passwordOk) return page("<h1>Login gagal</h1><p>Username atau password tidak sesuai. Kembali ke halaman sebelumnya untuk mencoba lagi.</p>", 401);
      // Rotate both the browser session and CSRF token after authentication.
      const next = randomToken(),
        csrf = randomToken();
      await env.OAUTH_KV.delete(`login:${await hash(cookie!)}`);
      await env.OAUTH_KV.put(`login:${await hash(next)}`, JSON.stringify({ csrf, authenticated: true, requestUrl: request.url }), { expirationTtl: 600 });
      return consentPage(csrf, consent, `${cookieName}=${next}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=600`);
    }
    await env.OAUTH_KV.delete(`login:${await hash(cookie!)}`);
    if (form.get("decision") !== "allow") return page("<h1>Koneksi dibatalkan</h1><p>Kamu dapat menutup halaman ini.</p>");
    const { redirectTo } = await oauth.completeAuthorization({ request: authRequest, userId: "owner", metadata: {}, scope, props: { owner: true } });
    return new Response(null, {
      status: 302,
      headers: { Location: redirectTo, "Cache-Control": "no-store", "Set-Cookie": `${cookieName}=; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=0` },
    });
  }
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  const token = randomToken(),
    csrf = randomToken();
  await env.OAUTH_KV.put(`login:${await hash(token)}`, JSON.stringify({ csrf, authenticated: false, requestUrl: request.url }), { expirationTtl: 600 });
  return page(
    `<h1>Hubungkan blog</h1><p>Masuk untuk memberi ${esc(consent.clientName)} akses mengelola blog.</p><form method="post"><input type="hidden" name="csrf" value="${csrf}"><label>Username<input name="username" autocomplete="username" maxlength="200" required></label><label>Password<input name="password" type="password" autocomplete="current-password" maxlength="1000" required></label><button>Masuk</button></form>`,
    200,
    `${cookieName}=${token}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=600`
  );
}
function consentPage(csrf: string, consent: ConsentDescription, cookie: string) {
  return page(
    `<h1>Izinkan akses ke blog?</h1><p><strong>${esc(consent.clientName)}</strong>${consent.clientDomain ? ` dari <strong>${esc(consent.clientDomain)}</strong>` : ""} akan dapat membaca draft, mengubah konten dan pengaturan, mengimpor gambar, serta menerbitkan atau menghapus tulisan.</p><p>Tujuan koneksi: <strong>${esc(consent.redirectHost)}</strong></p><small>${esc(consent.redirectUri)}</small><p>Izin: ${consent.scope.map(esc).join(", ")}</p><form method="post"><input type="hidden" name="csrf" value="${csrf}"><p><button name="decision" value="allow">Izinkan akses</button><button name="decision" value="deny">Batalkan</button></p></form>`,
    200,
    cookie
  );
}
