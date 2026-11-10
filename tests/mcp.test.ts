import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { ContentService } from "../lib/content";
import { MediaService } from "../lib/media";
import { mcpClient } from "./mcp-client";

type Receipt = { id: string; version: number; status: string; url: string; draftRevisionId: string; publishedRevisionId: string | null };
type Read = Receipt & {
  revisionId: string;
  markdown: string;
  totalLength: number;
  nextOffset: number | null;
  title: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  image: string;
};
type Page<T = Record<string, unknown>> = { items: T[]; nextOffset: number | null };
const contents = new ContentService(env.DB);
const data = (slug = "artikel", markdown = "Isi awal.\n\nBagian kedua.") => ({
  title: "Artikel",
  slug,
  markdown,
  summary: "Ringkasan",
  seoTitle: "SEO",
  seoDescription: "Deskripsi",
  image: "https://example.com/image.png",
});
const create = (client: ReturnType<typeof mcpClient>, content = data()) => client.call<Receipt>("write_content", { action: "create", kind: "post", content });
const read = (client: ReturnType<typeof mcpClient>, id: string, extra = {}) => client.call<Read>("read_content", { action: "get", id, ...extra });

beforeAll(async () => {
  await env.DB.exec(env.MIGRATION.replace(/\n/g, " "));
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM contents"),
    env.DB.prepare("DELETE FROM search_index"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("DELETE FROM media"),
  ]);
});

