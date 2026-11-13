"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui";
import { useAuth } from "@/providers";
import { AbyssLogo, AbyssWordmark } from "./abyss-logo";

/** Header for the signed-out pages. Home offers both ways in; the auth pages
 * show only the logo (each form links to the other itself). */
export function AuthTopBar() {
  const pathname = usePathname();
  const onAuthPage = pathname?.startsWith("/auth");
  const { isAuthenticated } = useAuth();

  return (
    <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5">
      <Link
        href="/home"
        className="flex items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Abyss home"
      >
        <AbyssLogo size={34} />
        <AbyssWordmark className="text-xl" />
      </Link>

      {!onAuthPage && isAuthenticated && (
        <Button size="sm" asChild>
          <Link href="/agents">Go to your agents</Link>
        </Button>
      )}
      {!onAuthPage && !isAuthenticated && (
        <nav className="flex items-center gap-2" aria-label="Account">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/auth/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/auth/signup">Get started</Link>
          </Button>
        </nav>
      )}
    </header>
  );
}
