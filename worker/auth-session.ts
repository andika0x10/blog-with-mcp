import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";

type Session = {
  cookieHash: string;
  csrfHash: string;
  requestUrl: string;
  authenticated: boolean;
  expiresAt: number;
};
const lifetime = 600_000;
const matches = (a: string, b: string) => timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));

/** One object per OAuth transaction; no eventually consistent KV reads. */
export class AuthSession extends DurableObject<Env> {
  async create(cookieHash: string, csrfHash: string, requestUrl: string) {
    const session: Session = { cookieHash, csrfHash, requestUrl, authenticated: false, expiresAt: Date.now() + lifetime };
    this.ctx.storage.kv.put("session", session);
    await this.ctx.storage.setAlarm(session.expiresAt);
  }

  verify(cookieHash: string, csrfHash: string, requestUrl: string) {
    const session = this.ctx.storage.kv.get<Session>("session");
    if (!session || session.expiresAt <= Date.now() || session.requestUrl !== requestUrl) return null;
    // Both inputs are SHA-256 digests made by the Worker, with fixed lengths.
    if (!matches(cookieHash, session.cookieHash) || !matches(csrfHash, session.csrfHash)) return null;
    return { authenticated: session.authenticated };
  }

  async authenticate(cookieHash: string, csrfHash: string, requestUrl: string, nextCookieHash: string, nextCsrfHash: string) {
    const session = this.verify(cookieHash, csrfHash, requestUrl);
    if (!session || session.authenticated) return false;
    // Check and rotation run synchronously, so competing requests cannot both
    // advance the same session. The old cookie and CSRF immediately stop working.
    const next: Session = { cookieHash: nextCookieHash, csrfHash: nextCsrfHash, requestUrl, authenticated: true, expiresAt: Date.now() + lifetime };
    this.ctx.storage.kv.put("session", next);
    await this.ctx.storage.setAlarm(next.expiresAt);
    return true;
  }

  consume(cookieHash: string, csrfHash: string, requestUrl: string) {
    if (!this.verify(cookieHash, csrfHash, requestUrl)?.authenticated) return false;
    this.ctx.storage.kv.delete("session");
    return true;
  }

  async alarm() {
    const session = this.ctx.storage.kv.get<Session>("session");
    // A queued alarm from an earlier session must not expire a renewed one.
    if (session && session.expiresAt > Date.now()) await this.ctx.storage.setAlarm(session.expiresAt);
    else await this.ctx.storage.deleteAll();
  }
}
