# Blog dengan MCP

Blog personal berbasis vinext, React, TypeScript, Tailwind CSS, dan Cloudflare Workers. Pengelolaan dilakukan lewat Claude.ai melalui remote MCP; tidak ada dashboard admin.

## Menjalankan lokal

Gunakan Node.js 22.18+ dan npm.

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
```

Isi `ADMIN_USERNAME` dan `ADMIN_PASSWORD` di `.dev.vars`. File itu tidak masuk Git. Sesuaikan `SITE_URL` dengan origin browser, termasuk port. Untuk autentikasi lokal gunakan `http://localhost:5173`; Claude.ai tetap memerlukan deployment HTTPS yang dapat dijangkau publik.

```powershell
npm run dev -- --host 127.0.0.1
```

Di terminal kedua:

```powershell
npm run db:migrate:local
```

Buka http://localhost:5173. Database baru menampilkan keadaan kosong. Opsional, `npm run db:seed:local` menambahkan empat tulisan contoh **hanya** melalui Local Explorer di loopback. Tidak ada seeding produksi atau fallback data palsu di aplikasi.

Script lokal mengasumsikan port 5173 dan binding D1 bernama `DB`. Ia menggunakan database simulasi yang benar-benar dipakai Vite, bukan lokasi persistence CLI yang berbeda.

## Konfigurasi

`config.ts` memuat identitas, penulis, deskripsi, bahasa, zona waktu, navbar, footer, pilihan tema awal, dan pagination. Nilai yang diubah melalui MCP disimpan di D1 dan menimpa default per pengaturan. `reset_settings` menghapus override. Navbar adalah array berurutan, mendukung path internal atau HTTPS eksternal.

Environment:

| Variabel | Penggunaan |
| --- | --- |
| `ADMIN_USERNAME` | Username pemilik, diset sebagai Worker secret |
| `ADMIN_PASSWORD` | Password pemilik, diset sebagai Worker secret |
| `SITE_URL` | Origin publik kanonis, tanpa path; jangan gunakan localhost di produksi |
| `D1_DATABASE_ID` | ID database produksi saat evaluasi konfigurasi/build |
| `OAUTH_KV_ID` | ID namespace KV produksi saat evaluasi konfigurasi/build |

Dua ID dan `SITE_URL` dibaca oleh `cloudflare.config.ts` dari environment proses. `SITE_URL` menjadi binding publik pada hasil build. Kredensial hanya dibaca di server. Jangan menaruh secret di `config.ts`, source, atau file yang dilacak Git.

## Arsitektur dan konten

- `worker/index.ts` menyambungkan gateway MCP/OAuth/media ke renderer vinext. Tidak ada `McpAgent`; setiap request MCP memakai factory server stateless dari Agents SDK dan SDK MCP TypeScript v2.
- D1 memuat identitas konten, revisi immutable, pointer draft/publik, reservasi URL/redirect, override pengaturan, token preview yang di-hash, dan gambar BLOB. Drizzle mendefinisikan schema dan menangani pengaturan; batch SQL D1 menangani perubahan editorial atomik.
- Pembaruan memerlukan `expectedVersion`. Batch menggunakan compare-and-swap dan penanda mutasi unik agar konflik tidak menghasilkan revisi parsial. Publikasi memperbarui indeks FTS5 dalam batch yang sama.
- Routes dicadangkan untuk konten sampai penghapusan permanen. Slug publik lama redirect 308 setelah publikasi slug baru; slug draft baru tidak langsung aktif.
- Revisi tulisan terbit disimpan sebagai draft sampai `publish_content`. `restore_revision` juga menghasilkan draft baru. Restore dari trash tidak otomatis menerbitkan.
- Preview mengarah ke revisi tertentu dan berlaku satu jam. Respons memakai `no-store`, `noindex`, dan `no-referrer`. Siapa pun yang memiliki tautan dapat membacanya sampai kedaluwarsa.
- Gambar diimpor dari URL HTTPS publik. Format JPEG/PNG/WebP/GIF, maksimal 1.500.000 byte. Tidak ada konversi atau kompresi otomatis; optimalkan gambar sebelum impor. Redirect, batas unduh, MIME, signature file, dan alamat internal diperiksa. Flag `global_fetch_strictly_public` memblokir resolusi DNS menuju jaringan privat.
- Gambar yang direferensikan oleh revisi mana pun tidak dapat dihapus. Mengubah metadata alt media tidak mengganti alt text yang sudah tertulis di Markdown.
- Markdown dirender di server dengan GFM, KaTeX, dan highlight.js melalui rehype-highlight. HTML mentah dan JSX tidak dieksekusi. LaTeX berarti rumus matematika KaTeX, bukan kompilasi dokumen TeX.
- Home berisi 10 posts per halaman, arsip dikelompokkan menurut tahun, pencarian mencakup posts dan pages publik, dan RSS berisi 50 posts terbaru. Semua mengecualikan draft dan trash.
- Pilihan tema pengunjung disimpan lokal; default global dapat diubah lewat MCP. Animasi GSAP menghormati reduced motion.

