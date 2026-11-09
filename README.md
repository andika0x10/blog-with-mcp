# Blog with MCP

Blog personal berbasis vinext, React, TypeScript, Tailwind CSS, dan Cloudflare Workers. Konten dikelola lewat remote MCP dari Claude.ai, tanpa dashboard admin.

`SITE_URL` menentukan URL publik pada tautan konten. Endpoint OAuth dan metadata MCP mengikuti origin URL request yang dilayani Worker, sehingga domain kustom, `workers.dev`, dan port localhost dapat digunakan tanpa error perbedaan `SITE_URL`. Setiap token tetap terikat pada resource origin tempat koneksi dibuat; POST login tetap memerlukan Origin yang sama, sesi, dan token CSRF yang valid.

## Isu deploy Cloudflare

`cf@1.0.0-beta.28` mengaktifkan strict mode secara internal. Deploy otomatis bisa gagal jika konfigurasi Worker yang dibuat lewat dashboard berbeda dari konfigurasi proyek. Pesan untuk menghapus `--strict` menyesatkan karena flag tersebut tidak diekspos. Lihat [Cloudflare #69](https://github.com/cloudflare/cf/issues/69).

Solusi: isi `D1_DATABASE_ID`, `OAUTH_KV_ID`, dan `SITE_URL` produksi, lalu build dan deploy sekali dari terminal interaktif:

```sh
npm run build
npx cf deploy --prebuilt
```

Pilih **Yes** saat diminta menimpa konfigurasi. Setelah berhasil, gunakan deploy command `npx cf deploy --prebuilt` untuk build otomatis. Pastikan ketiga environment variable tadi juga diisi di pengaturan build Cloudflare.
