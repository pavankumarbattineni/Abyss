"use client";

import { Shapes } from "lucide-react";

import { isVisualFormat } from "@/lib/visuals/parse";
import { VISUAL_FORMAT_META } from "@/lib/visuals/registry";
import type { VisualFormatName } from "@/lib/visuals/schemas";
import { COMPOSE_EVENT } from "./code-preview";

/** The visual format named by inline code like `/timeline`, if it is one. */
export function formatCommand(text: string): VisualFormatName | null {
  const match = /^\/([a-z-]+)$/.exec(text.trim());
  return match && isVisualFormat(match[1]) ? match[1] : null;
}

/**
 * A suggested follow-up format in an answer: clicking it starts the next
 * message with that command (the conversation supplies the topic).
 */
export function FormatChip({ format }: { format: VisualFormatName }) {
  const meta = VISUAL_FORMAT_META[format];
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: `/${format} ` }))}
      title={`Ask for this as a ${meta.label.toLowerCase()}`}
      className="inline-flex translate-y-[-1px] items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-px align-middle font-sans text-[0.8em] font-medium text-sage-text transition-colors hover:bg-primary/20"
    >
      <Shapes className="size-3" aria-hidden="true" />/{format}
    </button>
  );
}
