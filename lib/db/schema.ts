import { sqliteTable, text, integer, blob, index } from "drizzle-orm/sqlite-core";
export const contents = sqliteTable("contents", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["post", "page"] }).notNull(),
  version: integer("version").notNull().default(1),
  draftId: text("draft_id").notNull(),
  publishedId: text("published_id"),
  publishedAt: text("published_at"),
  trashedAt: text("trashed_at"),
  updatedAt: text("updated_at").notNull(),
  mutation: text("mutation").notNull(),
});
export const revisions = sqliteTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    contentId: text("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary").notNull(),
    markdown: text("markdown").notNull(),
    seoTitle: text("seo_title").notNull(),
    seoDescription: text("seo_description").notNull(),
    image: text("image").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("revisions_content").on(t.contentId)]
);
export const routes = sqliteTable("routes", {
  path: text("path").primaryKey(),
  contentId: text("content_id")
    .notNull()
    .references(() => contents.id, { onDelete: "cascade" }),
  live: integer("live").notNull().default(0),
});
export const settings = sqliteTable("settings", { key: text("key").primaryKey(), value: text("value").notNull() });
export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  mime: text("mime").notNull(),
  bytes: blob("bytes", { mode: "buffer" }).notNull(),
  size: integer("size").notNull(),
  alt: text("alt").notNull(),
  etag: text("etag").notNull(),
  createdAt: text("created_at").notNull(),
});
export const previews = sqliteTable("previews", {
  tokenHash: text("token_hash").primaryKey(),
  revisionId: text("revision_id")
    .notNull()
    .references(() => revisions.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
});
