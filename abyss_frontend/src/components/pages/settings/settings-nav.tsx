"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Cpu, Key, Sparkles, SunMoon } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/settings", label: "Appearance", icon: SunMoon },
  { href: "/settings/preferences", label: "Preferences", icon: Sparkles },
  { href: "/settings/provider-secrets", label: "Provider Secrets", icon: Cpu },
  { href: "/settings/api-keys", label: "API Keys", icon: Key },
  { href: "/settings/usage", label: "Usage", icon: BarChart3 },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings"
      className="-mx-4 flex shrink-0 gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:w-48 md:flex-col md:gap-0.5 md:overflow-visible md:px-0"
    >
      {NAV_ITEMS.map((item) => {
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
          </Link>
        );
      })}
    </nav>
  );
}
