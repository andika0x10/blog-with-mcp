import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const site = new URL(process.env.LOCAL_SITE_URL ?? "http://127.0.0.1:5173");
if (site.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(site.hostname)) throw new Error("Local database scripts require a loopback HTTP server.");
const base = `${site.origin}/cdn-cgi/local/explorer/api`;
const json = async (path, body) => {
  const r = await fetch(base + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const result = await r.json();
  if (!r.ok || !result.success) throw new Error(JSON.stringify(result.errors ?? result));
  return result.result;
};
const databases = await json("/d1/database");
const db = databases.find((d) => d.name === "DB");
if (!db) throw new Error(`Start the local server on ${site.origin} first.`);
const query = (sql, params = []) => json(`/d1/database/${encodeURIComponent(db.uuid)}/raw`, { sql, params });
await query("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
const applied = (await query("SELECT name FROM d1_migrations"))[0].results.rows.map((row) => row[0]);
for (const file of (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.includes(file)) continue;
  const sql = await readFile(`migrations/${file}`, "utf8");
  // Existing local databases created before this helper can be explicitly reset by the developer.
  await query(sql);
  await query("INSERT INTO d1_migrations(name) VALUES(?)", [file]);
  console.log(`Applied locally: ${file}`);
}
if (process.argv.includes("--seed")) {
  const { samples } = await import("../tests/fixtures.mjs");
  for (const [index, sample] of samples.entries()) {
    if ((await query("SELECT id FROM contents WHERE id=?", [sample.id]))[0].results.rows.length) continue;
    const rev = randomUUID(),
      date = new Date(Date.UTC(2026, 10, 9 - index * 4)).toISOString();
    await json(`/d1/database/${encodeURIComponent(db.uuid)}/raw`, {
      batch: [
        {
          sql: "INSERT INTO contents(id,kind,version,draft_id,published_id,published_at,updated_at,mutation) VALUES(?,'post',1,?,?,?,?,?)",
          params: [sample.id, rev, rev, date, date, randomUUID()],
        },
        { sql: "INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?,?,?)", params: [rev, sample.id, sample.title, sample.slug, sample.summary, sample.markdown, "", "", "", date] },
        { sql: "INSERT INTO routes VALUES(?,?,1)", params: [`/posts/${sample.slug}`, sample.id] },
        { sql: "INSERT INTO search_index VALUES(?,?,?,?)", params: [sample.id, sample.title, sample.summary, sample.markdown] },
      ],
    });
  }
  console.log("Local-only reading fixtures are ready.");
}
console.log("Local database is ready. No remote resource was changed.");
