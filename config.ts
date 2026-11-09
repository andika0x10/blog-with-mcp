/** Public defaults only. Credentials belong in Worker secrets / .dev.vars. */
export const siteConfig = {
  name: "Andika Dinata's Blog",
  description: "I love sarcasm.",
  author: "Nama penulis",
  language: "id",
  timezone: "Asia/Jakarta",
  navbar: [
    { label: "Arsip", href: "/archive" },
    { label: "Cari", href: "/search" },
  ],
  footer: "Only stupid people read this fucking blog.",
  defaultTheme: "system" as "system" | "light" | "dark",
  pageSize: 10,
};
