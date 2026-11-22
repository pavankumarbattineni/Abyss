"use client";

import { useState } from "react";
import { MoreVertical } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface ActionMenuItem {
  label: string;
  icon: React.ElementType;
  onClick: () => void | Promise<void>;
  variant?: "default" | "destructive";
  disabled?: boolean;
}

interface ActionMenuProps {
  items: ActionMenuItem[];
  /** Accessible name of the trigger button. */
  label?: string;
  triggerClassName?: string;
  /** Extra classes for the menu itself (e.g. a wider menu for longer labels). */
  menuClassName?: string;
  /** Where the menu opens relative to the trigger (default: below, right-aligned). */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export const ActionMenu = ({
  items,
  label = "More actions",
  triggerClassName,
  menuClassName,
  side = "bottom",
  align = "end",
}: ActionMenuProps) => {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            triggerClassName,
          )}
        >
          <MoreVertical className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} sideOffset={6} collisionPadding={8} className={cn("w-40 gap-0 p-1", menuClassName)}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.label}
              disabled={item.disabled}
              onClick={async () => {
                // Close first: an item that opens a dialog then keeps focus,
                // instead of the closing popover moving it back to the trigger.
                setOpen(false);
                await item.onClick();
              }}
              className={
                item.variant === "destructive"
                  ? "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                  : "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              }
            >
              <Icon className="size-3.5 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};
