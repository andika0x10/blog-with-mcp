import OAuthProvider, { AuthorizationError, getOAuthApi, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { authorize } from "./auth";
import { mcpHandler } from "./mcp";
import { MediaService } from "../lib/media";
import { AppError } from "../lib/validation";
import { createAuthPage, esc } from "./auth-page";
export { LoginLimiter } from "./login-limiter";
export { AuthSession } from "./auth-session";

type SiteHandler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
export function createProvider(request: Request, siteHandler: SiteHandler) {
  // OAuth discovery, issuer and resource must use the origin the client connects
  // to. SITE_URL is for public content links, not browser CSRF validation.
  // Use the runtime request URL, never client-supplied forwarded-host headers.
  const site = new URL(request.url).origin;
  const options: OAuthProviderOptions<Env> = {
    apiRoute: "/mcp",
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: ["blog:manage", "offline_access"],
    requiredScopes: ["blog:manage"],
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600,
    refreshTokenTTL: 2592000,
    resourceMetadata: { resource: `${site}/mcp`, authorization_servers: [site] },
    apiHandler: {
      async fetch(request, env, ctx) {
        const authCtx = ctx as ExecutionContext & { auth?: { scope: string[] }; props?: { owner?: boolean } };
        if (!authCtx.props?.owner || !authCtx.auth?.scope.includes("blog:manage")) return new Response("Akses ditolak", { status: 403 });
        return mcpHandler(env)(request, env, ctx);
      },
    },
    defaultHandler: {
      async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === "/authorize") return authorize(request, env, getOAuthApi(options, env));
        if (url.pathname.startsWith("/media/")) {
          if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
          return new MediaService(env.DB).response(url.pathname.slice(7), request);
        }
        return siteHandler(request, env, ctx);
      },
    },
  };
  return new OAuthProvider<Env>(options);
}
export function createBlogWorker(siteHandler: SiteHandler) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      try {
        const response = await createProvider(request, siteHandler).fetch(request, env, ctx);
        const secured = new Response(response.body, response);
        secured.headers.set("X-Content-Type-Options", "nosniff");
        secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        const path = new URL(request.url).pathname;
        if (path.startsWith("/preview/") || path === "/authorize") {
          secured.headers.set("Cache-Control", "private, no-store");
          secured.headers.set("X-Robots-Tag", "noindex, nofollow");
          // Keep the form's Origin while withholding OAuth URLs from other sites.
          secured.headers.set("Referrer-Policy", path === "/authorize" ? "same-origin" : "no-referrer");
        } else if (!path.startsWith("/media/") && !path.startsWith("/_next/")) secured.headers.set("Cache-Control", "no-store");
        return secured;
      } catch (error) {
        if (new URL(request.url).pathname === "/authorize" && (error instanceof AuthorizationError || error instanceof AppError)) {
          const message = error instanceof AppError ? error.message : "Permintaan otorisasi tidak valid. Hubungkan ulang connector dari Claude.";
          return createAuthPage()(`<h1>Koneksi belum berhasil</h1><p>${esc(message)}</p>`, error instanceof AppError ? error.status : 400);
        }
        if (error instanceof AuthorizationError)
          return new Response("Permintaan otorisasi tidak valid. Hubungkan ulang connector dari Claude.", { status: 400, headers: { "Cache-Control": "no-store" } });
        if (!(error instanceof AppError))
          console.error(JSON.stringify({ event: "request_failed", path: new URL(request.url).pathname.replace(/\/preview\/.*/, "/preview/[redacted]") }));
        return new Response(error instanceof AppError ? error.message : "Permintaan gagal diproses.", {
          status: error instanceof AppError ? error.status : 500,
          headers: { "Cache-Control": "no-store" },
        });
      }
    },
  };
}