## Deployment Cloudflare

Konfigurasi menggunakan **cf**, bukan konfigurasi Wrangler terpisah. Tentukan domain HTTPS sebelum build. Gunakan akun Cloudflare yang sesuai dan autentikasi CLI terlebih dahulu.

Buat D1 dan KV melalui dashboard Cloudflare, atau tinjau command CLI sebelum menjalankannya:

```powershell
npx cf d1 create --name blog-with-mcp --dry-run
npx cf kv namespaces create --title blog-oauth --dry-run
```

Setelah siap, jalankan command yang sama tanpa `--dry-run`, kemudian simpan ID hasilnya ke environment. Pembuatan resource tersebut belum dilakukan otomatis oleh implementasi ini.

```powershell
$env:D1_DATABASE_ID = "<database-id>"
$env:OAUTH_KV_ID = "<namespace-id>"
$env:SITE_URL = "https://blog.example.com"

npx cf d1 migrations apply $env:D1_DATABASE_ID --dir migrations --dry-run
# Tinjau dahulu, kemudian:
npx cf d1 migrations apply $env:D1_DATABASE_ID --dir migrations
npm run build
```

Gunakan environment yang sama untuk deployment. Jika memakai domain sendiri, siapkan custom domain/routing untuk Worker `blog-with-mcp` di Cloudflare. Binding `LOGIN_LIMITER` dan export SQLite Durable Object dideklarasikan di konfigurasi; cf menerapkan lifecycle namespace ketika deploy.

Untuk deployment pertama, siapkan file JSON secret lokal yang tidak masuk Git, misalnya `.env.secrets.json`:

```json
{
  "ADMIN_USERNAME": "<username-pemilik>",
  "ADMIN_PASSWORD": "<password-panjang-unik>"
}
```

Setelah build dengan environment produksi yang benar, deploy hasil build beserta secret secara bersamaan:

```powershell
npx cf deploy --prebuilt --secrets-file .env.secrets.json
```

Untuk deployment ulang setelah secret tersedia, `npm run deploy` juga dapat membangun dan menerbitkan melalui deployer vinext. Alternatifnya atur kedua secret melalui dashboard Worker. Tanpa secret, halaman login menolak akses dengan status 503.

Jangan deploy dengan `SITE_URL` lokal atau menjalankan script seed terhadap produksi. Implementasi ini belum dipublikasikan. Uji dari Claude.ai hanya dapat dilakukan setelah domain, binding, migrasi, dan secret produksi tersedia.

## Menghubungkan Claude.ai

1. Di pengaturan Claude, buka **Connectors**, lalu tambahkan custom connector.
2. Gunakan URL `https://domain-blog/mcp`.
3. Pilih autentikasi login. Server mendukung identitas client melalui metadata document dan dynamic client registration.
4. Masuk menggunakan username/password pemilik, lalu periksa nama client, tujuan redirect, dan izin pada halaman persetujuan.
5. Izinkan akses. Claude memperoleh token OAuth dan dapat memanggil tool. Password tidak dimasukkan ke percakapan.

Contoh permintaan:

> Buat draft esai berjudul “Mencatat perjalanan”. Setelah selesai, berikan tautan preview; jangan publish dulu.

> Ambil gambar dari URL HTTPS ini, simpan ke blog, lalu masukkan URL hasilnya ke draft.

