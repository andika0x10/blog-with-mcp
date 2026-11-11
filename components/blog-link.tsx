import type { ComponentProps } from "react";
import { isExternalLink } from "../lib/links";

export function BlogLink({ siteOrigin, href, children, ...props }: ComponentProps<"a"> & { siteOrigin: string }) {
  const external = isExternalLink(href, siteOrigin);
  return (
    <a {...props} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      <span className="link-label">{children}</span>
      {external && (
        <>
          <svg
            className="external-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
          </svg>
          <span className="sr-only"> (dibuka di tab baru)</span>
        </>
      )}
    </a>
  );
}
