"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { PageHeader } from "@/components/shared";
import { Card } from "@/components/ui";
import { useHasMounted } from "@/hooks";
import { cn } from "@/lib/utils";

export const AppearanceSettingsPage = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHasMounted();
  const isDark = mounted ? resolvedTheme === "dark" : true;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Appearance" description="Choose how Abyss looks on this device." />

      <Card className="flex flex-col gap-4 p-5">
        <div className="inline-flex w-fit rounded-lg border border-border p-1">
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors",
              !isDark && "bg-accent font-medium text-foreground",
            )}
          >
            <Sun className="size-3.5" />
            Light
          </button>
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors",
              isDark && "bg-accent font-medium text-foreground",
            )}
          >
            <Moon className="size-3.5" />
            Dark
          </button>
        </div>
      </Card>
    </div>
  );
};
