import { BookUser, CodeXml, Gauge, KeyRound, Palette, SlidersHorizontal, UserRound, type LucideIcon } from "lucide-react";

/**
 * The account's pages, in one place: the Settings tabs (settings-nav) and the
 * sidebar's account menu (layout/sidebar) both list them from here, so the two
 * can't drift apart.
 */
export interface AccountPage {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Not built yet: listed with a "Soon" mark. */
  soon?: boolean;
}

/** Pages inside Settings: what you set once and change rarely. */
export const SETTINGS_PAGES: AccountPage[] = [
  { href: "/settings/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Appearance", icon: Palette },
  { href: "/settings/preferences", label: "Preferences", icon: SlidersHorizontal },
  { href: "/settings/memory", label: "Memory", icon: BookUser, soon: true },
  { href: "/settings/provider-secrets", label: "Provider Keys", icon: KeyRound },
  { href: "/settings/api-keys", label: "API Keys", icon: CodeXml },
];

/** Usage is a report you come back to, not a setting: its own page, outside Settings. */
export const USAGE_PAGE: AccountPage = { href: "/usage", label: "Usage", icon: Gauge };
