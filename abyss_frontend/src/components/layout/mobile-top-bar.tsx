"use client";

import Link from "next/link";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui";
import { useSidebarStore } from "@/store";
import { AbyssLogo, AbyssWordmark } from "./abyss-logo";

/** Phones only: the bar that opens the slide-in sidebar. */
export function MobileTopBar() {
  const setMobileOpen = useSidebarStore((state) => state.setMobileOpen);
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border-soft bg-surface px-2 md:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Open menu"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="size-5" />
      </Button>
      <Link href="/home" aria-label="Abyss home" className="flex items-center gap-2 rounded-lg">
        <AbyssLogo size={28} />
        <AbyssWordmark className="text-lg" />
      </Link>
    </div>
  );
}
