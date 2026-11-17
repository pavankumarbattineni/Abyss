"use client";

import { useState } from "react";
import { ImageIcon, Paperclip, Plus } from "lucide-react";

import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";

/**
 * The composer's "+" menu. Static for now: both options are shown but
 * disabled until document upload is built (docs/design/document-upload.md).
 */
const OPTIONS = [
  { label: "Attach files", hint: "PDF, Word, Excel, PowerPoint, text", icon: Paperclip },
  { label: "Attach photos", hint: "PNG, JPEG, WebP", icon: ImageIcon },
];

export function AttachMenu() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-muted-foreground hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground"
          aria-label="Add attachment"
        >
          <Plus className={`size-4 transition-transform ${open ? "rotate-45" : ""}`} />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 gap-1 p-1.5">
        {OPTIONS.map(({ label, hint, icon: Icon }) => (
          <div
            key={label}
            role="menuitem"
            aria-disabled="true"
            className="flex cursor-not-allowed items-center gap-3 rounded-md px-2.5 py-2 opacity-70"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </div>
            <span className="shrink-0 rounded-full bg-highlight-soft px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-highlight">
              Coming soon
            </span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
