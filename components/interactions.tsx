"use client";
import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { applyFont, defaultFont, fonts, resolveFont, type FontId } from "../lib/fonts";
import { BlogLink } from "./blog-link";
// GSAP starts its ticker at module load. Keep that module out of Workers SSR.
// Animation is optional: a failed chunk must not replace the readable page.
const PageMotion = dynamic(() => import("./motion").then((m) => m.PageMotion).catch(() => () => null), { ssr: false });
const MenuMotion = dynamic(() => import("./motion").then((m) => m.MenuMotion).catch(() => () => null), { ssr: false });
export function Entrance({ children }: { children: ReactNode }) {
  const [typographyChangeRoute, setTypographyChangeRoute] = useState<string | null>(null);
  const scope = useRef<HTMLDivElement>(null),
    pathname = usePathname(),
    query = useSearchParams(),
    restored = useRef(false);
  const route = `${pathname}?${query.toString()}`;
  useEffect(() => {
    const changed = () => setTypographyChangeRoute(route);
    window.addEventListener("blog-typography-change", changed);
    return () => window.removeEventListener("blog-typography-change", changed);
  }, [route]);
  const arrival = useRef({ route, at: 0, initial: true });
  if (arrival.current.route !== route) arrival.current = { route, at: performance.now(), initial: false };
  useEffect(() => {
    const restore = () => {
      restored.current = true;
    };
    const navigate = () => {
      restored.current = false;
    };
    window.addEventListener("popstate", restore);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("popstate", restore);
      document.removeEventListener("click", navigate, true);
    };
  }, []);
  return (
    <div ref={scope}>
      <PageMotion scope={scope} route={route} restored={restored} arrival={arrival.current} skipReveal={typographyChangeRoute === route} />
      {children}
    </div>
  );
}
function AppearanceControl({ defaultTheme, open, setOpen }: { defaultTheme: string; open: boolean; setOpen: (value: boolean) => void }) {
  const [mode, setMode] = useState(defaultTheme),
    [font, setFont] = useState<FontId>(defaultFont),
    [ready, setReady] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("blog-theme");
      setMode(saved && ["system", "light", "dark"].includes(saved) ? saved : defaultTheme);
    } catch {}
    setFont(resolveFont(document.documentElement.dataset.font));
    setReady(true);
  }, [defaultTheme]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focusOutside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", focusOutside);
    };
  }, [open, setOpen]);
  const chooseFont = (value: string) => {
    const id = resolveFont(value);
    applyFont(id);
    setFont(id);
    try {
      localStorage.setItem("blog-font", id);
    } catch {}
  };
  return (
    <div
      className="appearance-control"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="text-button"
        disabled={!ready}
        aria-label="Tampilan"
        title="Tampilan"
        aria-expanded={open}
        aria-controls="appearance-panel"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
          <path d="M4 7h3m4 0h9M4 17h9m4 0h3" />
          <circle cx="9" cy="7" r="2" />
          <circle cx="15" cy="17" r="2" />
        </svg>
      </button>
      <section id="appearance-panel" className="appearance-panel" aria-label="Pengaturan tampilan" hidden={!open}>
        <label htmlFor="appearance-theme">Tema tampilan</label>
        <select
          id="appearance-theme"
          aria-label="Tema tampilan"
          disabled={!ready}
          value={mode}
          onChange={(e) => {
            const value = e.target.value;
            setMode(value);
            document.documentElement.dataset.themeMode = value;
            try {
              localStorage.setItem("blog-theme", value);
            } catch {}
            const dark = value === "dark" || (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
            document.documentElement.dataset.theme = dark ? "dark" : "light";
          }}
        >
          <option value="system">Sistem</option>
          <option value="light">Terang</option>
          <option value="dark">Gelap</option>
        </select>
        <label htmlFor="appearance-font">Font</label>
        <select id="appearance-font" value={font} onChange={(event) => chooseFont(event.target.value)}>
          {fonts.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
              {entry.id === defaultFont ? " (default)" : ""}
            </option>
          ))}
        </select>
      </section>
    </div>
  );
}
export function SiteHeader({ links, defaultTheme, siteOrigin }: { links: { label: string; href: string }[]; defaultTheme: string; siteOrigin: string }) {
  const [open, setOpen] = useState(false),
    [visible, setVisible] = useState(false),
    [interactive, setInteractive] = useState(false),
    [appearanceOpen, setAppearanceOpen] = useState(false);
  const ready = useRef(false),
    root = useRef<HTMLElement>(null),
    panel = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname(),
    query = useSearchParams();
  useEffect(() => {
    const dock = root.current;
    const shell = dock?.closest<HTMLElement>(".site-shell");
    if (!dock || !shell) return;
    const measure = () => shell.style.setProperty("--dock-height", `${dock.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--dock-height");
    };
  }, []);
  const onReady = useCallback(() => {
    ready.current = true;
  }, []);
  const onClosed = useCallback(() => {
    setVisible(false);
    setOpen(false);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setAppearanceOpen(false);
    if (!ready.current) setVisible(false);
  }, []);
  const toggleAppearance = useCallback((value: boolean) => {
    setAppearanceOpen(value);
    if (value) {
      setOpen(false);
      setVisible(false);
    }
  }, []);
  useEffect(() => {
    setInteractive(true);
  }, []);
  useEffect(() => {
    setOpen(false);
    setVisible(false);
    setAppearanceOpen(false);
  }, [pathname, query.toString()]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent | FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, close]);
  return (
    <header
      className="site-header"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close();
          button.current?.focus();
        }
      }}
    >
      <a href="/" className="home-link" aria-label="Beranda" title="Beranda" aria-current={pathname === "/" ? "page" : undefined}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" />
        </svg>
      </a>
      <button
        ref={button}
        type="button"
        disabled={!interactive}
        className="menu-toggle"
        aria-label="Menu"
        title="Menu"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => {
          if (open) close();
          else {
            setAppearanceOpen(false);
            setVisible(true);
            setOpen(true);
          }
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M14 4h6v6" />
          <path d="M20 4l-9 9" />
          <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
        </svg>
      </button>
      <AppearanceControl defaultTheme={defaultTheme} open={appearanceOpen} setOpen={toggleAppearance} />
      <MenuMotion scope={panel} open={open} onReady={onReady} onClosed={onClosed} />
      <div id="site-menu" className="header-panel" data-visible={visible} ref={panel} hidden={!visible} inert={!open} aria-hidden={!open ? true : undefined}>
        <nav
          aria-label="Navigasi utama"
          onClick={(event) => {
            if ((event.target as Element).closest("a")) close();
          }}
        >
          {links.map((link) => (
            <BlogLink key={link.href} href={link.href} siteOrigin={siteOrigin} aria-current={pathname === link.href ? "page" : undefined}>
              {link.label}
            </BlogLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
export function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null),
    [message, setMessage] = useState("Salin");
  return (
    <div className="code-block">
      <button
        className="copy-code"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(ref.current?.textContent ?? "");
            setMessage("Tersalin");
          } catch {
            setMessage("Pilih kode untuk menyalin");
          }
        }}
        aria-label="Salin kode"
      >
        {message}
      </button>
      <span className="sr-only" role="status">
        {message === "Salin" ? "" : message}
      </span>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
