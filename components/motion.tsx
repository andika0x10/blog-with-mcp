"use client";
import { useRef, type RefObject } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(useGSAP, SplitText);
type Scope = RefObject<HTMLDivElement | null>;
const conditions = { mobile: "(max-width: 640px)", desktop: "(min-width: 641px)", reduce: "(prefers-reduced-motion: reduce)" };

/** Browser-only: server-rendered content never depends on animation to be visible. */
export function PageMotion({ scope, route, restored, arrival }: { scope: Scope; route: string; restored: RefObject<boolean>; arrival: { at: number; initial: boolean } }) {
  const started = useRef(new WeakMap<Element, string>());
  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add(
        conditions,
        (context) => {
          const links = gsap.utils.toArray<HTMLAnchorElement>(".post-list h2 a, .archive-year li a", root);
          const dispose: (() => void)[] = [];
          for (const link of links) {
            let hovered = false,
              focused = false;
            const update = () => {
              context.add(() => {
                const active = hovered || focused;
                gsap.to(link, { "--link-reveal": active ? "100%" : "0%", duration: context.conditions?.reduce ? 0 : 0.22, ease: "power2.out", overwrite: "auto" });
                gsap.to(link.parentElement, { x: active ? 2 : 0, duration: context.conditions?.reduce ? 0 : 0.22, overwrite: "auto" });
              });
            };
            const enter = () => {
              hovered = true;
              update();
            };
            const leave = () => {
              hovered = false;
              update();
            };
            const focus = () => {
              focused = true;
              update();
            };
            const blur = () => {
              focused = false;
              update();
            };
            link.addEventListener("pointerenter", enter);
            link.addEventListener("pointerleave", leave);
            link.addEventListener("focus", focus);
            link.addEventListener("blur", blur);
            dispose.push(() => {
              link.removeEventListener("pointerenter", enter);
              link.removeEventListener("pointerleave", leave);
              link.removeEventListener("focus", focus);
              link.removeEventListener("blur", blur);
            });
          }
          const heading = root.querySelector<HTMLElement>(".index-intro h1, .section-header h1, .article-header h1");
          const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          const paint = performance.getEntriesByName("first-contentful-paint")[0];
          // Delayed chunks and fonts must never hide content someone is already reading.
          const timely = arrival.initial ? !paint || performance.now() - paint.startTime < 700 : performance.now() - arrival.at < 700;
          if (heading && started.current.get(heading) !== route) {
            started.current.set(heading, route);
            const bounds = heading.getBoundingClientRect();
            if (
              !context.conditions?.reduce &&
              !restored.current &&
              !(arrival.initial && navigation?.type === "back_forward") &&
              !location.hash &&
              timely &&
              document.fonts.status === "loaded" &&
              bounds.bottom > 0 &&
              bounds.top < innerHeight
            ) {
              heading.classList.add("motion-heading");
              const supporting = heading.parentElement?.querySelectorAll("p, .article-meta");
              const split = SplitText.create(heading, {
                type: "lines",
                mask: "lines",
                linesClass: "motion-line",
                autoSplit: true,
                onSplit(self) {
                  const mobile = context.conditions?.mobile;
                  const duration = mobile ? 0.55 : 0.75;
                  const stagger = Math.min(mobile ? 0.04 : 0.07, 0.2 / Math.max(1, self.lines.length - 1));
                  const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
                  timeline.from(self.lines, { yPercent: 105, duration, stagger, clearProps: "transform" }, 0);
                  if (supporting?.length) timeline.from(supporting, { autoAlpha: 0, duration: 0.3, stagger: 0.05, clearProps: "opacity,visibility" }, 0.4);
                  return timeline;
                },
              });
              dispose.push(() => {
                split.revert();
                heading.classList.remove("motion-heading");
              });
            }
          }
          return () => dispose.forEach((cleanup) => cleanup());
        },
        root
      );
      return () => mm.revert();
    },
    { scope, dependencies: [route], revertOnUpdate: true }
  );
  return null;
}

export function MenuMotion({ scope, open, onReady, onClosed }: { scope: Scope; open: boolean; onReady: () => void; onClosed: () => void }) {
  const control = useRef<(value: boolean) => void>(() => {});
  const currentOpen = useRef(open);
  currentOpen.current = open;
  useGSAP(
    (_, contextSafe) => {
      const panel = scope.current;
      if (!panel) return;
      const mm = gsap.matchMedia();
      mm.add(
        conditions,
        () => {
          const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
          const desktop = matchMedia("(min-width: 641px)").matches;
          if (reduced || desktop) {
            control.current = (value) => {
              if (!value || desktop) onClosed();
            };
            control.current(currentOpen.current);
            return;
          }
          const links = panel.querySelectorAll("a");
          const timeline = gsap.timeline({ paused: true });
          timeline.fromTo(panel, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.24, ease: "power3.out" }, 0);
          timeline.fromTo(
            links,
            { autoAlpha: 0, y: -4 },
            { autoAlpha: 1, y: 0, duration: 0.12, stagger: Math.min(0.035, 0.07 / Math.max(1, links.length - 1)), ease: "power2.out" },
            0.05
          );
          let playback: gsap.core.Tween | undefined;
          control.current = contextSafe!((value: boolean) => {
            playback?.kill();
            playback = timeline.tweenTo(value ? timeline.duration() : 0, {
              duration: value ? Math.max(0.01, timeline.duration() - timeline.time()) : 0.18,
              onComplete: () => {
                if (!currentOpen.current) onClosed();
              },
            });
          });
          control.current(currentOpen.current);
          return () => {
            playback?.kill();
          };
        },
        panel
      );
      onReady();
      return () => {
        control.current = () => {};
        mm.revert();
      };
    },
    { scope, dependencies: [onReady, onClosed] }
  );
  useGSAP(
    () => {
      control.current(open);
    },
    { scope, dependencies: [open] }
  );
  return null;
}
