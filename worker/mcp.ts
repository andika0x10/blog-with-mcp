import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { ContentService, type Content, type Revision } from "../lib/content";
import { MediaService } from "../lib/media";
import { AppError, contentInput, contentPatch, pathFor, settingsSchema } from "../lib/validation";

type Shape = Record<string, z.ZodType>;
type Mode = "read" | "write" | "delete";
const id = { id: z.uuid() };
const versioned = { ...id, expectedVersion: z.number().int().positive() };
const pagination = { limit: z.number().int().min(1).max(50).optional(), offset: z.number().int().min(0).optional() };
const range = { offset: pagination.offset, length: z.number().int().min(0).max(12000).optional() };
const revisionId = z.uuid();
const kind = z.enum(["post", "page"]);
const status = z.enum(["draft", "published", "trash"]);

function operation<S extends Shape>(shape: S, run: (input: z.output<z.ZodObject<S>>) => Promise<unknown>) {
  const schema = z.object(shape).strict();
  return { shape, run: (input: unknown) => run(schema.parse(input)) };
}
function page<T>(rows: T[], limit = 10, offset = 0) {
  return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
}
function state(c: Content, slug: string) {
  return {
    id: c.id,
    version: c.version,
    status: c.trashed_at ? "trash" : c.published_id ? "published" : "draft",
    url: pathFor(c.kind, slug),
    draftRevisionId: c.draft_id,
    publishedRevisionId: c.published_id,
  };
}
function receipt(c: Awaited<ReturnType<ContentService["get"]>>) {
  return state(c, c.draft.slug);
}
function sliceRevision(r: Revision, offset = 0, length = 4000) {
  const characters = Array.from(r.markdown);
  const end = Math.min(characters.length, offset + length);
  return {
    revisionId: r.id,
    title: r.title,
    slug: r.slug,
    summary: r.summary,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    image: r.image,
    createdAt: r.created_at,
    markdown: characters.slice(offset, end).join(""),
    offset,
    totalLength: characters.length,
    nextOffset: end < characters.length ? end : null,
  };
}
type MediaMetadata = { id: string; mime: string; size: number; alt: string };
function mediaMetadata(m: MediaMetadata) {
  return { id: m.id, url: `/media/${m.id}`, mime: m.mime, size: m.size, alt: m.alt };
}

