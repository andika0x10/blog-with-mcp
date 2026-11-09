import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { settings as settingsTable } from "./db/schema";
import { siteConfig } from "../config";
import { AppError, contentInput, pathFor, reserved, settingsSchema, type ContentInput, type SiteSettings } from "./validation";
import { hash, randomToken } from "./crypto";

export type Revision = ContentInput & { id: string; content_id: string; created_at: string };
type RawRevision = Omit<Revision, "seoTitle" | "seoDescription"> & { seo_title: string; seo_description: string };
export type Content = {
  id: string;
  kind: "post" | "page";
  version: number;
  draft_id: string;
  published_id: string | null;
  published_at: string | null;
  trashed_at: string | null;
  updated_at: string;
};
export type PublicContent = Revision & { kind: "post" | "page"; published_at: string; url: string; contentId: string };
const normalize = (r: RawRevision): Revision => ({ ...r, seoTitle: r.seo_title, seoDescription: r.seo_description });
export class ContentService {
  constructor(public db: D1Database) {}
  async settings(): Promise<SiteSettings> {
    const rows = await drizzle(this.db).select().from(settingsTable);
    return settingsSchema.parse({ ...siteConfig, ...Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) });
  }
  async updateSettings(patch: Partial<SiteSettings>) {
    settingsSchema.partial().parse(patch);
    const merged = settingsSchema.parse({ ...(await this.settings()), ...patch });
    const entries = Object.entries(patch);
    if (entries.length)
      await drizzle(this.db)
        .insert(settingsTable)
        .values(entries.map(([key, value]) => ({ key, value: JSON.stringify(value) })))
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: sqlExcludedValue() } });
    return merged;
  }
  async resetSettings(keys: string[]) {
    for (const key of keys) {
      if (!(key in siteConfig)) throw new AppError("Pengaturan tidak dikenal.");
      await drizzle(this.db).delete(settingsTable).where(eq(settingsTable.key, key));
    }
    return this.settings();
  }
  async identity(id: string) {
    const c = await this.db.prepare("SELECT * FROM contents WHERE id = ?").bind(id).first<Content>();
    if (!c) throw new AppError("Konten tidak ditemukan.", 404);
    return c;
  }
  async revision(id: string) {
    const r = await this.db.prepare("SELECT * FROM revisions WHERE id = ?").bind(id).first<RawRevision>();
    if (!r) throw new AppError("Revisi tidak ditemukan.", 404);
    return normalize(r);
  }
  async get(id: string) {
    const c = await this.identity(id),
      draft = await this.revision(c.draft_id);
    return {
      ...c,
      draft,
      published: c.published_id ? await this.revision(c.published_id) : null,
      status: c.trashed_at ? "trash" : c.published_id ? "published" : "draft",
      url: pathFor(c.kind, draft.slug),
    };
  }
  async list(options: { query?: string; kind?: string; status?: string; limit?: number; offset?: number } = {}) {
    const conditions: string[] = [],
      args: (string | number)[] = [];
    if (options.kind) {
      conditions.push("c.kind = ?");
      args.push(options.kind);
    }
    if (options.status === "trash") conditions.push("c.trashed_at IS NOT NULL");
    else {
      conditions.push("c.trashed_at IS NULL");
      if (options.status === "draft") conditions.push("c.published_id IS NULL");
      if (options.status === "published") conditions.push("c.published_id IS NOT NULL");
    }
    if (options.query) {
      conditions.push("(r.title LIKE ? ESCAPE '\\' OR r.markdown LIKE ? ESCAPE '\\')");
      const q = `%${options.query.replace(/[\\%_]/g, "\\$&")}%`;
      args.push(q, q);
    }
    return (
      await this.db
        .prepare(
          `SELECT c.*, r.title, r.slug, r.summary FROM contents c JOIN revisions r ON r.id=c.draft_id WHERE ${conditions.join(" AND ")} ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`
        )
        .bind(...args, Math.min(options.limit ?? 20, 100), options.offset ?? 0)
        .all()
    ).results;
  }
  private validate(kind: string, input: ContentInput) {
    const data = contentInput.parse(input);
    if (kind === "page" && reserved.has(data.slug)) throw new AppError("Slug ini digunakan oleh sistem.");
    if (data.image && !/^\/media\/[a-f0-9-]+$/.test(data.image) && !/^https:\/\//.test(data.image)) throw new AppError("Gambar harus memakai URL HTTPS atau /media/id.");
    return data;
  }
  private insertRevision(id: string, contentId: string, d: ContentInput, token: string) {
    return this.db
      .prepare(`INSERT INTO revisions SELECT ?,id,?,?,?,?,?,?,?,? FROM contents WHERE id=? AND mutation=?`)
      .bind(id, d.title, d.slug, d.summary, d.markdown, d.seoTitle, d.seoDescription, d.image, new Date().toISOString(), contentId, token);
  }
  private reserve(contentId: string, kind: string, slug: string, token: string) {
    return this.db
      .prepare(
        "INSERT INTO routes(path, content_id, live) SELECT ?, id, 0 FROM contents WHERE id=? AND mutation=? ON CONFLICT(path) DO UPDATE SET content_id=excluded.content_id WHERE routes.content_id=excluded.content_id RETURNING content_id"
      )
      .bind(pathFor(kind, slug), contentId, token);
  }
  private async assertAvailable(id: string, kind: string, slug: string) {
    const row = await this.db.prepare("SELECT content_id FROM routes WHERE path=?").bind(pathFor(kind, slug)).first<{ content_id: string }>();
    if (row && row.content_id !== id) throw new AppError("Slug sudah digunakan atau dicadangkan oleh redirect.", 409);
  }
  async create(kind: "post" | "page", input: ContentInput) {
    const d = this.validate(kind, input),
      id = crypto.randomUUID(),
      rev = crypto.randomUUID(),
      token = randomToken();
    await this.assertAvailable(id, kind, d.slug);
    // The UNIQUE path constraint aborts the complete batch on a concurrent slug collision.
    await this.db.batch([
      this.db.prepare("INSERT INTO contents(id,kind,version,draft_id,updated_at,mutation) VALUES(?,?,1,?,?,?)").bind(id, kind, rev, new Date().toISOString(), token),
      this.insertRevision(rev, id, d, token),
      this.db.prepare("INSERT INTO routes(path,content_id,live) VALUES(?,?,0)").bind(pathFor(kind, d.slug), id),
    ]);
    return this.get(id);
  }
  async update(id: string, expectedVersion: number, input: ContentInput) {
    const c = await this.identity(id);
    if (c.trashed_at) throw new AppError("Pulihkan konten dari trash sebelum menyunting.");
    const d = this.validate(c.kind, input),
      rev = crypto.randomUUID(),
      token = randomToken();
    await this.assertAvailable(id, c.kind, d.slug);
    const result = await this.db.batch([
      this.db
        .prepare("UPDATE contents SET version=version+1, mutation=?, draft_id=?, updated_at=? WHERE id=? AND version=? AND trashed_at IS NULL RETURNING id")
        .bind(token, rev, new Date().toISOString(), id, expectedVersion),
      this.insertRevision(rev, id, d, token),
      // A conflicting path must throw, not silently skip, so the batch rolls back.
      this.db
        .prepare(
          "INSERT INTO routes(path,content_id,live) SELECT ?,id,0 FROM contents WHERE id=? AND mutation=? ON CONFLICT(path) DO UPDATE SET content_id=CASE WHEN routes.content_id=excluded.content_id THEN routes.content_id ELSE NULL END"
        )
        .bind(pathFor(c.kind, d.slug), id, token),
    ]);
    if (!result[0].results.length) throw new AppError("Versi berubah. Baca ulang konten sebelum menyunting.", 409);
    return this.get(id);
  }
  async transition(id: string, expectedVersion: number, action: "publish" | "unpublish" | "trash" | "restore") {
    const c = await this.identity(id),
      token = randomToken(),
      now = new Date().toISOString();
    if (c.trashed_at && action !== "restore") throw new AppError("Konten berada di trash.");
    if (!c.trashed_at && action === "restore") throw new AppError("Konten tidak berada di trash.");
    const sets = {
      publish: "published_id=draft_id, published_at=COALESCE(published_at, ?)",
      unpublish: "published_id=NULL",
      trash: "trashed_at=?, published_id=NULL",
      restore: "trashed_at=NULL, published_id=NULL",
    };
    const args = action === "publish" || action === "trash" ? [now] : [];
    const stmts = [
      this.db
        .prepare(`UPDATE contents SET ${sets[action]}, version=version+1, mutation=?, updated_at=? WHERE id=? AND version=? RETURNING id`)
        .bind(...args, token, now, id, expectedVersion),
      this.db.prepare("DELETE FROM search_index WHERE content_id IN (SELECT id FROM contents WHERE id=? AND mutation=?)").bind(id, token),
    ];
    if (action === "publish") {
      stmts.push(
        this.db
          .prepare(
            "UPDATE routes SET live=1 WHERE path=(SELECT CASE kind WHEN 'post' THEN '/posts/' ELSE '/' END || r.slug FROM contents c JOIN revisions r ON r.id=c.draft_id WHERE c.id=? AND c.mutation=?)"
          )
          .bind(id, token)
      );
      stmts.push(
        this.db
          .prepare(
            "INSERT INTO search_index(content_id,title,summary,markdown) SELECT c.id,r.title,r.summary,r.markdown FROM contents c JOIN revisions r ON r.id=c.published_id WHERE c.id=? AND c.mutation=?"
          )
          .bind(id, token)
      );
    }
    const result = await this.db.batch(stmts);
    if (!result[0].results.length) throw new AppError("Versi berubah. Baca ulang konten.", 409);
    return this.get(id);
  }
  async history(id: string, limit = 20, offset = 0) {
    await this.identity(id);
    return (await this.db.prepare("SELECT id,title,slug,created_at FROM revisions WHERE content_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(id, limit, offset).all())
      .results;
  }
  async restoreRevision(id: string, expectedVersion: number, revisionId: string) {
    const r = await this.revision(revisionId);
    if (r.content_id !== id) throw new AppError("Revisi bukan milik konten ini.");
    return this.update(id, expectedVersion, r);
  }
  async permanentDelete(id: string, expectedVersion: number) {
    const c = await this.identity(id);
    if (!c.trashed_at) throw new AppError("Pindahkan konten ke trash terlebih dahulu.");
    const result = await this.db.batch([
      this.db.prepare("DELETE FROM search_index WHERE content_id IN (SELECT id FROM contents WHERE id=? AND version=? AND trashed_at IS NOT NULL)").bind(id, expectedVersion),
      this.db.prepare("DELETE FROM contents WHERE id=? AND version=? AND trashed_at IS NOT NULL RETURNING id").bind(id, expectedVersion),
    ]);
    if (!result[1].results.length) throw new AppError("Versi berubah. Baca ulang konten.", 409);
    return { id, deleted: true };
  }
  async preview(id: string) {
    const c = await this.identity(id);
    if (c.trashed_at) throw new AppError("Konten berada di trash.");
    const token = randomToken(),
      expires = Date.now() + 3600000;
    await this.db.batch([
      this.db.prepare("DELETE FROM previews WHERE expires_at < ?").bind(Date.now()),
      this.db.prepare("INSERT INTO previews VALUES(?,?,?)").bind(await hash(token), c.draft_id, expires),
    ]);
    return { id, path: `/preview/${token}`, expiresAt: new Date(expires).toISOString() };
  }
  async readPreview(token: string) {
    const r = await this.db
      .prepare(
        "SELECT r.* FROM previews p JOIN revisions r ON r.id=p.revision_id JOIN contents c ON c.id=r.content_id WHERE p.token_hash=? AND p.expires_at>? AND c.trashed_at IS NULL"
      )
      .bind(await hash(token), Date.now())
      .first<RawRevision>();
    return r ? normalize(r) : null;
  }
  async publicList({ page = 1, query, kind = "post", limit = 10 }: { page?: number; query?: string; kind?: string; limit?: number } = {}): Promise<PublicContent[]> {
    const args: (string | number)[] = [],
      conditions = ["c.published_id IS NOT NULL", "c.trashed_at IS NULL"];
    if (kind !== "all") {
      conditions.push("c.kind=?");
      args.push(kind);
    }
    if (query !== undefined) {
      const terms = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 16);
      if (!terms?.length) return [];
      conditions.push("c.id IN (SELECT content_id FROM search_index WHERE search_index MATCH ?)");
      args.push(terms.map((t) => `"${t}"*`).join(" AND "));
    }
    const rows = (
      await this.db
        .prepare(
          `SELECT r.*,c.kind,c.published_at,c.id AS contentId FROM contents c JOIN revisions r ON r.id=c.published_id WHERE ${conditions.join(" AND ")} ORDER BY c.published_at DESC,c.id DESC LIMIT ? OFFSET ?`
        )
        .bind(...args, limit, (page - 1) * limit)
        .all<RawRevision & { kind: "post" | "page"; published_at: string; contentId: string }>()
    ).results;
    return rows.map((r) => ({ ...normalize(r), kind: r.kind, published_at: r.published_at, url: pathFor(r.kind, r.slug), contentId: r.contentId }));
  }
  async publicPath(path: string): Promise<{ post: PublicContent; redirect: boolean } | null> {
    const row = await this.db
      .prepare(
        "SELECT r.*,c.kind,c.published_at,c.id AS contentId, routes.live FROM routes JOIN contents c ON c.id=routes.content_id JOIN revisions r ON r.id=c.published_id WHERE routes.path=? AND c.trashed_at IS NULL"
      )
      .bind(path)
      .first<RawRevision & { kind: "post" | "page"; published_at: string; contentId: string; live: number }>();
    if (!row || !row.live) return null;
    const post = { ...normalize(row), kind: row.kind, published_at: row.published_at, url: pathFor(row.kind, row.slug), contentId: row.contentId };
    return { post, redirect: path !== post.url };
  }
}
import { sql } from "drizzle-orm";
function sqlExcludedValue() {
  return sql`excluded.value`;
}