> Baca versi terbaru tulisan tersebut, perbaiki paragraf terakhir, lalu publish revisinya.

Tool yang tersedia:

| Kelompok | Tools |
| --- | --- |
| Konten | `list_content`, `get_content`, `create_content`, `update_draft` |
| Publikasi | `publish_content`, `unpublish_content` |
| Revisi | `list_revisions`, `get_revision`, `restore_revision` |
| Trash | `trash_content`, `restore_content`, `permanent_delete_content` |
| Preview | `create_preview` |
| Pengaturan | `get_settings`, `update_settings`, `reset_settings` |
| Media | `import_media`, `list_media`, `get_media`, `update_media`, `delete_media` |

`update_draft` menerima seluruh isi revisi, bukan patch paragraf. Claude harus membaca konten lebih dulu dan memakai versi terbaru. Tool yang melakukan perubahan status juga memerlukan `expectedVersion`. Penghapusan permanen hanya berlaku untuk trash.

Autentikasi menggunakan OAuth dengan PKCE S256. Login dibatasi lima percobaan per IP setiap 15 menit melalui Durable Objects; browser session/CSRF berumur 10 menit; access token satu jam dan refresh token 30 hari. Putuskan connector dan cabut grant OAuth ketika tidak diperlukan. Mengganti password tidak otomatis mencabut token yang telah diterbitkan.

## Pengujian

```powershell
npm run typecheck
npm test
npm run build
npm run test:browser
npm audit --omit=dev
```

Uji browser yang sama terhadap **bundle produksi** dengan preview Workers lokal:

```powershell
$env:PLAYWRIGHT_PRODUCTION = "1"
npm run test:browser
Remove-Item Env:PLAYWRIGHT_PRODUCTION
```

Pengujian ini membangun ulang, menjalankan preview di port 4173, dan memeriksa rendering SSR serta interaksi browser. Script seed tetap hanya menerima origin HTTP loopback.

Vitest berjalan dalam runtime Workers lokal dengan D1, KV, dan Durable Objects simulasi yang terpisah dari database development. Playwright menjalankan server development bila belum aktif, menerapkan migrasi dan fixture lokal, memeriksa desktop/mobile light/dark, Markdown/rumus/highlight, keyboard, tema, pencarian, feed, dan endpoint MCP tanpa token. Screenshot tersimpan di `test-results/` dan diabaikan Git.

Schema aplikasi berada di `lib/db/schema.ts`; migrasi deploy yang ditinjau berada di `migrations/`. Jangan mengubah migrasi yang sudah diterapkan. Drizzle Kit dapat menghasilkan rancangan schema ke `drizzle/`, tetapi hasilnya perlu direkonsiliasi dengan migrasi yang sudah ada dan indeks virtual FTS5 sebelum dijadikan migrasi deploy.

## Ekspor dan pemulihan manual

Gunakan D1 Time Travel untuk pemulihan database lengkap, termasuk BLOB gambar. Simpan bookmark sebelum perubahan besar dan gunakan fasilitas restore Cloudflare bila diperlukan.

Untuk salinan portabel, ekspor tabel D1 dengan query read-only melalui `cf d1 raw` ke JSON: `contents`, `revisions`, `routes`, `settings`, dan `media`. Ambil tabel besar per halaman `LIMIT/OFFSET`; untuk media ambil satu baris per query agar ukuran respons terjaga. Simpan file migrasi bersama hasilnya. Lakukan saat tidak ada penyuntingan untuk menjaga konsistensi antar-tabel. Contoh:

```powershell
npx cf d1 raw $env:D1_DATABASE_ID --sql "SELECT * FROM revisions ORDER BY id LIMIT 100 OFFSET 0" > revisions-000.json
npx cf d1 raw $env:D1_DATABASE_ID --sql "SELECT * FROM media ORDER BY id LIMIT 1 OFFSET 0" > media-000.json
```

BLOB dalam hasil API perlu dipertahankan sebagai byte saat diimpor kembali. Jangan mengandalkan ekspor SQL generik untuk virtual table FTS5; indeks pencarian dapat dibangun ulang dari revisi publik. Token OAuth berada di KV dan tidak termasuk ekspor konten. Tidak ada backup terjadwal atau tool restore database yang diekspos ke Claude.