export function createBlogServer(env: Env) {
  const server = new McpServer({ name: "personal-blog", version: "2.0.0" });
  const contents = new ContentService(env.DB),
    media = new MediaService(env.DB);
  function tool<S extends Shape>(
    name: string,
    description: string,
    shape: S,
    action: (input: z.output<z.ZodObject<S>>) => Promise<unknown>,
    mode: Mode = "write",
    openWorld = false
  ) {
    const schema = z.object(shape).strict();
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: { readOnlyHint: mode === "read", destructiveHint: mode === "delete", idempotentHint: mode === "read", openWorldHint: openWorld },
      },
      async (input) => {
        try {
          const result = await action(schema.parse(input));
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
          const message =
            error instanceof AppError
              ? error.message
              : error instanceof z.ZodError
                ? error.issues
                    .slice(0, 3)
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join("; ")
                : "Operasi gagal. Baca ulang data sebelum mencoba lagi.";
          if (!(error instanceof AppError || error instanceof z.ZodError)) console.error(JSON.stringify({ event: "mcp_operation_failed", tool: name }));
          return {
            isError: true,
            content: [
              { type: "text" as const, text: JSON.stringify({ error: message, status: error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 500 }) },
            ],
          };
        }
      }
    );
  }
  function group(name: string, description: string, operations: Record<string, ReturnType<typeof operation>>, mode: Mode = "write") {
    // Advertise shared fields once; each action then enforces its own required/allowed fields.
    const shape: Shape = {};
    for (const op of Object.values(operations)) for (const [key, schema] of Object.entries(op.shape)) shape[key] = schema.optional();
    tool(name, description, { ...shape, action: z.enum(Object.keys(operations)) }, async ({ action, ...input }) => operations[action as string].run(input), mode);
  }

  group(
    "read_content",
    "list: filter query/kind/status. get: id, view=draft|published (default draft). revisions: id. revision: revisionId. Reads return 4000 Unicode characters; length=0 for metadata, max 12000. Continue via revision with revisionId/nextOffset. Lists default 10, max 50.",
    {
      list: operation({ ...pagination, query: z.string().max(200).optional(), kind: kind.optional(), status: status.optional() }, async (i) => {
        const rows = await contents.list({ ...i, limit: (i.limit ?? 10) + 1 });
        return page(
          rows.map((c) => ({
            id: c.id,
            title: c.title,
            kind: c.kind,
            status: c.trashed_at ? "trash" : c.published_id ? "published" : "draft",
            version: c.version,
            url: pathFor(String(c.kind), String(c.slug)),
          })),
          i.limit,
          i.offset
        );
      }),
      get: operation({ ...id, view: z.enum(["draft", "published"]).optional(), ...range }, async (i) => {
        const c = await contents.identity(i.id);
        const selected = i.view === "published" ? c.published_id : c.draft_id;
        if (!selected) throw new AppError("Belum ada versi terbit. Gunakan view=draft.", 404);
        const r = await contents.revision(selected);
        return { ...state(c, r.slug), kind: c.kind, ...sliceRevision(r, i.offset, i.length) };
      }),
      revisions: operation({ ...id, ...pagination }, async (i) => {
        const rows = await contents.history(i.id, (i.limit ?? 10) + 1, i.offset ?? 0);
        return page(
          rows.map((r) => ({ revisionId: r.id, title: r.title, slug: r.slug, createdAt: r.created_at })),
          i.limit,
          i.offset
        );
      }),
      revision: operation({ revisionId, ...range }, async (i) => {
        const r = await contents.revision(i.revisionId);
        return { id: r.content_id, ...sliceRevision(r, i.offset, i.length) };
      }),
    },
    "read"
  );
  group(
    "write_content",
    "create: kind, content(title/slug/markdown). update: id, expectedVersion, changed content fields and/or replacements[{oldText,newText}] (each matches once); markdown and replacements are exclusive. restore_revision: id, expectedVersion, revisionId. restore: id, expectedVersion. Read current version before editing. Never publishes.",
    {
      create: operation({ kind, content: contentPatch }, async (i) => receipt(await contents.create(i.kind, contentInput.parse(i.content)))),
      update: operation(
        {
          ...versioned,
          content: contentPatch.optional(),
          replacements: z
            .array(z.object({ oldText: z.string().min(1).max(200000), newText: z.string().max(200000) }).strict())
            .min(1)
            .max(100)
            .optional(),
        },
        async (i) => receipt(await contents.edit(i.id, i.expectedVersion, i.content, i.replacements))
      ),
      restore_revision: operation({ ...versioned, revisionId }, async (i) => receipt(await contents.restoreRevision(i.id, i.expectedVersion, i.revisionId))),
      restore: operation(versioned, async (i) => receipt(await contents.transition(i.id, i.expectedVersion, "restore"))),
    }
  );
  tool(
    "publication",
    "publish makes the current draft public immediately; unpublish withdraws it. Requires id and current expectedVersion.",
    { ...versioned, action: z.enum(["publish", "unpublish"]) },
    async (i) => receipt(await contents.transition(i.id, i.expectedVersion, i.action)),
    "delete"
  );
  tool(
    "trash_content",
    "Move content to trash and remove it from the public site. Requires current expectedVersion.",
    versioned,
    async (i) => receipt(await contents.transition(i.id, i.expectedVersion, "trash")),
    "delete"
  );
  tool(
    "permanent_delete_content",
    "Irreversibly delete trashed content and history. Only on explicit owner request; requires current expectedVersion.",
    versioned,
    (i) => contents.permanentDelete(i.id, i.expectedVersion),
    "delete"
  );
  tool("create_preview", "Create a private draft preview URL, valid for one hour.", id, async (i) => {
    const p = await contents.preview(i.id);
    return { id: p.id, url: new URL(p.path, env.SITE_URL).toString(), expiresAt: p.expiresAt };
  });
  tool("get_settings", "Read effective blog settings.", {}, () => contents.settings(), "read");
  group("write_settings", "update: settings patch. reset: keys to restore defaults. Returns only changed/reset fields.", {
    update: operation({ settings: settingsSchema.partial().strict() }, async (i) => {
      const settings = await contents.updateSettings(i.settings);
      return Object.fromEntries(Object.keys(i.settings).map((key) => [key, settings[key as keyof typeof settings]]));
    }),
    reset: operation({ keys: z.array(settingsSchema.keyof()).min(1) }, async (i) => {
      const settings = await contents.resetSettings(i.keys);
      return Object.fromEntries(i.keys.map((key) => [key, settings[key]]));
    }),
  });
  group(
    "read_media",
    "list: limit/offset (default 10, max 50). get: id. Returns image metadata without binary data.",
    {
      list: operation(pagination, async (i) => {
        const rows = await media.list((i.limit ?? 10) + 1, i.offset ?? 0);
        return page(
          rows.map((m) => mediaMetadata({ id: String(m.id), mime: String(m.mime), size: Number(m.size), alt: String(m.alt) })),
          i.limit,
          i.offset
        );
      }),
      get: operation(id, async (i) => mediaMetadata(await media.get(i.id))),
    },
    "read"
  );
  tool(
    "import_media",
    "Download a public HTTPS image (JPEG/PNG/GIF/WebP, max 1500000 bytes). Use returned url in Markdown.",
    { url: z.url().max(2000), alt: z.string().max(1000) },
    async (i) => mediaMetadata(await media.import(i.url, i.alt)),
    "write",
    true
  );
  tool("update_media", "Update image alt metadata; existing Markdown alt text must be edited separately.", { ...id, alt: z.string().max(1000) }, async (i) =>
    mediaMetadata(await media.update(i.id, i.alt))
  );
  tool("delete_media", "Permanently delete an image only if unused by all content revisions.", id, (i) => media.delete(i.id), "delete");
  return server;
}
export const mcpHandler = (env: Env) => createMcpHandler(() => createBlogServer(env), { route: "/mcp" });
