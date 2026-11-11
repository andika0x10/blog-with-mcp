import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { equalSecret, hash, randomToken } from "../lib/crypto";
import type { LoginLimiter } from "./login-limiter";
import type { AuthSession } from "./auth-session";
import { AppError } from "../lib/validation";
import { ContentService } from "../lib/content";
import { createAuthPage, loginForm, consentBody } from "./auth-page";
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
export async function authorize(request: Request, env: Env, oauth: OAuthHelpers) {
  let page = createAuthPage();
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return page("<h1>Login belum dikonfigurasi</h1><p>Lengkapi environment Worker terlebih dahulu.</p>", 503);
  const url = new URL(request.url),
    secure = url.protocol === "https:";
  const authRequest = await oauth.parseAuthRequest(new Request(request.url));
  if (!authRequest.codeChallenge || authRequest.codeChallengeMethod !== "S256") return page("<h1>Koneksi memerlukan PKCE S256</h1>", 400);
  const scope = authRequest.scope.length ? authRequest.scope : ["blog:manage"];
  if (scope.some((s) => !["blog:manage", "offline_access"].includes(s))) return page("<h1>Izin tidak dikenal</h1>", 400);
  const consent = await oauth.describeConsent(authRequest);
  const settings = await new ContentService(env.DB).settings();
  page = createAuthPage(settings.name, consent);
  // A transaction owns its cookie: starting another connection in a second tab
  // must not overwrite the first tab's login or rotated consent session.
  const transactionId = await hash(request.url);
  const transaction = transactionId.slice(0, 24);
  const sessions = (env.AUTH_SESSIONS as DurableObjectNamespace<AuthSession>).getByName(transactionId);
  const cookieName = `${secure ? "__Host-blog_auth" : "blog_auth"}_${transaction}`;
  const clearCookie = `${cookieName}=; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=0`;
  const cookie = cookieValue(request, cookieName);
  if (request.method === "POST") {
    if (request.headers.get("origin") !== url.origin || Number(request.headers.get("content-length")) > 8192) return page("<h1>Permintaan tidak valid</h1>", 403);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") return page("<h1>Format permintaan tidak valid</h1>", 415);
    const body = await readLoginBody(request);
    const form = new URLSearchParams(body);
    const cookieHash = await hash(cookie ?? ""),
      csrfHash = await hash(form.get("csrf") ?? "");
    const session = cookie ? await sessions.verify(cookieHash, csrfHash, request.url) : null;
    if (!session) {
      console.warn(
        JSON.stringify({
          event: "oauth_session_rejected",
          reason: cookie ? "invalid_or_expired_session" : "missing_session_cookie",
          stage: form.has("decision") ? "consent" : "login",
        })
      );
      return page("<h1>Sesi berakhir</h1><p>Buka kembali koneksi dari Claude dan selesaikan di browser yang sama.</p>", 403);
    }
    if (!session.authenticated) {
      const ip = request.headers.get("cf-connecting-ip") ?? "local";
      const rate = await (env.LOGIN_LIMITER as DurableObjectNamespace<LoginLimiter>).getByName(await hash(ip)).attempt();
      if (!rate.allowed) return page("<h1>Terlalu banyak percobaan</h1><p>Coba lagi dalam 15 menit.</p>", 429);
      const [userOk, passwordOk] = await Promise.all([equalSecret(form.get("username") ?? "", env.ADMIN_USERNAME), equalSecret(form.get("password") ?? "", env.ADMIN_PASSWORD)]);
      if (!userOk || !passwordOk)
        return page(loginForm(form.get("csrf")!, consent, "Username atau password tidak sesuai. Periksa lalu coba lagi.", (form.get("username") ?? "").slice(0, 200)), 401);
      // Rotate both the browser session and CSRF token after authentication.
      const next = randomToken(),
        csrf = randomToken();
      if (!(await sessions.authenticate(cookieHash, csrfHash, request.url, await hash(next), await hash(csrf))))
        return page("<h1>Sesi berakhir</h1><p>Buka kembali koneksi dari Claude.</p>", 403);
      return page(consentBody(csrf, consent, scope), 200, `${cookieName}=${next}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=600`);
    }
    if (!(await sessions.consume(cookieHash, csrfHash, request.url))) return page("<h1>Sesi berakhir</h1><p>Buka kembali koneksi dari Claude.</p>", 403);
    if (form.get("decision") !== "allow")
      return page(
        '<h1>Koneksi dibatalkan</h1><p class="intro">Tidak ada akses baru yang diberikan. Kamu dapat menutup halaman ini atau memulai lagi dari Claude.</p><a class="return-link" href="/">Kembali ke blog</a>',
        200,
        clearCookie
      );
    const { redirectTo } = await oauth.completeAuthorization({ request: authRequest, userId: "owner", metadata: {}, scope, props: { owner: true }, revokeExistingGrants: false });
    return new Response(null, {
      status: 302,
      headers: { Location: redirectTo, "Cache-Control": "no-store", "Set-Cookie": clearCookie },
    });
  }
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  const token = randomToken(),
    csrf = randomToken();
  await sessions.create(await hash(token), await hash(csrf), request.url);
  return page(loginForm(csrf, consent), 200, `${cookieName}=${token}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=600`);
}
