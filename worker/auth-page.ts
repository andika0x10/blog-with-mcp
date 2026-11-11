import fontUrl from "@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2?url";
import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { siteConfig } from "../config";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const blogIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h11a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4Z"/><path d="M8 16h11M8 8h6M8 11h8"/></svg>';
const appIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8M12 8v8"/></svg>';

export function createAuthPage(siteName = siteConfig.name, consent?: ConsentDescription) {
  // Chromium applies form-action to the POST's redirect as well. Permit only
  // the callback origin already validated by the OAuth provider, never a
  // client-supplied policy fragment. Scripts remain disabled by default-src.
  const callbackOrigin = consent ? new URL(consent.redirectUri).origin.replace(/[;,'"\s]/g, (c) => `%${c.charCodeAt(0).toString(16)}`) : "";
  return (body: string, status = 200, cookie?: string) =>
    new Response(
      `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Hubungkan blog · ${esc(siteName)}</title>
<style>
@font-face{font-family:Public Sans;src:url("${fontUrl}") format("woff2");font-style:normal;font-weight:100 900;font-display:swap}
:root{--bg:#fff;--fg:#202020;--muted:#666;--line:#e5e5e5;--surface:#f6f6f6;color-scheme:light;font-family:Public Sans,system-ui,sans-serif;background:var(--surface);color:var(--fg)}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:48px 16px;font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:440px;padding:32px;border:1px solid var(--line);border-radius:24px;background:var(--bg)}
.site-name{margin:0 0 28px;font-size:14px;font-weight:600;overflow-wrap:anywhere}.connection{display:flex;align-items:center;margin:0 0 28px;gap:12px}.node{display:grid;place-items:center;width:56px;height:56px;border:1px solid var(--line);border-radius:16px;background:var(--surface);flex-shrink:0}.node:last-child{background:var(--fg);color:var(--bg);border-color:var(--fg)}.node svg{width:28px;height:28px}.bridge{width:48px;height:1px;background:var(--line);position:relative}.bridge:after{content:"";position:absolute;width:5px;height:5px;right:0;top:-2px;border-radius:50%;background:var(--muted)}
h1{font-size:34px;font-weight:600;letter-spacing:-.055em;line-height:1.15;margin:0 0 14px;text-wrap:balance}p{margin:0 0 20px;overflow-wrap:anywhere}.intro,.hint,.destination{color:var(--muted)}strong{color:var(--fg);font-weight:600}form{margin-top:24px}label{display:block;font-size:14px;font-weight:600;margin-top:18px}input{display:block;width:100%;min-height:48px;padding:11px 12px;margin-top:7px;font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:10px}input:hover{border-color:var(--muted)}
button,.return-link{font:inherit;font-weight:600;min-height:48px;padding:11px 16px;border:1px solid var(--fg);border-radius:10px;background:var(--fg);color:var(--bg);cursor:pointer;display:block;text-align:center;text-decoration:none;width:100%}button:hover,.return-link:hover{opacity:.82}.actions{display:flex;flex-direction:column;gap:10px;margin-top:24px}.secondary{color:var(--fg);background:transparent;border-color:var(--line)}:focus-visible{outline:2px solid var(--fg);outline-offset:4px}form>button{margin-top:24px}.hint{font-size:13px;margin:16px 0 0}.permissions{list-style:none;padding:0;margin:24px 0}.permissions li{position:relative;padding:10px 0 10px 24px;border-bottom:1px solid var(--line);font-size:14px}.permissions li:before{content:"✓";position:absolute;left:0;font-weight:600}.destination{font-size:13px;margin:24px 0 0;padding-top:20px;border-top:1px solid var(--line)}.destination p{margin:0 0 6px}.destination summary{cursor:pointer;font-size:12px}.destination small{display:block;overflow-wrap:anywhere;margin-top:8px;font-size:12px}.error{padding:12px 14px;border-inline-start:3px solid var(--fg);background:var(--surface);font-size:14px;margin:20px 0}.return-link{margin-top:24px}.scope{font-size:12px}
@media(max-width:480px){body{padding:24px 12px}main{padding:24px;border-radius:20px}h1{font-size:30px}}
@media(prefers-color-scheme:dark){:root{--bg:#000;--fg:#e8e8e8;--muted:#a3a3a3;--line:#292929;--surface:#141414;color-scheme:dark}}
</style></head><body><main aria-labelledby="auth-title"><p class="site-name">${esc(siteName)}</p>
<div class="connection" role="img" aria-label="Hubungkan blog dengan ${esc(consent?.clientName ?? "aplikasi")}"><span class="node">${blogIcon}</span><span class="bridge"></span><span class="node">${appIcon}</span></div>
${body.replace("<h1>", '<h1 id="auth-title">')}
${consent ? `<footer class="destination"><p>Tujuan koneksi <strong>${esc(consent.redirectHost)}</strong></p>${consent.clientDomain ? `<p>Aplikasi dari <strong>${esc(consent.clientDomain)}</strong></p>` : ""}${consent.redirectIsLoopback ? "<p>Koneksi ini memberi akses ke aplikasi di perangkatmu. Lanjutkan hanya jika kamu yang memulainya.</p>" : ""}<details><summary>Detail koneksi</summary><small>${esc(consent.redirectUri)}</small><small>Izin: ${consent.scope.map(esc).join(", ") || "blog:manage"}</small></details></footer>` : ""}
</main></body></html>`,
      {
        status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "same-origin",
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag": "noindex, nofollow",
          "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'${callbackOrigin ? ` ${callbackOrigin}` : ""}; frame-ancestors 'none'; base-uri 'none'`,
          ...(cookie ? { "Set-Cookie": cookie } : {}),
        },
      }
    );
}

export function loginForm(csrf: string, consent: ConsentDescription, error?: string, username = "") {
  return `<h1>Masuk ke blog.</h1><p class="intro">Hubungkan <strong>${esc(consent.clientName)}</strong> untuk mengelola tulisanmu. Gunakan username dan password admin blog.</p>${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}<form method="post"><input type="hidden" name="csrf" value="${esc(csrf)}"><label>Username<input name="username" autocomplete="username" maxlength="200" value="${esc(username)}" required></label><label>Password<input name="password" type="password" autocomplete="current-password" maxlength="1000" required></label><button>Masuk</button></form><p class="hint">Kamu akan meninjau izin sebelum koneksi dibuat.</p>`;
}

export function consentBody(csrf: string, consent: ConsentDescription, scope: string[]) {
  return `<h1>Izinkan akses ke blog?</h1><p class="intro"><strong>${esc(consent.clientName)}</strong> akan dapat mengelola blog ini dengan izin admin.</p><ul class="permissions"><li>Membaca draft dan mengubah konten</li><li>Menerbitkan dan menghapus tulisan</li><li>Mengimpor dan mengelola gambar</li><li>Mengubah pengaturan blog</li>${scope.includes("offline_access") ? "<li>Menjaga koneksi tanpa perlu login setiap kali</li>" : ""}</ul><form method="post"><input type="hidden" name="csrf" value="${esc(csrf)}"><div class="actions"><button name="decision" value="allow">Izinkan akses</button><button class="secondary" name="decision" value="deny">Batalkan</button></div></form><p class="hint">Koneksi baru tidak memutus akun Claude lain yang sudah terhubung.</p>`;
}
