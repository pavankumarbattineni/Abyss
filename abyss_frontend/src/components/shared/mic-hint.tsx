"use client";

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";

/** How long "Coming soon" stays up after a click. */
const SOON_MS = 1600;

/**
 * The composer's mic icon. Voice input isn't built yet: hovering the icon says
 * "Dictate", clicking it says "Coming soon" in the same tooltip, right at the icon.
 */
export function MicHint() {
  const [open, setOpen] = useState(false);
  const [soon, setSoon] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const showSoon = () => {
    setSoon(true);
    setOpen(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setSoon(false);
      setOpen(false);
    }, SOON_MS);
  };

  return (
    <Tooltip
      open={open}
      // A click would close the tooltip; while it says "Coming soon" it stays.
      onOpenChange={(next) => {
        if (next || !soon) setOpen(next);
      }}
    >
      <TooltipTrigger asChild>
        {/* Just the icon: no fill or border, only its colour on hover; focusable for the keyboard. */}
        <button
          type="button"
          className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Dictate (coming soon)"
          onClick={showSoon}
        >
          <Mic className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} aria-live="polite">
        {soon ? "Coming soon" : "Dictate"}
      </TooltipContent>
    </Tooltip>
  );
}
