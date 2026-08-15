import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Bot, Server, Workflow, type LucideIcon } from "lucide-react";

export interface SidebarNavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  { id: "agents", label: "Agents", href: "/agents", icon: Bot },
  { id: "agent-builder", label: "Agent Builder", href: "/agents/create", icon: Workflow },
  { id: "mcp", label: "MCP Servers", href: "/mcp", icon: Server },
];

interface SidebarState {
  collapsed: boolean;
  navItems: SidebarNavItem[];
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      navItems: SIDEBAR_NAV_ITEMS,
      toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
    }),
    {
      name: "thinkloop-sidebar",
      skipHydration: true,
      partialize: (state) => ({ collapsed: state.collapsed }),
    },
  ),
);
