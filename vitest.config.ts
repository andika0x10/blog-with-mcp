import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readFileSync } from "node:fs";
export default defineConfig({
  plugins: [
    cloudflareTest({
      config: false,
      main: "./tests/worker.ts",
      miniflare: {
        compatibilityDate: "2026-11-09",
        compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
        d1Databases: ["DB"],
        kvNamespaces: ["OAUTH_KV"],
        durableObjects: { LOGIN_LIMITER: { className: "LoginLimiter", useSQLite: true }, AUTH_SESSIONS: { className: "AuthSession", useSQLite: true } },
        bindings: {
          SITE_URL: "https://blog.example.com",
          ADMIN_USERNAME: "test-owner",
          ADMIN_PASSWORD: "only-for-isolated-tests",
          MIGRATION: readFileSync("migrations/0001_blog.sql", "utf8"),
        },
      },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false, testTimeout: 30000 },
});
