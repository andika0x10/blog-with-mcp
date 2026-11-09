"use client";
import { useRef, useState, useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
// GSAP starts its ticker at module load. Keep that module out of Workers SSR.
const Motion = dynamic(() => import("./motion"), { ssr: false });
export function Entrance({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null),
    pathname = usePathname();
  return (
    <div ref={scope}>
      <Motion scope={scope} kind="intro" trigger={pathname} />
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
    panel = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div
      className="mobile-navigation"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <Motion scope={panel} kind="menu" trigger={open} />
      <button ref={button} className="text-button" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((v) => !v)}>
        {open ? "Tutup" : "Menu"}
      </button>
      <div id="mobile-menu" ref={panel} hidden={!open}>
        <nav aria-label="Navigasi mobile">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
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
