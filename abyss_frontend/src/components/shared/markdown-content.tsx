"use client";

import { memo } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

import { INTERACTIVE_LANGUAGE, looksLikeInteractiveJson } from "@/lib/interactive";
import { normalizeMathDelimiters } from "@/lib/math-delimiters";
import { cn } from "@/lib/utils";
import { CodeBlock, CopyableTable } from "./code-block";
// Charts pull in recharts, which is large: load it only when an answer
// actually contains an interactive block.
const InteractiveBlock = dynamic(
  () => import("./interactive-block").then((mod) => mod.InteractiveBlock),
  {
    ssr: false,
    loading: () => (
      <div className="mb-3 flex h-32 items-center justify-center rounded-lg border border-border bg-card font-sans text-xs text-muted-foreground">
        Loading view…
      </div>
    ),
  },
);
import { MermaidDiagram } from "./mermaid-diagram";

// Same renderer as Trench (minus its document citations). singleTilde off:
// a lone "~" (e.g. "~2,400") is never read as strikethrough -- only "~~x~~".
// singleDollarTextMath off: only $$...$$ is math (see math-delimiters.ts), so
// prose like "costs $5 and $10" never renders as an equation. Raw HTML is
// never rendered: agent and tool output is untrusted.
const REMARK_PLUGINS: Options["remarkPlugins"] = [
  [remarkGfm, { singleTilde: false }],
  [remarkMath, { singleDollarTextMath: false }],
];
// A malformed equation renders as its source in the error color instead of
// throwing and blanking the whole message.
const REHYPE_PLUGINS: Options["rehypePlugins"] = [
  [rehypeKatex, { throwOnError: false, strict: "ignore", errorColor: "var(--destructive)" }],
];

interface HastLike {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastLike[];
}

/** If a <pre>'s hast node wraps a fenced code block, returns its language
 * ("" when none) and raw source; otherwise null. Handled at the <pre> level
 * so diagrams and interactive views aren't nested inside a <pre>. */
function fencedCode(node: unknown): { language: string; code: string } | null {
  const code = (node as HastLike | undefined)?.children?.[0];
  if (code?.tagName !== "code") return null;
  const classes = code.properties?.className;
  const languageClass = Array.isArray(classes)
    ? classes.find((c): c is string => typeof c === "string" && c.startsWith("language-"))
    : undefined;
  const text = (n: HastLike): string =>
    n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(text).join("");
  return { language: languageClass?.slice("language-".length) ?? "", code: text(code) };
}

function buildComponents(isStreaming: boolean): Components {
  return {
    a: ({ href, children, ...props }) => (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-sage-text underline underline-offset-2 hover:text-foreground"
      >
        {children}
      </a>
    ),
    p: ({ ...props }) => <p {...props} className="mb-3 last:mb-0" />,
    ul: ({ ...props }) => <ul {...props} className="mb-3 list-disc pl-5 last:mb-0" />,
    ol: ({ ...props }) => <ol {...props} className="mb-3 list-decimal pl-5 last:mb-0" />,
    li: ({ ...props }) => <li {...props} className="mb-1" />,
    // Sizes relative to the response text so headings stay larger than it.
    h1: ({ ...props }) => <h1 {...props} className="mt-4 mb-2 text-[1.25em] font-semibold first:mt-0" />,
    h2: ({ ...props }) => <h2 {...props} className="mt-4 mb-2 text-[1.125em] font-semibold first:mt-0" />,
    h3: ({ ...props }) => <h3 {...props} className="mt-3 mb-2 text-[1em] font-semibold first:mt-0" />,
    h4: ({ ...props }) => <h4 {...props} className="mt-3 mb-2 text-[1em] font-semibold first:mt-0" />,
    strong: ({ ...props }) => <strong {...props} className="font-semibold" />,
    blockquote: ({ ...props }) => (
      <blockquote {...props} className="mb-3 border-l-2 border-primary pl-3 text-muted-foreground" />
    ),
    hr: () => <hr className="my-4 border-border" />,
    code: ({ className, children, ...props }) => {
      const isBlock = /language-/.test(className ?? "");
      if (isBlock) {
        return (
          <code
            className={cn("block overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[0.875em]", className)}
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.875em]" {...props}>
          {children}
        </code>
      );
    },
    pre: ({ node, ...props }) => {
      const block = fencedCode(node);
      if (block?.language === "mermaid") {
        return <MermaidDiagram code={block.code} isStreaming={isStreaming} />;
      }
      if (
        block?.language === INTERACTIVE_LANGUAGE ||
        (block?.language === "json" && !isStreaming && looksLikeInteractiveJson(block.code))
      ) {
        return <InteractiveBlock source={block.code} isStreaming={isStreaming} />;
      }
      if (block) return <CodeBlock language={block.language} code={block.code} />;
      return <pre {...props} className="mb-3 last:mb-0" />;
    },
    table: ({ children }) => <CopyableTable>{children}</CopyableTable>,
    th: ({ ...props }) => (
      <th {...props} className="border border-border bg-muted/60 px-2 py-1 text-left font-semibold" />
    ),
    td: ({ ...props }) => <td {...props} className="border border-border px-2 py-1" />,
  };
}

// Built once, never per render: a new components object gives React new
// component *types*, so every code block, diagram, chart and table of every
// message was unmounted and rebuilt on each re-render of the chat (each
// keystroke in the composer) -- diagrams collapsed to their placeholder and
// redrew, and the chat's scroll position jumped with the changing height.
const COMPONENTS: Components = buildComponents(false);
const STREAMING_COMPONENTS: Components = buildComponents(true);

interface MarkdownContentProps {
  content: string;
  /** True while the message is still being generated -- diagrams and
   * interactive views wait until their (otherwise incomplete) source has
   * fully arrived. */
  isStreaming?: boolean;
  className?: string;
}

/** Memoized: re-renders only when this message's own content changes, not on
 * every update of the chat around it (e.g. typing the next question). */
export const MarkdownContent = memo(function MarkdownContent({
  content,
  isStreaming = false,
  className,
}: MarkdownContentProps) {
  return (
    // Agent response typography, as in Trench: Source Serif 4 at a reading
    // size. Same element while streaming and after, so fonts never jump.
    <div className={cn("min-w-0 font-serif text-[16px] leading-[1.7] wrap-break-word", className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={isStreaming ? STREAMING_COMPONENTS : COMPONENTS}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
});
