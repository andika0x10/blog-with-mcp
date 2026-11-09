import { beforeAll, describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import type { LoginLimiter } from "../worker/login-limiter";
import { hash } from "../lib/crypto";
const base = "https://blog.example.com";
const send = (path: string, init?: RequestInit) => exports.default.fetch(new Request(base + path, { redirect: "manual", ...init }));
const csrf = (html: string) => html.match(/name="csrf" value="([a-f0-9]+)"/)![1];
const cookie = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
beforeAll(async () => {
  await env.DB.exec(env.MIGRATION.replace(/\n/g, " "));
});
async function flow(origin = base) {
  const send = (path: string, init?: RequestInit) => exports.default.fetch(new Request(origin + path, { redirect: "manual", ...init }));
  const registration = await send("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  expect(registration.status).toBe(201);
  const client = (await registration.json()) as { client_id: string };
  const verifier = "a".repeat(64),
    digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const params = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    scope: "blog:manage offline_access",
    state: "test-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: origin + "/mcp",
  });
  const path = `/authorize?${params}`;
  const login = await send(path);
  expect(login.status).toBe(200);
  return { client, verifier, path, login, loginHtml: await login.text(), send };
}
describe("OAuth and MCP", () => {
  it.each(["https://blog.test.workers.dev", "http://localhost:8787"])("completes OAuth on %s when SITE_URL points elsewhere", async (origin) => {
    const f = await flow(origin);
    const discovery = await f.send("/.well-known/oauth-authorization-server");
    expect(await discovery.json()).toMatchObject({ issuer: origin, authorization_endpoint: origin + "/authorize", token_endpoint: origin + "/oauth/token" });
    const metadata = await f.send("/.well-known/oauth-protected-resource/mcp");
    expect(await metadata.json()).toMatchObject({ resource: origin + "/mcp", authorization_servers: [origin] });
    expect(f.login.headers.get("set-cookie")).toContain(origin.startsWith("https:") ? "__Host-blog_auth=" : "blog_auth=");
    const loginBody = new URLSearchParams({ csrf: csrf(f.loginHtml), username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }).toString();
    // A valid session and CSRF token must still not permit a cross-origin POST.
    for (const attackerOrigin of [base, "https://evil.example", "null", ""]) {
      const denied = await f.send(f.path, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...(attackerOrigin ? { Origin: attackerOrigin } : {}), Cookie: cookie(f.login) },
        body: loginBody,
      });
      expect(denied.status).toBe(403);
    }
    const consent = await f.send(f.path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Cookie: cookie(f.login), "CF-Connecting-IP": crypto.randomUUID() },
      body: loginBody,
    });
    expect(consent.status).toBe(200);
    const redirect = await f.send(f.path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Cookie: cookie(consent) },
      body: new URLSearchParams({ csrf: csrf(await consent.text()), decision: "allow" }).toString(),
    });
    expect(redirect.status).toBe(302);
    const token = await f.send("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: f.client.client_id,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code: new URL(redirect.headers.get("location")!).searchParams.get("code")!,
        code_verifier: f.verifier,
        resource: origin + "/mcp",
      }).toString(),
    });
    expect(token.status).toBe(200);
    const { access_token } = (await token.json()) as { access_token: string };
    const init = {
      method: "POST",
      headers: {
        Host: new URL(origin).host,
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    };
    const tools = await f.send("/mcp", init);
    expect(tools.status, await tools.text()).toBe(200);
    // Tokens stay bound to their resource, even with the same KV backing aliases.
    expect((await send("/mcp", init)).status).toBe(401);
  });
  it("ignores forwarded host headers when advertising OAuth endpoints", async () => {
    const response = await send("/.well-known/oauth-authorization-server", {
      headers: { "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http", Forwarded: "host=evil.example;proto=http" },
    });
    expect(await response.json()).toMatchObject({ issuer: base, authorization_endpoint: base + "/authorize" });
  });
  it("requires a valid bearer token and advertises discovery", async () => {
    const r = await send("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("resource_metadata");
    expect((await send("/.well-known/oauth-authorization-server")).status).toBe(200);
    expect((await send("/mcp", { headers: { Authorization: "Bearer invalid" } })).status).toBe(401);
    const preview = await send("/preview/not-real");
    expect(preview.headers.get("cache-control")).toContain("no-store");
    expect(preview.headers.get("x-robots-tag")).toContain("noindex");
    expect(preview.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("logs in, requests consent, exchanges codes, calls tools, and rejects expired tokens", async () => {
    const f = await flow();
    expect(f.login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(f.login.headers.get("set-cookie")).toContain("Secure");
    expect(f.login.headers.get("referrer-policy")).toBe("same-origin");
    const approve = await send(f.path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, Cookie: cookie(f.login), "CF-Connecting-IP": "198.51.100.10" },
      body: new URLSearchParams({ csrf: csrf(f.loginHtml), username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }).toString(),
    });
    expect(approve.status).toBe(200);
    expect(approve.headers.get("referrer-policy")).toBe("same-origin");
    const html = await approve.text();
    expect(html).toContain("Izinkan akses");
    expect(html).toContain("claude.ai");
    const redirect = await send(f.path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, Cookie: cookie(approve) },
      body: new URLSearchParams({ csrf: csrf(html), decision: "allow" }).toString(),
    });
    expect(redirect.status).toBe(302);
    const callback = new URL(redirect.headers.get("location")!);
    expect(callback.searchParams.get("state")).toBe("test-state");
    const code = callback.searchParams.get("code")!;
    const tokenResponse = await send("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: f.client.client_id,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code,
        code_verifier: f.verifier,
        resource: base + "/mcp",
      }).toString(),
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toBeTruthy();
    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    };
    const result = await send("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
    expect(result.status).toBe(200);
    const tools = await result.text();
    expect(tools).toContain("create_content");
    expect(tools).toContain("import_media");
    const created = await send("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "create_content", arguments: { kind: "post", content: { title: "Dari Claude", slug: "dari-claude", markdown: "Disimpan lewat MCP" } } },
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = await created.text();
    expect(createdBody).toContain("Dari Claude");
    expect(createdBody).not.toContain('"isError":true');
    expect(await env.DB.prepare("SELECT id FROM contents WHERE published_id IS NULL").first()).not.toBeNull();
    const tokenHash = await hash(tokens.access_token);
    const tokenKey = (await env.OAUTH_KV.list({ prefix: "token:owner:" })).keys.find((key) => key.name.endsWith(`:${tokenHash}`))!.name;
    const tokenRecord = await env.OAUTH_KV.get<Record<string, unknown>>(tokenKey, "json");
    await env.OAUTH_KV.put(tokenKey, JSON.stringify({ ...tokenRecord, expiresAt: 0 }));
    expect((await send("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) })).status).toBe(401);
    const revoke = await send("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: f.client.client_id, refresh_token: "invalid", resource: base + "/mcp" }).toString(),
    });
    expect(revoke.status).toBe(400);
  });
  it("rejects forged CSRF and cross-origin login requests", async () => {
    const f = await flow();
    const init = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, Cookie: cookie(f.login) }, body: "csrf=invalid" };
    expect((await send(f.path, init)).status).toBe(403);
    expect((await send(f.path, { ...init, headers: { ...init.headers, Origin: "https://evil.example" } })).status).toBe(403);
    expect((await send(f.path, { ...init, headers: { ...init.headers, Origin: "null" } })).status).toBe(403);
  });
  it("rejects an expired browser login session", async () => {
    const f = await flow(),
      value = cookie(f.login).split("=")[1];
    await env.OAUTH_KV.delete(`login:${await hash(value)}`);
    expect(
      (
        await send(f.path, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, Cookie: cookie(f.login) },
          body: new URLSearchParams({ csrf: csrf(f.loginHtml), username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }).toString(),
        })
      ).status
    ).toBe(403);
  });
  it("persists login limits across eviction, isolates identities, and clears with an alarm", async () => {
    const namespace = env.LOGIN_LIMITER as DurableObjectNamespace<LoginLimiter>,
      a = namespace.getByName(crypto.randomUUID()),
      b = namespace.getByName(crypto.randomUUID());
    for (let i = 0; i < 5; i++) expect((await a.attempt()).allowed).toBe(true);
    await evictDurableObject(a);
    expect((await a.attempt()).allowed).toBe(false);
    expect((await b.attempt()).allowed).toBe(true);
    await runDurableObjectAlarm(a);
    expect((await a.attempt()).allowed).toBe(true);
  });
});
