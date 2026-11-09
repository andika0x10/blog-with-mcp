/** Public defaults only. Credentials belong in Worker secrets / .dev.vars. */
export const siteConfig = {
  name: "Nama blog",
  description: "Esai, catatan, dan hal-hal yang ingin diingat.",
  author: "Nama penulis",
  language: "id",
  timezone: "Asia/Jakarta",
  navbar: [
    { label: "Arsip", href: "/archive" },
    { label: "Cari", href: "/search" },
  ],
  footer: "Sebuah ruang untuk menulis dan membaca.",
  defaultTheme: "system" as "system" | "light" | "dark",
  pageSize: 10,
};
