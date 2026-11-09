"use client";
import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { applyFont, defaultFont, fonts, resolveFont, type FontId } from "../lib/fonts";
import { applyTextSize, defaultTextSize, resolveTextSize, textSizes, type TextSizeId } from "../lib/text-size";
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
export function AppearanceControl({ defaultTheme }: { defaultTheme: string }) {
  const [mode, setMode] = useState(defaultTheme),
    [font, setFont] = useState<FontId>(defaultFont),
    [textSize, setTextSize] = useState<TextSizeId>(defaultTextSize),
    [open, setOpen] = useState(false),
    [ready, setReady] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname(),
    query = useSearchParams();
  useEffect(() => {
    try {
      const saved = localStorage.getItem("blog-theme");
      setMode(saved && ["system", "light", "dark"].includes(saved) ? saved : defaultTheme);
    } catch {}
    setFont(resolveFont(document.documentElement.dataset.font));
    setTextSize(resolveTextSize(document.documentElement.dataset.fontSize));
    setReady(true);
  }, [defaultTheme]);
  useEffect(() => setOpen(false), [pathname, query.toString()]);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("blog-menu-open", close);
    return () => window.removeEventListener("blog-menu-open", close);
  }, []);
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
  }, [open]);
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
        aria-expanded={open}
        aria-controls="appearance-panel"
        onClick={() => {
          if (!open) window.dispatchEvent(new Event("blog-appearance-open"));
          setOpen(!open);
        }}
      >
        Tampilan
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
        <label htmlFor="appearance-size">Ukuran teks</label>
        <select
          id="appearance-size"
          value={textSize}
          onChange={(event) => {
            const id = resolveTextSize(event.target.value);
            applyTextSize(id);
            setTextSize(id);
            try {
              localStorage.setItem("blog-font-size", id);
            } catch {}
          }}
        >
          {textSizes.map((size) => (
            <option key={size.id} value={size.id}>
              {size.label}
            </option>
          ))}
        </select>
        <p className="font-preview">Menulis tentang hal-hal kecil yang layak diperhatikan.</p>
        <button type="button" className="text-button font-reset" disabled={font === defaultFont} onClick={() => chooseFont(defaultFont)}>
          Kembalikan font awal
        </button>
      </section>
    </div>
  );
}
export function MobileMenu({ links }: { links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false),
    [visible, setVisible] = useState(false),
    [interactive, setInteractive] = useState(false),
    ready = useRef(false),
    panel = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname(),
    query = useSearchParams();
  useEffect(() => setInteractive(true), []);
  useEffect(() => {
    const hide = () => {
      setOpen(false);
      setVisible(false);
    };
    window.addEventListener("blog-appearance-open", hide);
    return () => window.removeEventListener("blog-appearance-open", hide);
  }, []);
  const onReady = useCallback(() => {
    ready.current = true;
  }, []);
  const onClosed = useCallback(() => {
    setVisible(false);
    setOpen(false);
  }, []);
  const close = () => {
    setOpen(false);
    if (!ready.current) setVisible(false);
  };
  useEffect(() => {
    setOpen(false);
    setVisible(false);
  }, [pathname, query.toString()]);
  return (
    <div
      className="mobile-navigation"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          close();
          button.current?.focus();
        }
      }}
    >
      <MenuMotion scope={panel} open={open} onReady={onReady} onClosed={onClosed} />
      <button
        ref={button}
        disabled={!interactive}
        className="text-button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => {
          if (open) close();
          else {
            window.dispatchEvent(new Event("blog-menu-open"));
            setVisible(true);
            setOpen(true);
          }
        }}
      >
        {open ? "Tutup" : "Menu"}
      </button>
      <div id="mobile-menu" ref={panel} hidden={!visible} inert={!open} aria-hidden={!open}>
        <nav aria-label="Navigasi mobile">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={close}>
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
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
