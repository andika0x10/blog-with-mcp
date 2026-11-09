import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ContentService } from "../lib/content";
import { contentInput } from "../lib/validation";
const service = new ContentService(env.DB);
const data = (slug = "pertama", markdown = "Isi yang sudah terbit") => contentInput.parse({ title: "Tulisan pertama", slug, summary: "Ringkasan pertama", markdown });
beforeAll(async () => {
  await env.DB.exec(env.MIGRATION.replace(/\n/g, " "));
});
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM contents"),
    env.DB.prepare("DELETE FROM search_index"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM media"),
  ]);
});
describe("editorial lifecycle in D1", () => {
  it("keeps drafts private, publishes, preserves public content during edits, and creates redirects", async () => {
    let c = await service.create("post", data());
    expect(await service.publicList()).toHaveLength(0);
    expect(await service.publicPath("/posts/pertama")).toBeNull();
    c = await service.transition(c.id, c.version, "publish");
    expect((await service.publicList({ query: "terbit" }))[0].markdown).toContain("terbit");
    c = await service.update(c.id, c.version, data("kedua", "rahasia revisi"));
    expect((await service.publicPath("/posts/pertama"))?.post.markdown).toBe("Isi yang sudah terbit");
    expect(await service.publicPath("/posts/kedua")).toBeNull();
    expect(await service.publicList({ query: "rahasia" })).toHaveLength(0);
    c = await service.transition(c.id, c.version, "publish");
    expect((await service.publicPath("/posts/pertama"))?.redirect).toBe(true);
    expect((await service.publicPath("/posts/kedua"))?.post.markdown).toBe("rahasia revisi");
    await expect(service.create("post", data("pertama"))).rejects.toThrow("Slug");
  });
  it("rejects stale versions without creating revisions or reserved paths", async () => {
    let c = await service.create("post", data());
    const stale = c.version;
    c = await service.update(c.id, c.version, data("baru"));
    await expect(service.update(c.id, stale, data("tidak-terpakai"))).rejects.toThrow("Versi");
    expect(await service.history(c.id)).toHaveLength(2);
    expect(await env.DB.prepare("SELECT * FROM routes WHERE path='/posts/tidak-terpakai'").first()).toBeNull();
    await expect(service.transition(c.id, stale, "publish")).rejects.toThrow("Versi");
  });
  it("restores revisions into drafts, handles trash, unpublish, and permanent delete", async () => {
    let c = await service.create("post", data());
    const first = c.draft_id;
    c = await service.transition(c.id, c.version, "publish");
    c = await service.update(c.id, c.version, data("kedua"));
    c = await service.restoreRevision(c.id, c.version, first);
    expect(c.draft.slug).toBe("pertama");
    c = await service.transition(c.id, c.version, "unpublish");
    expect(await service.publicList()).toHaveLength(0);
    c = await service.transition(c.id, c.version, "publish");
    c = await service.transition(c.id, c.version, "trash");
    expect(await service.publicList()).toHaveLength(0);
    expect(await service.list({ status: "trash" })).toHaveLength(1);
    c = await service.transition(c.id, c.version, "restore");
    expect(c.published).toBeNull();
    await expect(service.permanentDelete(c.id, c.version)).rejects.toThrow("trash");
    c = await service.transition(c.id, c.version, "trash");
    await service.permanentDelete(c.id, c.version);
    expect(await env.DB.prepare("SELECT * FROM revisions WHERE content_id=?").bind(c.id).all()).toMatchObject({ results: [] });
    expect(await env.DB.prepare("SELECT * FROM routes WHERE content_id=?").bind(c.id).all()).toMatchObject({ results: [] });
  });
  it("supports standalone pages and rejects reserved slugs", async () => {
    await expect(service.create("page", data("search"))).rejects.toThrow("sistem");
    let c = await service.create("page", data("about"));
    c = await service.transition(c.id, c.version, "publish");
    expect((await service.publicPath("/about"))?.post.kind).toBe("page");
    expect(await service.publicList()).toHaveLength(0);
    expect(await service.publicList({ kind: "all", query: "terbit" })).toHaveLength(1);
  });
  it("issues immutable, expiring previews and hides trashed previews", async () => {
    let c = await service.create("post", data()),
      preview = await service.preview(c.id);
    const token = preview.path.split("/").pop()!;
    c = await service.update(c.id, c.version, data("baru", "new"));
    expect((await service.readPreview(token))?.slug).toBe("pertama");
    await env.DB.prepare("UPDATE previews SET expires_at=0").run();
    expect(await service.readPreview(token)).toBeNull();
    preview = await service.preview(c.id);
    await service.transition(c.id, c.version, "trash");
    expect(await service.readPreview(preview.path.split("/").pop()!)).toBeNull();
  });
  it("merges and resets configuration overrides", async () => {
    const defaults = await service.settings();
    await service.updateSettings({ name: "Catatan saya", navbar: [{ label: "Tentang", href: "/about" }] });
    expect((await service.settings()).name).toBe("Catatan saya");
    const s = await service.resetSettings(["name"]);
    expect(s.name).toBe(defaults.name);
    expect(s.navbar[0].href).toBe("/about");
    await expect(service.updateSettings({ navbar: [{ label: "Bad", href: "javascript:alert(1)" }] })).rejects.toThrow();
  });
  it("rolls back concurrent slug collisions atomically", async () => {
    const results = await Promise.allSettled([service.create("post", data("same")), service.create("post", data("same"))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await service.list()).toHaveLength(1);
    const total = await env.DB.prepare("SELECT count(*) AS n FROM revisions").first<{ n: number }>();
    expect(total?.n).toBe(1);
  });
  it("paginates the public index in deterministic publication order", async () => {
    for (let i = 0; i < 12; i++) {
      let c = await service.create("post", data(`post-${i}`));
      c = await service.transition(c.id, c.version, "publish");
      await env.DB.prepare("UPDATE contents SET published_at=? WHERE id=?")
        .bind(new Date(Date.UTC(2026, 0, i + 1)).toISOString(), c.id)
        .run();
    }
    const first = await service.publicList({ page: 1 }),
      second = await service.publicList({ page: 2 });
    expect(first).toHaveLength(10);
    expect(second).toHaveLength(2);
    expect(first[0].slug).toBe("post-11");
    expect(second[1].slug).toBe("post-0");
  });
});