describe("MCP v2 contract", () => {
  it("advertises 12 tools, shared schemas and accurate side-effect annotations", async () => {
    const message = await mcpClient().rpc("tools/list");
    const tools = message.result.tools as {
      name: string;
      inputSchema: { properties: Record<string, unknown>; required?: string[]; additionalProperties: boolean };
      annotations: Record<string, boolean>;
    }[];
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "read_content",
        "write_content",
        "publication",
        "trash_content",
        "permanent_delete_content",
        "create_preview",
        "get_settings",
        "write_settings",
        "read_media",
        "import_media",
        "update_media",
        "delete_media",
      ].sort()
    );
    for (const t of tools) {
      expect(t.inputSchema.additionalProperties).toBe(false);
      const readOnly = ["read_content", "read_media", "get_settings"].includes(t.name);
      expect(t.annotations).toEqual({
        readOnlyHint: readOnly,
        idempotentHint: readOnly,
        destructiveHint: ["publication", "trash_content", "permanent_delete_content", "delete_media"].includes(t.name),
        openWorldHint: t.name === "import_media",
      });
    }
    const input = tools.find((t) => t.name === "write_content")!.inputSchema;
    expect(input.required).toEqual(["action"]);
    expect(input.properties).toHaveProperty("content");
    expect(input).not.toHaveProperty("oneOf");
    expect(input).not.toHaveProperty("anyOf");
  });

  it.each([
    ["read_content", { action: "get" }],
    ["read_content", { action: "revisions" }],
    ["read_content", { action: "revision" }],
    ["read_content", { action: "list", id: crypto.randomUUID() }],
    ["write_content", { action: "create", kind: "post", content: { title: "Incomplete" } }],
    ["write_content", { action: "update" }],
    ["write_content", { action: "restore" }],
    ["write_content", { action: "restore_revision" }],
    ["publication", { action: "publish" }],
    ["publication", { action: "unpublish" }],
    ["write_settings", { action: "update" }],
    ["write_settings", { action: "reset" }],
    ["read_media", { action: "get" }],
    ["read_media", { action: "list", id: crypto.randomUUID() }],
    ["read_content", { action: "invalid" }],
    ["write_content", { action: "invalid" }],
  ])("rejects missing/irrelevant arguments for %s %j", async (name, args) => {
    await expect(mcpClient().call(name, args)).rejects.toThrow();
    expect(await contents.list()).toHaveLength(0);
  });

  it("uses small receipts, preserves omitted metadata, and does not publish edits", async () => {
    const client = mcpClient();
    const c = await create(client);
    expect(Object.keys(c).sort()).toEqual(["id", "version", "status", "url", "draftRevisionId", "publishedRevisionId"].sort());
    expect(await contents.publicList()).toHaveLength(0);
    const published = await client.call<Receipt>("publication", { action: "publish", id: c.id, expectedVersion: c.version });
    const edited = await client.call<Receipt>("write_content", { action: "update", id: c.id, expectedVersion: published.version, content: { title: "Judul baru" } });
    const draft = await read(client, c.id);
    expect(draft).toMatchObject({ title: "Judul baru", markdown: data().markdown, summary: "Ringkasan", seoTitle: "SEO", seoDescription: "Deskripsi", image: data().image });
    expect((await read(client, c.id, { view: "published" })).title).toBe("Artikel");
    expect(edited.version).toBe(published.version + 1);
    expect(edited).not.toHaveProperty("markdown");
    await client.call("write_content", { action: "update", id: c.id, expectedVersion: edited.version, content: { summary: "", image: "" } });
    expect(await read(client, c.id)).toMatchObject({ summary: "", image: "", seoTitle: "SEO" });
  });

  it("pages Unicode code points, supports metadata reads, and pins continuation to immutable revisions", async () => {
    const client = mcpClient();
    const markdown = "😀".repeat(3999) + "終" + "🦊".repeat(5001);
    const c = await create(client, data("unicode", markdown));
    const first = await read(client, c.id);
    expect(Array.from(first.markdown)).toHaveLength(4000);
    expect(first.markdown.endsWith("終")).toBe(true);
    expect(first.totalLength).toBe(9001);
    expect(first.nextOffset).toBe(4000);
    expect(await read(client, c.id, { length: 0 })).toMatchObject({ markdown: "", nextOffset: 0, totalLength: 9001 });
    const edited = await client.call<Receipt>("write_content", { action: "update", id: c.id, expectedVersion: c.version, content: { markdown: "Changed" } });
    expect(edited.draftRevisionId).not.toBe(first.revisionId);
    const rest = await client.call<Read>("read_content", { action: "revision", revisionId: first.revisionId, offset: first.nextOffset, length: 12000 });
    expect(first.markdown + rest.markdown).toBe(markdown);
    expect(rest.nextOffset).toBeNull();
    expect(await client.call("read_content", { action: "revision", revisionId: first.revisionId, offset: 20000 })).toMatchObject({ markdown: "", nextOffset: null });
    for (const extra of [{ length: 12001 }, { length: -1 }, { offset: -1 }]) await expect(read(client, c.id, extra)).rejects.toThrow();
  });

  it("handles empty Markdown, missing published views, and unknown revisions", async () => {
    const client = mcpClient();
    const c = await create(client, data("empty", ""));
    expect(await read(client, c.id)).toMatchObject({ markdown: "", totalLength: 0, nextOffset: null });
    await expect(read(client, c.id, { view: "published" })).rejects.toThrow("draft");
    await expect(client.call("read_content", { action: "revision", revisionId: crypto.randomUUID() })).rejects.toThrow("404");
    const result = await read(client, c.id);
    for (const key of ["mutation", "seo_title", "seo_description", "content_id", "draft", "published"]) expect(result).not.toHaveProperty(key);
  });

  it("applies sequential replacements once and rolls back mismatches, ambiguous matches and stale edits", async () => {
    const client = mcpClient();
    const c = await create(client, data("replace", "Satu. Dua. aaa"));
    const edited = await client.call<Receipt>("write_content", {
      action: "update",
      id: c.id,
      expectedVersion: c.version,
      content: { summary: "Updated" },
      replacements: [
        { oldText: "Satu.", newText: "Tiga." },
        { oldText: "Tiga. Dua.", newText: "Selesai." },
      ],
    });
    expect((await read(client, c.id)).markdown).toBe("Selesai. aaa");
    const before = await contents.history(c.id);
    for (const patch of [
      {
        replacements: [
          { oldText: "Selesai.", newText: "Hampir." },
          { oldText: "missing", newText: "x" },
        ],
      },
      { replacements: [{ oldText: "aa", newText: "x" }] },
      { replacements: [{ oldText: "", newText: "x" }] },
      { content: { markdown: "x" }, replacements: [{ oldText: "aaa", newText: "x" }] },
      { content: {} },
      { content: { unexpected: "x" } },
    ])
      await expect(client.call("write_content", { action: "update", id: c.id, expectedVersion: edited.version, ...patch })).rejects.toThrow();
    await expect(client.call("write_content", { action: "update", id: c.id, expectedVersion: c.version, content: { slug: "reserved-by-stale" } })).rejects.toThrow("409");
    expect(await contents.history(c.id)).toEqual(before);
    expect((await read(client, c.id)).markdown).toBe("Selesai. aaa");
    expect(await env.DB.prepare("SELECT * FROM routes WHERE path='/posts/reserved-by-stale'").first()).toBeNull();
    const replaced = await client.call<Receipt>("write_content", { action: "update", id: c.id, expectedVersion: edited.version, content: { markdown: "Full replacement" } });
    expect(replaced.version).toBe(edited.version + 1);
    expect((await read(client, c.id)).markdown).toBe("Full replacement");
  });

  it("retains previews, publishing, revision restoration, trash restoration and permanent deletion", async () => {
    const client = mcpClient();
    let c = await create(client);
    const original = c.draftRevisionId;
    const preview = await client.call<{ url: string; expiresAt: string }>("create_preview", { id: c.id });
    expect(preview.url).toMatch(/^https:\/\/blog.example.com\/preview\//);
    expect(preview).not.toHaveProperty("path");
    c = await client.call<Receipt>("publication", { action: "publish", id: c.id, expectedVersion: c.version });
    c = await client.call<Receipt>("write_content", { action: "update", id: c.id, expectedVersion: c.version, content: { markdown: "Draft edit" } });
    c = await client.call<Receipt>("write_content", { action: "restore_revision", id: c.id, expectedVersion: c.version, revisionId: original });
    expect((await read(client, c.id)).markdown).toBe(data().markdown);
    expect(c.publishedRevisionId).toBe(original);
    c = await client.call<Receipt>("publication", { action: "unpublish", id: c.id, expectedVersion: c.version });
    expect(c.status).toBe("draft");
    await expect(client.call("permanent_delete_content", { id: c.id, expectedVersion: c.version })).rejects.toThrow("trash");
    c = await client.call<Receipt>("trash_content", { id: c.id, expectedVersion: c.version });
    await expect(client.call("write_content", { action: "update", id: c.id, expectedVersion: c.version, content: { title: "No" } })).rejects.toThrow("trash");
    expect((await client.call<Page>("read_content", { action: "list", status: "trash" })).items).toHaveLength(1);
    c = await client.call<Receipt>("write_content", { action: "restore", id: c.id, expectedVersion: c.version });
    expect(c.status).toBe("draft");
    c = await client.call<Receipt>("trash_content", { id: c.id, expectedVersion: c.version });
    expect(await client.call("permanent_delete_content", { id: c.id, expectedVersion: c.version })).toEqual({ id: c.id, deleted: true });
    await expect(read(client, c.id)).rejects.toThrow("404");
    expect(await contents.readPreview(new URL(preview.url).pathname.split("/").pop()!)).toBeNull();
  });

  it("allows only one concurrent edit at the same version", async () => {
    const client = mcpClient();
    const c = await create(client);
    const results = await Promise.allSettled([
      client.call<Receipt>("write_content", { action: "update", id: c.id, expectedVersion: c.version, content: { slug: "concurrent-a" } }),
      client.call<Receipt>("write_content", { action: "update", id: c.id, expectedVersion: c.version, content: { slug: "concurrent-b" } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" && String(failed.reason)).toContain("409");
    expect(await contents.history(c.id)).toHaveLength(2);
    expect((await contents.identity(c.id)).version).toBe(c.version + 1);
    const paths = await env.DB.prepare("SELECT path FROM routes WHERE content_id=? AND path LIKE '/posts/concurrent-%'").bind(c.id).all();
    expect(paths.results).toHaveLength(1);
  });

  it("rejects restoring another content item's revision without changing history", async () => {
    const client = mcpClient();
    const c = await create(client);
    const other = await create(client, data("other"));
    await expect(client.call("write_content", { action: "restore_revision", id: c.id, expectedVersion: c.version, revisionId: other.draftRevisionId })).rejects.toThrow(
      "bukan milik"
    );
    expect(await contents.history(c.id)).toHaveLength(1);
    expect((await contents.identity(c.id)).version).toBe(c.version);
  });

  it("paginates lists deterministically, filters content and projects only useful fields", async () => {
    const client = mcpClient();
    const ids: string[] = [];
    for (let n = 0; n < 12; n++) ids.push((await create(client, data(`article-${n}`))).id);
    await env.DB.prepare("UPDATE contents SET updated_at=?").bind("2026-01-01T00:00:00.000Z").run();
    const first = await client.call<Page>("read_content", { action: "list" });
    const last = await client.call<Page>("read_content", { action: "list", offset: first.nextOffset });
    expect(first.items).toHaveLength(10);
    expect(first.nextOffset).toBe(10);
    expect(last.items).toHaveLength(2);
    expect(last.nextOffset).toBeNull();
    expect([...first.items, ...last.items].map((x) => x.id)).toEqual(ids.sort().reverse());
    expect(Object.keys(first.items[0]).sort()).toEqual(["id", "title", "kind", "status", "version", "url"].sort());
    expect((await client.call<Page>("read_content", { action: "list", query: "Bagian", kind: "post", status: "draft", limit: 50 })).items).toHaveLength(12);
    expect(await client.call("read_content", { action: "list", kind: "page" })).toEqual({ items: [], nextOffset: null });
    expect(await client.call("read_content", { action: "list", offset: 100 })).toEqual({ items: [], nextOffset: null });
    await expect(client.call("read_content", { action: "list", limit: 51 })).rejects.toThrow();
    const c = await contents.get(ids[0]);
    for (let n = 0; n < 11; n++) await contents.edit(c.id, c.version + n, { title: `Revision ${n}` });
    await env.DB.prepare("UPDATE revisions SET created_at=? WHERE content_id=?").bind("2026-01-01T00:00:00.000Z", c.id).run();
    const revisions = await client.call<Page>("read_content", { action: "revisions", id: c.id });
    const remainder = await client.call<Page>("read_content", { action: "revisions", id: c.id, offset: revisions.nextOffset });
    expect(revisions.items).toHaveLength(10);
    expect(remainder.items).toHaveLength(2);
    expect(remainder.nextOffset).toBeNull();
    const revisionIds = [...revisions.items, ...remainder.items].map((r) => r.revisionId);
    expect(revisionIds).toEqual([...revisionIds].sort().reverse());
  });

  it("returns only changed or reset settings", async () => {
    const client = mcpClient();
    const defaults = await client.call("get_settings");
    expect(await client.call("write_settings", { action: "update", settings: { name: "Nama baru", footer: "Footer" } })).toEqual({ name: "Nama baru", footer: "Footer" });
    expect(await client.call("write_settings", { action: "reset", keys: ["name"] })).toEqual({ name: defaults.name });
    expect((await client.call("get_settings")).footer).toBe("Footer");
    await expect(client.call("write_settings", { action: "update", settings: { secret: "x" } })).rejects.toThrow();
  });

  it("paginates media, returns one URL, and enforces revision references on deletion", async () => {
    const client = mcpClient();
    const ids: string[] = [];
    for (let n = 0; n < 12; n++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await env.DB.prepare("INSERT INTO media VALUES(?,?,?,?,?,?,?)").bind(id, "image/png", new ArrayBuffer(1), 1, `Alt ${n}`, "etag", "2026-01-01T00:00:00.000Z").run();
    }
    const first = await client.call<Page>("read_media", { action: "list" });
    const rest = await client.call<Page>("read_media", { action: "list", offset: first.nextOffset });
    expect(first.items).toHaveLength(10);
    expect(rest.items).toHaveLength(2);
    expect(rest.nextOffset).toBeNull();
    expect([...first.items, ...rest.items].map((m) => m.id)).toEqual(ids.sort().reverse());
    const media = await client.call("read_media", { action: "get", id: ids[0] });
    expect(Object.keys(media).sort()).toEqual(["id", "url", "mime", "size", "alt"].sort());
    expect(await client.call("update_media", { id: ids[0], alt: "Updated" })).toMatchObject({ alt: "Updated" });
    const c = await create(client, data("with-media", `![Alt](/media/${ids[0]})`));
    await client.call("write_content", { action: "update", id: c.id, expectedVersion: c.version, content: { markdown: "No image now" } });
    await expect(client.call("delete_media", { id: ids[0] })).rejects.toThrow("409");
    expect(await client.call("delete_media", { id: ids[1] })).toEqual({ id: ids[1], deleted: true });
    await expect(client.call("import_media", { url: "https://127.0.0.1/image.png", alt: "Private" })).rejects.toThrow();
    const imported = { id: crypto.randomUUID(), url: "/media/unused", alt: "Imported", mime: "image/png", size: 100 };
    vi.spyOn(MediaService.prototype, "import").mockResolvedValueOnce(imported);
    const result = await client.call("import_media", { url: "https://example.com/image.png", alt: "Imported" });
    expect(result).toEqual({ id: imported.id, url: `/media/${imported.id}`, alt: "Imported", mime: "image/png", size: 100 });
    expect(result).not.toHaveProperty("absoluteUrl");
  });
});
