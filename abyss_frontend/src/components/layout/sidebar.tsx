"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Plus,
  Settings,
  User,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Button,
  Heading,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@/components/ui";
import { useAuth } from "@/providers";
import { agentService, authService } from "@/services";
import { useSidebarStore } from "@/store";
import type { Agent } from "@/types";
import { AgentAvatar } from "./agent-avatar";
import Image from "next/image";

function getEmailInitials(email?: string): string {
  const localPart = email?.split("@")[0] ?? "";
  const initials = localPart
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return initials || "NA";
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const collapsed = useSidebarStore((state) => state.collapsed);
  const navItems = useSidebarStore((state) => state.navItems);
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed);
  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["agents"],
    queryFn: () => agentService.getAgents(),
  });
  const { user, isUserLoading, refreshAuthState } = useAuth();

  useEffect(() => {
    useSidebarStore.persist.rehydrate();
  }, []);

  const allHrefs = [
    ...navItems.map((item) => item.href),
    ...agents.map((agent) => `/agents/${agent.id}`),
    "/settings",
  ];
  const activeHref = allHrefs
    .filter(
      (href) => href && (pathname === href || pathname?.startsWith(`${href}/`)),
    )
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col border-r border-border-soft bg-surface px-3 py-4 transition-[width] duration-150",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div
        className={cn(
          "mb-4 flex items-center gap-2 px-1",
          collapsed && "flex-col gap-2",
        )}
      >
        <Image
          src="/images/abyss-mark.png"
          alt="Abyss-AI"
          width={collapsed ? 28 : 34}
          height={collapsed ? 28 : 34}
          style={{ height: "auto" }}
        />
        {!collapsed && (
          <Heading
            as="span"
            size="lg"
            className="bg-linear-to-r from-primary to-warning bg-clip-text font-mono font-semibold text-transparent"
          >
            Abyss-AI
          </Heading>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn("text-muted-foreground hover:text-foreground", !collapsed && "ml-auto")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
        >
          {collapsed ? (
            <ChevronsRight className="size-3.5" />
          ) : (
            <ChevronsLeft className="size-3.5" />
          )}
        </Button>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {!collapsed && (
          <Heading as="div" size="xs" className="px-2 pb-1.5 pt-3">
            Platform
          </Heading>
        )}
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.id}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                  active && "bg-accent font-medium text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center px-2 pb-1.5 pt-4">
          {!collapsed && (
            <Heading as="span" size="xs">
              Agents
            </Heading>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="New agent"
            asChild
          >
            <Link href="/agents/create">
              <Plus className="size-3.5" />
            </Link>
          </Button>
        </div>
        <nav className="flex flex-col gap-0.5">
          {isLoading
            ? Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex items-center gap-2.5 px-2.5 py-2">
                  <Skeleton className="size-6 rounded-md" />
                  {!collapsed && <Skeleton className="h-3 flex-1" />}
                </div>
              ))
            : agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  title={collapsed ? agent.name : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                    isActive(`/agents/${agent.id}`) &&
                      "bg-accent font-medium text-foreground",
                  )}
                >
                  <AgentAvatar name={agent.name} className="size-6 text-xs" />
                  {!collapsed && <span className="truncate">{agent.name}</span>}
                </Link>
              ))}
        </nav>
      </div>

      <div className="flex flex-col gap-1 border-t border-border-soft pt-3">
        <Link
          href="/settings"
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            isActive("/settings") && "bg-accent font-medium text-foreground",
          )}
        >
          <Settings className="size-4 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-surface-hover",
                collapsed && "flex-col gap-2",
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {getEmailInitials(user?.email)}
              </span>
              {!collapsed &&
                (isUserLoading ? (
                  <Skeleton className="h-3 flex-1" />
                ) : (
                  <span className="flex-1 truncate text-sm text-muted-foreground text-left">
                    {user?.email ?? "Account"}
                  </span>
                ))}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="w-48 gap-0.5 p-1">
            <button
              type="button"
              disabled
              aria-label="Profile (coming soon)"
              className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground opacity-60"
            >
              <User className="size-3.5" />
              Profile
            </button>
            <button
              type="button"
              onClick={async () => {
                await authService.logout();
                refreshAuthState();
                router.push("/auth/login");
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
            >
              <LogOut className="size-3.5" />
              Log out
            </button>
          </PopoverContent>
        </Popover>
      </div>
    </aside>
  );
}
