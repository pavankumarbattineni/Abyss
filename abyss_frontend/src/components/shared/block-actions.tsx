"use client";

import type { RefObject } from "react";
import { Copy, Download, Image as ImageIcon, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui";
import { copyNodeAsImage, downloadBlob, downloadNodeAsPng, tsvToCsv } from "@/lib/block-export";
import { cn } from "@/lib/utils";
import { ActionMenu, type ActionMenuItem } from "./action-menu";
import { writeClipboard } from "./copy-button";
import { tableToTsv } from "./table-text";

type MaybeItem = ActionMenuItem | false | null | undefined;

/**
 * The actions of a rich block in an answer (live preview, interactive view,
 * visual, diagram, table), shown as in ChatGPT and Claude: the block itself
 * carries no header; in its top-right corner floats an always-visible Expand
 * button, with a "more" menu beside it that appears while the block is
 * hovered or focused (always on touch screens). Wrap the block and this bar
 * in a `relative` element with the `group/block` class.
 *
 * In full screen the bar becomes the layer's header instead: the block's
 * name on the left, the menu and "Exit full screen" on the right.
 */
interface BlockActionsProps {
  /** What the block is, e.g. "Live preview" -- names the menu and the full-screen header. */
  label: string;
  /** Menu items; `false`/`null` entries are skipped, so conditional items can be written inline. */
  items: MaybeItem[];
  /** Adds "Copy as image" and "Download as PNG", drawn from this element (when it's shown). */
  image?: { target: RefObject<HTMLElement | null>; fileName: string };
  /** Items listed after the image ones (e.g. "Download as SVG"). */
  moreItems?: MaybeItem[];
  /** Opens (or, in full screen, closes) the larger view. Omit for blocks without one. */
  onExpand?: () => void;
  /** The block is open full screen: render as its header. */
  fullscreen?: boolean;
  /** The hover group that reveals the menu: `block` (default), or `table` for a table nested inside another block. */
  hoverGroup?: "block" | "table";
  className?: string;
}

// Shown while the block is hovered or has focus, while open, and always on
// touch screens. display, not opacity: a hidden menu takes no room beside the
// Expand button. Static class names, so Tailwind generates both variants.
const REVEAL = {
  block:
    "hidden group-hover/block:flex group-focus-within/block:flex data-[state=open]:flex [@media(hover:none)]:flex",
  table:
    "hidden group-hover/table:flex group-focus-within/table:flex data-[state=open]:flex [@media(hover:none)]:flex",
};
// A bar with only the menu (tables) appears and disappears as a whole.
const REVEAL_BAR = {
  block: "hidden group-hover/block:flex group-focus-within/block:flex has-[[data-state=open]]:flex [@media(hover:none)]:flex",
  table: "hidden group-hover/table:flex group-focus-within/table:flex has-[[data-state=open]]:flex [@media(hover:none)]:flex",
};

export function BlockActions({
  label,
  items,
  image,
  moreItems = [],
  onExpand,
  fullscreen = false,
  hoverGroup = "block",
  className,
}: BlockActionsProps) {
  const imageItems: MaybeItem[] = image
    ? [
        {
          label: "Copy as image",
          icon: ImageIcon,
          onClick: () =>
            runWithFeedback(async () => {
              const node = image.target.current;
              if (!node) return;
              return (await copyNodeAsImage(node, image.fileName)) === "copied" ? "Image copied" : "Image downloaded";
            }, "Couldn't create the image"),
        },
        {
          label: "Download as PNG",
          icon: Download,
          onClick: () =>
            runWithFeedback(async () => {
              const node = image.target.current;
              if (node) await downloadNodeAsPng(node, image.fileName);
            }, "Couldn't create the image"),
        },
      ]
    : [];
  const visibleItems = [...items, ...imageItems, ...moreItems].filter((item): item is ActionMenuItem => !!item);
  return (
    <div
      // Never part of an exported image (a table's bar inside an interactive view).
      data-export-skip=""
      className={cn(
        "items-center gap-2 font-sans",
        fullscreen
          ? "flex shrink-0 justify-between border-b border-border bg-muted px-3 py-1"
          : // A small floating bar in the block's top-right corner (as in Claude).
            cn(
              "absolute top-2 right-2 z-10 rounded-lg border border-border-soft bg-background/85 p-0.5 shadow-sm backdrop-blur-sm",
              onExpand ? "flex" : REVEAL_BAR[hoverGroup],
            ),
        className,
      )}
    >
      {fullscreen && <span className="truncate text-xs text-muted-foreground">{label}</span>}
      <div className="flex items-center gap-0.5">
        {visibleItems.length > 0 && (
          <ActionMenu
            items={visibleItems}
            label={`${label}: more actions`}
            menuClassName="w-auto min-w-44"
            triggerClassName={cn(!fullscreen && onExpand && REVEAL[hoverGroup])}
          />
        )}
        {onExpand && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={fullscreen ? "Exit full screen" : "Expand"}
            title={fullscreen ? "Exit full screen (Esc)" : "Expand"}
            onClick={onExpand}
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A table's actions: copy as text (tab-separated) or image, download as CSV. */
export function TableActions({
  table,
  hoverGroup = "block",
}: {
  table: RefObject<HTMLTableElement | null>;
  hoverGroup?: "block" | "table";
}) {
  return (
    <BlockActions
      label="Table"
      hoverGroup={hoverGroup}
      items={[
        {
          label: "Copy table",
          icon: Copy,
          onClick: () => (table.current ? copyText(tableToTsv(table.current), "Table") : undefined),
        },
      ]}
      image={{ target: table, fileName: "table.png" }}
      moreItems={[
        {
          label: "Download as CSV",
          icon: Download,
          onClick: () => {
            if (table.current) {
              downloadBlob(new Blob([tsvToCsv(tableToTsv(table.current))], { type: "text/csv" }), "table.csv");
            }
          },
        },
      ]}
    />
  );
}

/** Runs a menu action and reports the outcome in a toast (the menu closes on click, so it can't show it itself). */
export async function runWithFeedback(action: () => Promise<string | void>, failure: string) {
  try {
    const message = await action();
    if (message) toast.success(message);
  } catch {
    toast.error(failure);
  }
}

/** "Copy …" menu items for text, with a toast for the result. */
export async function copyText(text: string, what: string) {
  const ok = await writeClipboard(text);
  if (ok) toast.success(`${what} copied`);
  else toast.error(`Couldn't copy the ${what.toLowerCase()}`);
}
