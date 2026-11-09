import ipaddr from "ipaddr.js";
import { AppError } from "./validation";
import { hash } from "./crypto";
export const MAX_MEDIA_BYTES = 1_500_000;
export function assertPublicUrl(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new AppError("URL gambar tidak valid.");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !host.includes(".") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost") ||
    host.endsWith(".test") ||
    host === "localhost"
  )
    throw new AppError("Gunakan URL HTTPS publik.");
  if (ipaddr.isValid(host) && ipaddr.process(host).range() !== "unicast") throw new AppError("Alamat internal tidak diizinkan.");
  return u;
}
export function sniffImage(b: Uint8Array) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) return "image/png";
  const s = new TextDecoder("ascii").decode(b.subarray(0, 12));
  if (s.startsWith("GIF87a") || s.startsWith("GIF89a")) return "image/gif";
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return "image/webp";
  throw new AppError("Format gambar harus JPEG, PNG, WebP, atau GIF.");
}
export async function downloadImage(value: string, fetcher: typeof fetch = fetch) {
  let url = assertPublicUrl(value);
  const signal = AbortSignal.timeout(15000);
  for (let i = 0; i < 5; i++) {
    // global_fetch_strictly_public additionally blocks DNS resolving to private IPs.
    const response = await fetcher(url.toString(), { redirect: "manual", signal, headers: { Accept: "image/jpeg,image/png,image/webp,image/gif" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new AppError("Redirect gambar tidak valid.");
      url = assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new AppError("Gambar gagal diunduh.");
    }
    if (Number(response.headers.get("content-length")) > MAX_MEDIA_BYTES) {
      await response.body.cancel();
      throw new AppError("Gambar melebihi 1,5 MB.");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.length;
        if (size > MAX_MEDIA_BYTES) throw new AppError("Gambar melebihi 1,5 MB.");
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const mime = sniffImage(bytes),
      declared = response.headers.get("content-type")?.split(";")[0].trim();
    if (declared !== mime) throw new AppError("Isi file tidak cocok dengan MIME gambar.");
    return { bytes, mime };
  }
  throw new AppError("Terlalu banyak redirect gambar.");
}
export class MediaService {
  constructor(private db: D1Database) {}
  async import(url: string, alt: string) {
    const { bytes, mime } = await downloadImage(url),
      id = crypto.randomUUID(),
      etag = await hash(bytes);
    await this.db.prepare("INSERT INTO media VALUES(?,?,?,?,?,?,?)").bind(id, mime, bytes.buffer, bytes.length, alt, etag, new Date().toISOString()).run();
    return { id, url: `/media/${id}`, mime, size: bytes.length, alt };
  }
  async list(limit = 20, offset = 0) {
    return (await this.db.prepare("SELECT id,mime,size,alt,created_at FROM media ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all()).results;
  }
  async get(id: string) {
    const m = await this.db
      .prepare("SELECT id,mime,size,alt,created_at FROM media WHERE id=?")
      .bind(id)
      .first<{ id: string; mime: string; size: number; alt: string; created_at: string }>();
    if (!m) throw new AppError("Gambar tidak ditemukan.", 404);
    return { ...m, url: `/media/${id}` };
  }
  async update(id: string, alt: string) {
    await this.get(id);
    await this.db.prepare("UPDATE media SET alt=? WHERE id=?").bind(alt, id).run();
    return this.get(id);
  }
  async delete(id: string) {
    const url = `/media/${id}`;
    // Historical revisions also retain their media references for reliable restores.
    const result = await this.db
      .prepare("DELETE FROM media WHERE id=? AND NOT EXISTS (SELECT 1 FROM revisions WHERE instr(markdown,?)>0 OR instr(image,?)>0) RETURNING id")
      .bind(id, url, url)
      .all();
    if (!result.results.length) throw new AppError("Gambar tidak ditemukan atau masih digunakan dalam konten/revisi.", 409);
    return { id, deleted: true };
  }
  async response(id: string, request: Request) {
    const m = await this.db.prepare("SELECT * FROM media WHERE id=?").bind(id).first<{ bytes: number[] | ArrayBuffer; mime: string; etag: string; size: number }>();
    if (!m) return new Response("Gambar tidak ditemukan", { status: 404 });
    const etag = `"${m.etag}"`,
      headers = { "Content-Type": m.mime, ETag: etag, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Length": String(m.size) };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : new Uint8Array(m.bytes), { headers });
  }
}
