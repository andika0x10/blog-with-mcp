import "@cloudflare/vitest-plugin/types";
declare global {
  namespace Cloudflare {
    interface Env {
      MIGRATION: string;
    }
  }
}
