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
    <nav className="flex w-48 shrink-0 flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground",
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
