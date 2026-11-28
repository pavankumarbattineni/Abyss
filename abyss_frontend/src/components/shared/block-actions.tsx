"use client";

import type { RefObject } from "react";
import { Copy, Download, FileSpreadsheet, Image as ImageIcon, Maximize2, Minimize2 } from "lucide-react";
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
 * carries no header. Just above its top-right corner sit an always-visible
 * Expand button and, beside it, a "more" menu that appears while the block is
 * hovered or focused (always on touch screens). Render this bar first, then
 * the block, inside an element with the `group/block` class.
 *
 * The bar takes a slim row of its own rather than floating over the block:
 * over a block it would hide what's under it -- a page's own navigation or
 * scrollbar in a live preview, a node of a wide diagram, a table's header.
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
// touch screens. It keeps its room while hidden, so nothing shifts on hover.
// Static class names, so Tailwind generates both variants.
const REVEAL = {
  block:
    "opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-within/block:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
  table:
    "opacity-0 transition-opacity group-hover/table:opacity-100 group-focus-within/table:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
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
          : "mb-1 flex h-7 justify-end",
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
            triggerClassName={cn(!fullscreen && REVEAL[hoverGroup])}
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
  className,
}: {
  table: RefObject<HTMLTableElement | null>;
  hoverGroup?: "block" | "table";
  className?: string;
}) {
  return (
    <BlockActions
      label="Table"
      hoverGroup={hoverGroup}
      className={className}
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
        {
          label: "Download as Excel",
          icon: FileSpreadsheet,
          onClick: () =>
            runWithFeedback(async () => {
              if (!table.current) return;
              // The Excel writer loads only when a workbook is asked for.
              const [{ default: writeXlsxFile }, { sheetFromTsv, workbookSheets }] = await Promise.all([
                import("write-excel-file/browser"),
                import("@/lib/visuals/spreadsheet"),
              ]);
              const sheets = workbookSheets([sheetFromTsv(tableToTsv(table.current))]);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              downloadBlob(await writeXlsxFile(sheets as any).toBlob(), "table.xlsx");
            }, "The Excel file couldn't be created. Try Download as CSV."),
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
