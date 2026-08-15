"use client";

import { useState } from "react";
import { MoreVertical } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui";

export interface ActionMenuItem {
  label: string;
  icon: React.ElementType;
  onClick: () => void | Promise<void>;
  variant?: "default" | "destructive";
  disabled?: boolean;
}

interface ActionMenuProps {
  items: ActionMenuItem[];
}

export const ActionMenu = ({ items }: ActionMenuProps) => {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <MoreVertical className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-40 gap-0 p-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={async () => {
                await item.onClick();
                setOpen(false);
              }}
              className={
                item.variant === "destructive"
                  ? "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                  : "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
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
