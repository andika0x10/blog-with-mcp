import { DurableObject } from "cloudflare:workers";
export class LoginLimiter extends DurableObject<Env> {
  async attempt() {
    const now = Date.now();
    const state = await this.ctx.storage.get<{ count: number; reset: number }>("attempts");
    const next = !state || state.reset <= now ? { count: 1, reset: now + 900000 } : { count: state.count + 1, reset: state.reset };
    await this.ctx.storage.put("attempts", next);
    await this.ctx.storage.setAlarm(next.reset);
    return { allowed: next.count <= 5, retryAfter: Math.ceil((next.reset - now) / 1000) };
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
