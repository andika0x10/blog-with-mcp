import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./interactions";
import { Children, isValidElement, type ReactNode } from "react";
import type { Root, RootContent } from "mdast";

// Blog lists remain prose, including older content written with task markers.
function remarkBlogLists() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (node.type === "listItem") node.checked = null;
      if ("children" in node) node.children.forEach(visit);
    };
    visit(tree);
  };
}
function text(children: ReactNode): string {
  return Children.toArray(children)
    .map((c) => (isValidElement<{ children?: ReactNode }>(c) ? text(c.props.children) : String(c)))
    .join("");
}
export function Markdown({ source }: { source: string }) {
  const counts = new Map<string, number>();
  const anchor = (children: ReactNode) => {
    const base =
      text(children)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-") || "bagian";
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
  return (
    <div className="prose">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath, remarkBlogLists]}
        rehypePlugins={[
          [rehypeKatex, { strict: false, trust: false }],
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          h1: ({ children }) => <h2 id={anchor(children)}>{children}</h2>,
          h2: ({ children }) => <h2 id={anchor(children)}>{children}</h2>,
          h3: ({ children }) => <h3 id={anchor(children)}>{children}</h3>,
          h4: ({ children }) => <h4 id={anchor(children)}>{children}</h4>,
          img: ({ src, alt }) => <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" />,
          table: ({ children }) => (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabel, geser untuk melihat seluruh kolom">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
