"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { SETTINGS_PAGES } from "./settings-pages";

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings"
      className="-mx-4 flex shrink-0 gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:w-48 md:flex-col md:gap-0.5 md:overflow-visible md:px-0"
    >
      {SETTINGS_PAGES.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            aria-current={active ? "page" : undefined}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              active && "bg-accent font-medium text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
            {item.soon && <span className="ml-auto text-[11px] text-muted-foreground">Soon</span>}
          </Link>
        );
      })}
    </nav>
  );
}
