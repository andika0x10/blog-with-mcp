import type { Metadata } from "next";
import { contentService, origin } from "../lib/runtime";
import { Entrance, MobileMenu, ThemeControl } from "../components/interactions";
import "@fontsource-variable/public-sans";
import "katex/dist/katex.min.css";
import "./globals.css";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const s = await contentService().settings();
  return {
    metadataBase: new URL(origin()),
    title: { default: s.name, template: `%s — ${s.name}` },
    description: s.description,
    authors: [{ name: s.author }],
    alternates: { types: { "application/rss+xml": "/rss.xml" } },
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const s = await contentService().settings();
  const script = `(function(){var d=${JSON.stringify(s.defaultTheme)};try{d=localStorage.getItem('blog-theme')||d}catch(e){}var m=matchMedia('(prefers-color-scheme: dark)');function a(){document.documentElement.dataset.theme=d==='dark'||d==='system'&&m.matches?'dark':'light'}a();m.addEventListener('change',function(){try{d=localStorage.getItem('blog-theme')||${JSON.stringify(s.defaultTheme)}}catch(e){}a()})})();`;
  return (
    <html lang={s.language} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Langsung ke isi
        </a>
        <div className="site-shell">
          <header className="site-header">
            <a href="/" className="site-name">
              {s.name}
            </a>
            <div className="header-actions">
              <nav className="desktop-navigation" aria-label="Navigasi utama">
                {s.navbar.map((l) => (
                  <a key={l.href} href={l.href}>
                    {l.label}
                  </a>
                ))}
              </nav>
              <ThemeControl defaultTheme={s.defaultTheme} />
              <MobileMenu links={s.navbar} />
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            <Entrance>{children}</Entrance>
          </main>
          <footer className="site-footer">
            <p>{s.footer}</p>
            <a href="/rss.xml">RSS</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
