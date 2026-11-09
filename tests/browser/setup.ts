import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
export default async function setup() {
  await promisify(execFile)(process.execPath, ["scripts/local-db.mjs", "--seed"]);
  // These fixtures only touch the loopback database used by browser tests.
  const origin = process.env.LOCAL_SITE_URL!;
  const base = `${origin}/cdn-cgi/local/explorer/api`;
  const json = async <T = unknown>(path: string, body?: unknown) => {
    const response = await fetch(base + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const result = (await response.json()) as { success: boolean; result: T; errors?: unknown };
    if (!response.ok || !result.success) throw new Error(`Local responsive fixture setup failed: ${JSON.stringify(result.errors)}`);
    return result.result;
  };
  const db = (await json<{ name: string; uuid: string }[]>("/d1/database")).find((entry) => entry.name === "DB");
  if (!db) throw new Error("Local browser test database is unavailable");
  const id = "browser-responsive-page",
    revision = "browser-responsive-revision",
    token = "a".repeat(64);
  const markdown = `Paragraf dengan tautan panjang: https://example.com/${"panjang".repeat(30)}

> Catatan panjang untuk menguji pembungkusan pada layar kecil.

## Tabel dan kode

- [ ] Catatan untuk tulisan berikutnya.
- [x] Catatan yang sudah ditulis.
  - [ ] Detail tambahan.

| ${Array.from({ length: 8 }, (_, i) => "Kolom " + i).join(" | ")} |
| ${Array(8).fill("---").join(" | ")} |
| ${Array(8).fill("Data yang perlu tetap terbaca").join(" | ")} |

\`\`\`typescript
const panjang = "${"x".repeat(180)}";
\`\`\`

\`\`\`javascript
// Contoh sintaks berwarna
function sapa(nama) { return "Halo " + nama + 42; }
\`\`\`

\`\`\`html
<a href="/arsip">Arsip</a>
\`\`\`

\`\`\`css
.catatan { color: red; margin: 12px; }
\`\`\`

$$
${Array(35).fill("x^2").join(" + ")} = y
$$`;
  const date = new Date().toISOString();
  await json(`/d1/database/${encodeURIComponent(db.uuid)}/raw`, {
    batch: [
      {
        sql: "INSERT OR IGNORE INTO contents(id,kind,draft_id,published_id,published_at,updated_at,mutation) VALUES(?,'page',?,?,?,?,?)",
        params: [id, revision, revision, date, date, id],
      },
      {
        sql: "INSERT OR REPLACE INTO revisions VALUES(?,?,?,?,?,?,?,?,?,?)",
        params: [
          revision,
          id,
          "Halaman dengan judul panjang untuk memastikan kenyamanan membaca di berbagai ukuran layar",
          "uji-responsif",
          "Ringkasan halaman untuk pengujian tampilan responsif.",
          markdown,
          "",
          "",
          "",
          date,
        ],
      },
      { sql: "INSERT OR REPLACE INTO routes VALUES(?,?,1)", params: ["/uji-responsif", id] },
      { sql: "INSERT OR REPLACE INTO previews VALUES(?,?,?)", params: [createHash("sha256").update(token).digest("hex"), revision, String(Date.now() + 3600000)] },
    ],
  });
}
