# Blog with MCP

Blog personal berbasis vinext, React, TypeScript, Tailwind CSS, dan Cloudflare Workers. Konten dikelola lewat remote MCP dari Claude.ai, tanpa dashboard admin.

`SITE_URL` menentukan URL publik pada tautan konten. Endpoint OAuth dan metadata MCP mengikuti origin URL request yang dilayani Worker, sehingga domain kustom, `workers.dev`, dan port localhost dapat digunakan tanpa error perbedaan `SITE_URL`. Setiap token tetap terikat pada resource origin tempat koneksi dibuat; POST login tetap memerlukan Origin yang sama, sesi, dan token CSRF yang valid.

## MCP v2: kontrak hemat token

Endpoint tetap `/mcp`, dengan autentikasi dan database yang sama. Kontrak input/output berubah dan nama tool lama tidak diberi alias. Setelah versi ini diterapkan, segarkan daftar tool atau hubungkan ulang connector MCP agar client mengambil schema baru.

| Tool                       | `action` dan input                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_content`             | `list`: query/kind/status/limit/offset opsional; `get`: id, view/offset/length opsional; `revisions`: id, limit/offset opsional; `revision`: revisionId, offset/length opsional |
| `write_content`            | `create`: kind dan content; `update`: id, expectedVersion, content dan/atau replacements; `restore_revision`: id, expectedVersion, revisionId; `restore`: id, expectedVersion   |
| `publication`              | `publish` atau `unpublish`: id dan expectedVersion                                                                                                                              |
| `trash_content`            | id dan expectedVersion                                                                                                                                                          |
| `permanent_delete_content` | id dan expectedVersion; konten harus berada di trash                                                                                                                            |
| `create_preview`           | id; menghasilkan URL privat yang berlaku satu jam                                                                                                                               |
| `get_settings`             | Tanpa argumen                                                                                                                                                                   |
| `write_settings`           | `update`: settings; `reset`: keys                                                                                                                                               |
| `read_media`               | `list`: limit/offset opsional; `get`: id                                                                                                                                        |
| `import_media`             | url HTTPS publik dan alt; JPEG/PNG/GIF/WebP, maksimal 1.500.000 byte                                                                                                            |
| `update_media`             | id dan alt                                                                                                                                                                      |
| `delete_media`             | id; gambar tidak boleh dirujuk revisi mana pun                                                                                                                                  |

Field yang bukan milik operasi dipilih akan ditolak. Operasi perubahan konten memerlukan versi terkini dari pembacaan sebelumnya atau respons perubahan terakhir. Konflik versi menghasilkan error 409: baca ulang sebelum mengedit, jangan mencoba kembali dengan data lama. Membuat, mengedit, dan memulihkan revisi tidak menerbitkan draft; `publication` dengan `action: "publish"` langsung membuat draft tersedia untuk publik.

Respons perubahan konten hanya memuat `id`, `version`, `status`, `url`, `draftRevisionId`, dan `publishedRevisionId`. Penghapusan permanen mengembalikan `{id, deleted:true}`. Respons preview memuat `id`, `url`, dan `expiresAt`.

Daftar mengembalikan `{items, nextOffset}`; `nextOffset: null` menandakan selesai. Default 10 item, maksimal 50. Item konten hanya memuat ID, judul, jenis, status, versi, dan URL. Item revisi memuat `revisionId`, judul, slug, dan `createdAt`. Item media memuat `id`, `url`, `mime`, `size`, dan `alt`, tanpa data biner atau metadata internal. URL media memakai path `/media/id` yang dapat langsung dipasang dalam Markdown.

### Membaca dan melanjutkan artikel

`read_content` dengan `action: "get"` membaca satu versi: `view: "draft"` secara default, atau `view: "published"`. Versi terbit yang belum tersedia menghasilkan error 404. Respons berisi metadata, `revisionId`, `markdown`, `offset`, `totalLength`, dan `nextOffset`. Panjang default 4.000 karakter Unicode (code point), maksimal 12.000 per panggilan. `length: 0` hanya mengambil metadata. Offset di luar akhir artikel menghasilkan teks kosong dan `nextOffset: null`.

```json
{ "action": "get", "id": "CONTENT_UUID" }
```

Jika masih ada teks, gunakan operasi `revision` dengan `revisionId` dari respons pertama. Revisi bersifat tetap, sehingga lanjutan tetap konsisten meskipun draft berubah. Untuk membaca penuh, ulangi sampai `nextOffset: null`; gunakan `length: 50000` untuk mengurangi jumlah panggilan. Jangan memakai `length: 0` saat melanjutkan teks karena offset tidak maju.

```json
{ "action": "revision", "revisionId": "REVISION_UUID", "offset": 4000, "length": 50000 }
```

### Membuat dan mengedit draft

`write_content` dengan `action: "create"` memerlukan `kind` (`post` atau `page`) dan `content` yang berisi `title`, `slug`, serta `markdown`. Field metadata opsional: `summary`, `seoTitle`, `seoDescription`, `image`.

```json
{ "action": "create", "kind": "post", "content": { "title": "Catatan baru", "slug": "catatan-baru", "markdown": "Paragraf pertama." } }
```

Untuk edit, kirim field yang berubah saja. Field yang tidak dikirim dipertahankan; string kosong dapat dipakai untuk mengosongkan metadata opsional. Respons ringkas tidak mengulang isi artikel.

```json
{ "action": "update", "id": "CONTENT_UUID", "expectedVersion": 1, "content": { "title": "Judul baru" } }
```

Untuk koreksi teks, kirim `replacements`. Setiap `oldText` harus tidak kosong dan muncul tepat sekali pada teks hasil langkah sebelumnya, termasuk ketika kecocokannya bertumpang tindih. Seluruh penggantian disimpan sebagai satu revisi; jika ada sasaran tidak cocok/ambigu, tidak ada perubahan yang disimpan. Pilih `content.markdown` untuk mengganti seluruh teks atau `replacements` untuk edit potongan, jangan keduanya. Metadata boleh diubah bersamaan dengan `replacements`.

```json
{ "action": "update", "id": "CONTENT_UUID", "expectedVersion": 2, "replacements": [{ "oldText": "Paragraf pertama.", "newText": "Paragraf yang diperbaiki." }] }
```

`write_settings` mengembalikan hanya field yang diubah atau direset; gunakan `get_settings` jika memerlukan seluruh pengaturan efektif. `update_media` mengubah metadata alt; alt yang sudah tertulis dalam Markdown diedit melalui `write_content`.

### Hasil pengukuran

Fixture artikel ASCII sepanjang 22.216 karakter dipakai pada kedua kontrak. Baseline v1 diambil dari commit `46dbd2297f5037eacc30abc6712a58b7b8084272`. Angka berikut adalah byte UTF-8 JSON, bukan jumlah token model. Pengukuran alur menghitung envelope request/response JSON-RPC seluruh panggilan, tanpa framing HTTP/SSE dan schema discovery; ukuran schema dihitung terpisah dari hasil `tools/list`.

| Pengukuran                                    |                    v1 |                   v2 |
| --------------------------------------------- | --------------------: | -------------------: |
| Jumlah tool                                   |                    21 |                   12 |
| Schema `tools/list`                           |                14.059 |               10.431 |
| Buat–publish: respons saja, 2 panggilan       |                68.672 |                  592 |
| Buat–publish: total input/output              |                91.224 |               23.176 |
| Cari–baca penuh: total input/output           |  46.415 (2 panggilan) | 26.390 (7 panggilan) |
| Cari–baca halaman pertama: total input/output |                     — |  5.178 (2 panggilan) |
| Baca–edit satu paragraf: total input/output   | 113.918 (2 panggilan) |  5.352 (2 panggilan) |

Pembacaan penuh v2 diukur memakai panjang default 4.000, termasuk semua lanjutan sampai selesai. Penghematan aktual bergantung pada panjang artikel dan pola pemakaian. Fixture dan batas regresi dapat diperiksa dengan `npx vitest run tests/mcp-budget.test.ts`; pengujian kontrak ada di `tests/mcp.test.ts`.

## Isu deploy Cloudflare

`cf@1.0.0-beta.28` mengaktifkan strict mode secara internal. Deploy otomatis bisa gagal jika konfigurasi Worker yang dibuat lewat dashboard berbeda dari konfigurasi proyek. Pesan untuk menghapus `--strict` menyesatkan karena flag tersebut tidak diekspos. Lihat [Cloudflare #69](https://github.com/cloudflare/cf/issues/69).

Solusi: isi `D1_DATABASE_ID`, `OAUTH_KV_ID`, dan `SITE_URL` produksi, lalu build dan deploy sekali dari terminal interaktif:

```sh
npm run build
npx cf deploy --prebuilt
```

Pilih **Yes** saat diminta menimpa konfigurasi. Setelah berhasil, gunakan deploy command `npx cf deploy --prebuilt` untuk build otomatis. Pastikan ketiga environment variable tadi juga diisi di pengaturan build Cloudflare.
