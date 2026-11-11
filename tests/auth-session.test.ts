import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import type { AuthSession } from "../worker/auth-session";
import { hash } from "../lib/crypto";

const namespace = () => env.AUTH_SESSIONS as DurableObjectNamespace<AuthSession>;
const requestUrl = "https://blog.example.com/authorize?state=test";
async function fixture() {
  const stub = namespace().getByName(crypto.randomUUID());
  const cookie = await hash(crypto.randomUUID()),
    csrf = await hash(crypto.randomUUID());
  const nextCookie = await hash(crypto.randomUUID()),
    nextCsrf = await hash(crypto.randomUUID());
  await stub.create(cookie, csrf, requestUrl);
  return { stub, cookie, csrf, nextCookie, nextCsrf };
}

describe("OAuth browser sessions", () => {
  it("keeps the rotated consent session immediately available after eviction", async () => {
    const f = await fixture();
    expect(await f.stub.authenticate(f.cookie, f.csrf, requestUrl, f.nextCookie, f.nextCsrf)).toBe(true);
    await evictDurableObject(f.stub);
    expect(await f.stub.verify(f.nextCookie, f.nextCsrf, requestUrl)).toEqual({ authenticated: true });
    expect(await f.stub.verify(f.cookie, f.csrf, requestUrl)).toBeNull();
    expect(await f.stub.consume(f.nextCookie, f.nextCsrf, requestUrl)).toBe(true);
    await evictDurableObject(f.stub);
    expect(await f.stub.consume(f.nextCookie, f.nextCsrf, requestUrl)).toBe(false);
  });

  it("accepts only one competing login rotation and one competing consent", async () => {
    const f = await fixture();
    const rotations = await Promise.all([
      f.stub.authenticate(f.cookie, f.csrf, requestUrl, f.nextCookie, f.nextCsrf),
      f.stub.authenticate(f.cookie, f.csrf, requestUrl, f.nextCookie, f.nextCsrf),
    ]);
    expect(rotations.filter(Boolean)).toHaveLength(1);
    const approvals = await Promise.all([f.stub.consume(f.nextCookie, f.nextCsrf, requestUrl), f.stub.consume(f.nextCookie, f.nextCsrf, requestUrl)]);
    expect(approvals.filter(Boolean)).toHaveLength(1);
  });

  it("keeps transactions isolated and requires the cookie, CSRF, request URL and authenticated stage", async () => {
    const a = await fixture(),
      b = await fixture();
    expect(await a.stub.verify(b.cookie, a.csrf, requestUrl)).toBeNull();
    expect(await a.stub.verify(a.cookie, b.csrf, requestUrl)).toBeNull();
    expect(await a.stub.verify(a.cookie, a.csrf, requestUrl + "&other=1")).toBeNull();
    expect(await a.stub.consume(a.cookie, a.csrf, requestUrl)).toBe(false);
    expect(await b.stub.verify(b.cookie, b.csrf, requestUrl)).toEqual({ authenticated: false });
  });

  it("rejects expired sessions even before cleanup and handles a delayed alarm safely", async () => {
    const f = await fixture();
    await runDurableObjectAlarm(f.stub);
    expect(await f.stub.verify(f.cookie, f.csrf, requestUrl)).toEqual({ authenticated: false });
    await runInDurableObject(f.stub, (_instance, state) => {
      const session = state.storage.kv.get<{ expiresAt: number }>("session")!;
      state.storage.kv.put("session", { ...session, expiresAt: Date.now() - 1 });
    });
    expect(await f.stub.verify(f.cookie, f.csrf, requestUrl)).toBeNull();
    await runDurableObjectAlarm(f.stub);
    await runInDurableObject(f.stub, (_instance, state) => {
      expect(state.storage.kv.get("session")).toBeUndefined();
    });
  });
});
