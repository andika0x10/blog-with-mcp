"use client";
import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
// GSAP starts its ticker at module load. Keep that module out of Workers SSR.
// Animation is optional: a failed chunk must not replace the readable page.
const PageMotion = dynamic(() => import("./motion").then((m) => m.PageMotion).catch(() => () => null), { ssr: false });
const MenuMotion = dynamic(() => import("./motion").then((m) => m.MenuMotion).catch(() => () => null), { ssr: false });
export function Entrance({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null),
    pathname = usePathname(),
    query = useSearchParams(),
    restored = useRef(false);
  const route = `${pathname}?${query.toString()}`;
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
      <PageMotion scope={scope} route={route} restored={restored} arrival={arrival.current} />
      {children}
    </div>
  );
}
export function ThemeControl({ defaultTheme }: { defaultTheme: string }) {
  const [mode, setMode] = useState(defaultTheme),
    [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setMode(localStorage.getItem("blog-theme") ?? defaultTheme);
    } catch {}
    setReady(true);
  }, [defaultTheme]);
  return (
    <label className="theme-control">
      <span className="sr-only">Tema tampilan</span>
      <select
        aria-label="Tema tampilan"
        disabled={!ready}
        value={mode}
        onChange={(e) => {
          const value = e.target.value;
          setMode(value);
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
    </label>
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
