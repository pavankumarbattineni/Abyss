"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { PageHeader } from "@/components/shared";
import { Card } from "@/components/ui";
import { useHasMounted } from "@/hooks";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export const AppearanceSettingsPage = () => {
  const { theme, setTheme } = useTheme();
  const mounted = useHasMounted();
  const current = mounted ? (theme ?? "system") : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Appearance" description="Choose how Abyss looks on this device." />

      <Card className="flex flex-col gap-3 p-5">
        <div role="radiogroup" aria-label="Theme" className="inline-flex w-fit rounded-lg border border-border p-1">
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={current === value}
              onClick={() => setTheme(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                current === value && "bg-accent font-medium text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">System follows your device&apos;s light or dark setting.</p>
      </Card>
    </div>
  );
};
