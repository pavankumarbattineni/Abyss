"use client";

import { useState, type KeyboardEvent } from "react";
import { Shapes } from "lucide-react";

import { VISUAL_FORMATS, type VisualFormatMeta } from "@/lib/visuals/registry";
import { cn } from "@/lib/utils";

/** Same cap as the backend (visual_specs.MAX_REQUESTED_FORMATS). */
export const MAX_VISUAL_FORMATS = 3;

/**
 * The command being typed: a `/word` after zero or more formats already picked
 * at the start of the message, e.g. "/timeline /flo". Group 1 = the picked
 * ones (with their spaces), group 2 = what's being typed.
 */
const TYPING_COMMAND = /^((?:\/[a-z-]+\s+)*)\/([a-z-]*)$/;

function matches(query: string, picked: Set<string>): VisualFormatMeta[] {
  const open = VISUAL_FORMATS.filter((f) => !picked.has(f.name));
  if (!query) return open;
  const q = query.toLowerCase();
  return [
    ...open.filter((f) => f.name.startsWith(q)),
    ...open.filter((f) => !f.name.startsWith(q) && (f.name.includes(q) || f.label.toLowerCase().includes(q))),
  ];
}

/**
 * The composer's `/` menu of visual formats. Typing `/` at the start of a
 * message lists them; arrows move, Enter or Tab picks (inserting `/name `),
 * Escape closes. After a pick, typing `/` again adds another format (up to
 * MAX_VISUAL_FORMATS, each once): the agent answers with one visual per format. Returns the menu to render above the composer and a key
 * handler that runs before the composer's own (true = handled).
 */
export function useFormatMenu(draft: string, setDraft: (text: string) => void) {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const typed = TYPING_COMMAND.exec(draft);
  const prefix = typed?.[1] ?? "";
  const picked = new Set(prefix.split(/\s+/).filter(Boolean).map((command) => command.slice(1)));
  const options = typed && picked.size < MAX_VISUAL_FORMATS ? matches(typed[2], picked) : [];
  const open = Boolean(typed) && options.length > 0 && dismissed !== draft;
  const index = Math.min(active, Math.max(0, options.length - 1));

  const pick = (format: VisualFormatMeta) => {
    setDraft(`${prefix}/${format.name} `);
    setActive(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index + step + options.length) % options.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(options[index]);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(draft);
      return true;
    }
    return false;
  };

  const menu = open ? (
    <div
      role="listbox"
      aria-label="Visual formats"
      className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 shadow-lg"
    >
      <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-medium text-muted-foreground">
        {picked.size === 0
          ? "Answer as a visual"
          : `Add another visual (${picked.size} of ${MAX_VISUAL_FORMATS})`}
      </p>
      {options.map((format, i) => (
        <button
          key={format.name}
          type="button"
          role="option"
          aria-selected={i === index}
          // Keep focus in the composer while clicking.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(format)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left",
            i === index ? "bg-primary/12" : "hover:bg-muted",
          )}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/12 text-sage-text">
            <Shapes className="size-3.5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              /{format.name}
              <span className="ml-1.5 font-normal text-muted-foreground">{format.label}</span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">{format.description}</span>
          </span>
        </button>
      ))}
    </div>
  ) : null;

  return { menu, onKeyDown };
}
