import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { ContentService } from "../lib/content";
import { MediaService } from "../lib/media";
import { AppError, contentInput, settingsSchema } from "../lib/validation";

export function createBlogServer(env: Env) {
  const server = new McpServer({ name: "personal-blog", version: "1.0.0" });
  const contents = new ContentService(env.DB),
    media = new MediaService(env.DB);
  function tool<S extends Record<string, z.ZodType>>(
    name: string,
    description: string,
    shape: S,
    action: (input: z.output<z.ZodObject<S>>) => Promise<unknown>,
    mode: "read" | "write" | "delete" = "write",
    openWorld = false
  ) {
    const schema: z.ZodObject<Record<string, z.ZodType>> = z.object(shape);
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: { readOnlyHint: mode === "read", destructiveHint: mode === "delete", idempotentHint: mode === "read", openWorldHint: openWorld },
      },
      async (input) => {
        try {
          const result = await action(z.object(shape).parse(input));
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
          const message =
            error instanceof AppError
              ? error.message
              : error instanceof z.ZodError
                ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
                : "Operasi gagal. Periksa input dan baca ulang data sebelum mencoba lagi.";
          if (!(error instanceof AppError || error instanceof z.ZodError)) console.error(JSON.stringify({ event: "mcp_operation_failed", tool: name }));
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: message, status: error instanceof AppError ? error.status : 400 }) }] };
        }
      }
    );
  }
  const id = { id: z.string().uuid() },
    versioned = { ...id, expectedVersion: z.number().int().positive() },
    pagination = { limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0) };
  tool(
    "list_content",
    "List or search posts/pages, including drafts. Pagination uses limit/offset. Read a content item before editing.",
    { ...pagination, query: z.string().max(200).optional(), kind: z.enum(["post", "page"]).optional(), status: z.enum(["draft", "published", "trash"]).optional() },
    (i) => contents.list(i),
    "read"
  );
  tool("get_content", "Read draft, published revision, status, and version of a post/page.", id, (i) => contents.get(i.id), "read");
  tool("create_content", "Create a Markdown draft. Does not publish. kind is post or page.", { kind: z.enum(["post", "page"]), content: contentInput }, (i) =>
    contents.create(i.kind, i.content)
  );
  tool(
    "update_draft",
    "Save a complete new draft revision. Read get_content first and pass its version. Published content stays unchanged.",
    { ...versioned, content: contentInput },
    (i) => contents.update(i.id, i.expectedVersion, i.content)
  );
  for (const action of ["publish", "unpublish", "trash", "restore"] as const) {
    const descriptions = {
      publish: "Publish the current draft, or publish a revision of an existing post/page. This makes it public immediately.",
      unpublish: "Withdraw the published version, keeping the draft and history.",
      trash: "Move content into trash and remove it from the public website.",
      restore: "Restore trashed content as an unpublished draft.",
    };
    tool(
      `${action}_content`,
      descriptions[action],
      versioned,
      (i) => contents.transition(i.id, i.expectedVersion, action),
      action === "publish" || action === "unpublish" || action === "trash" ? "delete" : "write"
    );
  }
  tool("list_revisions", "List immutable revision IDs for a content item.", { ...id, ...pagination }, (i) => contents.history(i.id, i.limit, i.offset), "read");
  tool("get_revision", "Read the Markdown and metadata of an immutable revision.", { revisionId: z.string().uuid() }, (i) => contents.revision(i.revisionId), "read");
  tool("restore_revision", "Copy a historical revision into a new draft revision. Does not publish.", { ...versioned, revisionId: z.string().uuid() }, (i) =>
    contents.restoreRevision(i.id, i.expectedVersion, i.revisionId)
  );
  tool(
    "permanent_delete_content",
    "Irreversibly delete trashed content, revisions, previews, and reserved URLs. Use only when the owner explicitly requests permanent deletion.",
    versioned,
    (i) => contents.permanentDelete(i.id, i.expectedVersion),
    "delete"
  );
  tool("create_preview", "Create a private preview link for the current draft revision. The link expires after one hour.", id, async (i) => {
    const p = await contents.preview(i.id);
    return { ...p, url: new URL(p.path, env.SITE_URL).toString() };
  });
  tool("get_settings", "Read effective settings (config.ts defaults plus D1 overrides).", {}, () => contents.settings(), "read");
  tool(
    "update_settings",
    "Update blog identity, navigation order, footer, language, timezone or default theme. Secrets and arbitrary CSS cannot be changed.",
    { settings: settingsSchema.partial().strict() },
    (i) => contents.updateSettings(i.settings)
  );
  tool("reset_settings", "Remove selected overrides and return to the defaults in config.ts.", { keys: z.array(settingsSchema.keyof()).min(1) }, (i) =>
    contents.resetSettings(i.keys)
  );
  tool(
    "import_media",
    "Download an image from a public HTTPS URL, save it in D1, and return its blog URL. JPEG, PNG, GIF, WebP; maximum 1,500,000 bytes. Put the returned URL in Markdown.",
    { url: z.url().max(2000), alt: z.string().max(1000) },
    async (i) => {
      const m = await media.import(i.url, i.alt);
      return { ...m, absoluteUrl: new URL(m.url, env.SITE_URL).toString() };
    },
    "write",
    true
  );
  tool("list_media", "List media metadata without binary data.", pagination, (i) => media.list(i.limit, i.offset), "read");
  tool("get_media", "Read media URL, alt text, size, and format.", id, (i) => media.get(i.id), "read");
  tool("update_media", "Update alt text metadata. Existing Markdown alt text is edited separately.", { ...id, alt: z.string().max(1000) }, (i) => media.update(i.id, i.alt));
  tool("delete_media", "Permanently delete a media item only if it is not referenced in any content revision.", id, (i) => media.delete(i.id), "delete");
  return server;
}
export const mcpHandler = (env: Env) => createMcpHandler(() => createBlogServer(env), { route: "/mcp" });
