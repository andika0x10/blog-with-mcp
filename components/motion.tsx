"use client";
import type { RefObject } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
gsap.registerPlugin(useGSAP);
/** Loaded in the browser only. The surrounding content is always server rendered. */
export default function Motion({ scope, kind, trigger }: { scope: RefObject<HTMLDivElement | null>; kind: "intro" | "menu"; trigger: string | boolean }) {
  useGSAP(
    () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (kind === "intro") {
        const intro = scope.current?.querySelector(".index-intro, .section-header");
        if (intro) gsap.fromTo(intro, { y: 6 }, { y: 0, duration: 0.4, ease: "power2.out", clearProps: "all" });
      } else if (trigger) gsap.fromTo(scope.current, { height: 0, opacity: 0 }, { height: "auto", opacity: 1, duration: 0.25, ease: "power2.out", clearProps: "all" });
    },
    { scope, dependencies: [trigger], revertOnUpdate: true }
  );
  return null;
}
