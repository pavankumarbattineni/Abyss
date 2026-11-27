import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ComponentType } from "react";
import { Activity, BotMessageSquare, PencilRuler, ScrollText } from "lucide-react";

import { McpLogo } from "@/components/shared/mcp-logo";

export interface SidebarNavItem {
  id: string;
  label: string;
  href: string;
  /** A Lucide icon, or a brand mark drawn the same way (e.g. the MCP logo). */
  icon: ComponentType<{ className?: string }>;
}

export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  { id: "agents", label: "Agents", href: "/agents", icon: BotMessageSquare },
  // Where agents are designed and edited (create at /agents/create).
  { id: "agent-builder", label: "Agent Studio", href: "/agents/create", icon: PencilRuler },
  // The user's remote MCP servers, named for what they do for agents.
  { id: "mcp", label: "Connectors", href: "/mcp", icon: McpLogo },
  { id: "skills", label: "Skills", href: "/skills", icon: ScrollText },
  { id: "tracing", label: "Tracing", href: "/tracing", icon: Activity },
];

interface SidebarState {
  collapsed: boolean;
  navItems: SidebarNavItem[];
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  /** Phones only: whether the slide-in sidebar is open. Not persisted. */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  /** Whether the "Recents" list (the user's agents, latest used first) is shown. */
  recentsOpen: boolean;
  toggleRecents: () => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      navItems: SIDEBAR_NAV_ITEMS,
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
      mobileOpen: false,
      setMobileOpen: (mobileOpen) => set({ mobileOpen }),
      recentsOpen: true,
      toggleRecents: () => set((state) => ({ recentsOpen: !state.recentsOpen })),
    }),
    {
      name: "thinkloop-sidebar",
      skipHydration: true,
      partialize: (state) => ({ collapsed: state.collapsed, recentsOpen: state.recentsOpen }),
    },
  ),
);
