"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Button,
  Heading,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { ActionMenu } from "@/components/shared/action-menu";
import { DeleteAgentDialog } from "@/components/shared/delete-agent-dialog";
import { MOBILE_QUERY, useMediaQuery } from "@/hooks";
import { useStableOrder } from "@/hooks";
import { useAuth } from "@/providers";
import { agentService } from "@/services";
import { useSidebarStore } from "@/store";
import type { Agent } from "@/types";
import { AbyssLogo, AbyssWordmark } from "./abyss-logo";

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

/** Names an icon-only item while the sidebar is collapsed, styled like the
 *  thread-title tooltip (themed Radix tooltip instead of the browser's native
 *  `title`). Expanded, the label is visible, so no tooltip is rendered. */
function NavTooltip({
  label,
  show,
  children,
}: {
  label: string;
  show: boolean;
  children: React.ReactElement;
}) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-64 break-words">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** An agent row's full name: always while the sidebar is collapsed (only the
 *  avatar shows), and while it's open only when the name is cut off with "…".
 *  Placed beside the row, wide enough for long names. */
function AgentNameTooltip({
  name,
  collapsed,
  children,
}: {
  name: string;
  collapsed: boolean;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  // Typed as the trigger expects; it is the row's link element, only measured here.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isCutOff = () => {
    const label = triggerRef.current?.querySelector<HTMLElement>("[data-agent-name]");
    return !!label && label.scrollWidth > label.clientWidth;
  };
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && (collapsed || isCutOff()))}>
      <TooltipTrigger asChild ref={triggerRef}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="right" align="center" sideOffset={collapsed ? 8 : 12} className="max-w-80 break-words">
        {name}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  // The phone menu always shows labels; collapsing is a desktop choice.
  const collapsed = useSidebarStore((state) => state.collapsed) && !isMobile;
  const mobileOpen = useSidebarStore((state) => state.mobileOpen);
  const setMobileOpen = useSidebarStore((state) => state.setMobileOpen);
  const navItems = useSidebarStore((state) => state.navItems);
  const toggleCollapsed = useSidebarStore((state) => state.toggleCollapsed);
  const recentsOpen = useSidebarStore((state) => state.recentsOpen);
  const toggleRecents = useSidebarStore((state) => state.toggleRecents);
  // Agent rows are names only, so the icon-only sidebar has nothing to show for
  // them: there the list is folded (agents are a click away, expanded or on /agents).
  const showRecents = !collapsed && recentsOpen;
  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["agents"],
    queryFn: () => agentService.getAgents(),
  });
  // Recent-first, but never re-sorted under the pointer (see useStableOrder).
  const { items: listedAgents, bind: holdAgentOrder } = useStableOrder(agents, (agent) => agent.id);
  const { user, isUserLoading } = useAuth();
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);

  useEffect(() => {
    useSidebarStore.persist.rehydrate();
  }, []);

  // Navigating closes the phone menu.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

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
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/30 md:hidden"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          "flex h-dvh shrink-0 flex-col border-r border-border-soft bg-surface px-3 py-4",
          // Phones: an off-canvas menu. Desktop: a column that can collapse.
          "fixed inset-y-0 left-0 z-50 w-72 transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transition-[width] md:duration-150",
          mobileOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
          collapsed ? "md:w-16" : "md:w-64",
        )}
        aria-label="Main navigation"
      >
        <div
          className={cn(
            "mb-4 flex items-center gap-2 px-1",
            collapsed && "flex-col gap-2",
          )}
        >
          <Link
            href="/home"
            aria-label="Abyss home"
            className={cn(
              "flex items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              collapsed && "flex-col",
            )}
          >
            <AbyssLogo size={collapsed ? 24 : 34} />
            {!collapsed && (
              <Heading as="span" size="lg">
                <AbyssWordmark />
              </Heading>
            )}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              "text-muted-foreground hover:text-foreground",
              !collapsed && "ml-auto",
            )}
            aria-label={
              isMobile
                ? "Close menu"
                : collapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
            }
            onClick={isMobile ? () => setMobileOpen(false) : toggleCollapsed}
          >
            {isMobile ? (
              <X className="size-4" />
            ) : collapsed ? (
              <ChevronsRight className="size-3.5" />
            ) : (
              <ChevronsLeft className="size-3.5" />
            )}
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {!collapsed && (
            <Heading as="div" size="xs" className="px-2 pb-1.5 pt-3 text-foreground">
              Platform
            </Heading>
          )}
          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <NavTooltip key={item.id} label={item.label} show={collapsed}>
                  <Link
                    href={item.href}
                    aria-label={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-surface-hover",
                      active && "bg-accent font-medium text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                </NavTooltip>
              );
            })}
          </nav>

          <div className="flex items-center px-2 pb-1.5 pt-4">
            {/* The agents, latest used first: a list that folds away. In the icon-only
                sidebar it always shows (there's no heading to unfold it from). */}
            {!collapsed && (
              <button
                type="button"
                onClick={toggleRecents}
                aria-expanded={recentsOpen}
                aria-controls="sidebar-recents"
                className="-ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-foreground transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Heading as="span" size="xs" className="text-inherit">
                  Recents
                </Heading>
                <ChevronDown
                  className={cn("size-3.5 transition-transform duration-150", !recentsOpen && "-rotate-90")}
                  aria-hidden="true"
                />
              </button>
            )}
            {/* Icon-only in both sidebar widths, so it's always named on hover. */}
            <NavTooltip label="New Agent" show>
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
            </NavTooltip>
          </div>
          {/* Only the agent list scrolls; the navigation above and the footer stay put. */}
          {/* Folded: hidden but kept (its scroll position too); the spacer keeps the footer down. */}
          {!showRecents && <div className="flex-1" />}
          <nav
            id="sidebar-recents"
            aria-label="Recents"
            hidden={!showRecents}
            className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-1 pb-1"
            {...holdAgentOrder}
          >
            {isLoading
              ? Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2.5 px-2.5 py-2"
                  >
                    <Skeleton className="h-3 flex-1" />
                  </div>
                ))
              : listedAgents.map((agent) => (
                  <div key={agent.id} className="group/agent relative">
                    <AgentNameTooltip name={agent.name} collapsed={collapsed}>
                      <Link
                        href={`/agents/${agent.id}`}
                        aria-label={collapsed ? agent.name : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground hover:bg-surface-hover",
                          !collapsed && "pr-9",
                          isActive(`/agents/${agent.id}`) &&
                            "bg-accent font-medium text-foreground",
                        )}
                      >
                        {!collapsed && (
                          <span data-agent-name className="truncate">{agent.name}</span>
                        )}
                      </Link>
                    </AgentNameTooltip>
                    {!collapsed && (
                      <div className="absolute top-1/2 right-1 -translate-y-1/2">
                        <ActionMenu
                          label={`Actions for ${agent.name}`}
                          // Opens beside the row, over the page, not over the agent list.
                          side="right"
                          align="start"
                          // Phones have no hover, so the button stays visible there.
                          triggerClassName="hover:bg-surface-hover md:opacity-0 md:group-hover/agent:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
                          items={[
                            {
                              label: "Edit",
                              icon: Pencil,
                              onClick: () => router.push(`/agents/${agent.id}/builder`),
                            },
                            {
                              label: "Delete",
                              icon: Trash2,
                              variant: "destructive",
                              onClick: () => setDeletingAgent(agent),
                            },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                ))}
          </nav>
          {deletingAgent && (
            <DeleteAgentDialog
              agent={deletingAgent}
              open
              onOpenChange={(open) => {
                if (!open) setDeletingAgent(null);
              }}
            />
          )}
        </div>

        {/* The account: its menu leads to Settings (profile and logging out live there). */}
        <div className="flex flex-col gap-1 border-t border-border-soft pt-3">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Account menu"
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-surface-hover",
                  collapsed && "flex-col gap-2",
                  // On a Settings page the account row shows where you are.
                  isActive("/settings") && "bg-accent",
                )}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {getEmailInitials(user?.email)}
                </span>
                {!collapsed &&
                  (isUserLoading ? (
                    <Skeleton className="h-3 flex-1" />
                  ) : (
                    <span className="flex-1 truncate text-sm text-foreground text-left">
                      {user?.email ?? "Account"}
                    </span>
                  ))}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              className="w-48 gap-0.5 p-1"
            >
              <PopoverClose asChild>
                <Link
                  href="/settings"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                >
                  <Settings className="size-3.5" />
                  Settings
                </Link>
              </PopoverClose>
            </PopoverContent>
          </Popover>
        </div>
      </aside>
    </>
  );
}
