import { beforeAll, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { assertPublicUrl, downloadImage, MediaService, MAX_MEDIA_BYTES } from "../lib/media";
import { hash } from "../lib/crypto";
import { ContentService } from "../lib/content";
import { contentInput } from "../lib/validation";
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1kAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
beforeAll(async () => {
  await env.DB.exec(env.MIGRATION.replace(/\n/g, " "));
});
it("rejects private IPs, credentials, unsafe schemes, and private redirects", async () => {
  for (const u of [
    "http://example.com/a.png",
    "https://127.0.0.1/a",
    "https://169.254.169.254/a",
    "https://10.0.0.1/a",
    "https://[::1]/a",
    "https://user:pass@example.com/a",
    "https://localhost/a",
  ])
    expect(() => assertPublicUrl(u)).toThrow();
  await expect(downloadImage("https://example.com/a", async () => new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/a" } }))).rejects.toThrow("internal");
});
it("validates actual format and rejects oversized streamed downloads", async () => {
  const image = await downloadImage("https://example.com/a", async () => new Response(png, { headers: { "Content-Type": "image/png" } }));
  expect(image.mime).toBe("image/png");
  await expect(downloadImage("https://example.com/a", async () => new Response(png, { headers: { "Content-Type": "image/jpeg" } }))).rejects.toThrow("MIME");
  await expect(downloadImage("https://example.com/a", async () => new Response(new Uint8Array(MAX_MEDIA_BYTES + 1), { headers: { "Content-Type": "image/png" } }))).rejects.toThrow(
    "1,5 MB"
  );
  await expect(downloadImage("https://example.com/a", async () => new Response("<script/>", { headers: { "Content-Type": "image/png" } }))).rejects.toThrow("Format");
});
it("serves binary BLOBs with ETags and prevents deleting referenced media", async () => {
  const id = crypto.randomUUID(),
    etag = await hash(png),
    media = new MediaService(env.DB);
  await env.DB.prepare("INSERT INTO media VALUES(?,?,?,?,?,?,?)").bind(id, "image/png", png.buffer, png.length, "Gambar", etag, new Date().toISOString()).run();
  const response = await media.response(id, new Request(`https://blog.example.com/media/${id}`));
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  expect((await media.response(id, new Request(`https://blog.example.com/media/${id}`, { headers: { "If-None-Match": `"${etag}"` } }))).status).toBe(304);
  await new ContentService(env.DB).create("post", contentInput.parse({ title: "Gambar", slug: "gambar", markdown: `![Gambar](/media/${id})` }));
  await expect(media.delete(id)).rejects.toThrow("digunakan");
  expect((await media.update(id, "Alt baru")).alt).toBe("Alt baru");
});
