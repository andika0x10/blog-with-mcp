import { bindings, defineConfig, defineWorker, exports } from "cf/config";
import * as entrypoint from "./worker/index" with { type: "cf-worker" };
import { resolveSiteUrl } from "./lib/site-url.ts";

export default defineConfig(({ mode }) => ({
  worker: defineWorker({
    name: "blog",
    entrypoint,
    compatibilityDate: "2026-11-09",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    observability: { enabled: true, traces: { enabled: true } },
    exports: { LoginLimiter: exports.durableObject({ storage: "sqlite" }), AuthSession: exports.durableObject({ storage: "sqlite" }) },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      DB: bindings.d1({ name: "blog", ...(process.env.D1_DATABASE_ID ? { id: process.env.D1_DATABASE_ID } : {}) }),
      OAUTH_KV: bindings.kv(process.env.OAUTH_KV_ID ? { id: process.env.OAUTH_KV_ID } : {}),
      LOGIN_LIMITER: bindings.durableObject({ worker: "blog", exportName: "LoginLimiter" }),
      AUTH_SESSIONS: bindings.durableObject({ worker: "blog", exportName: "AuthSession" }),
      SITE_URL: bindings.text(resolveSiteUrl(process.env.SITE_URL, mode)),
      ADMIN_USERNAME: bindings.secret(),
      ADMIN_PASSWORD: bindings.secret(),
    },
  }),
}));
