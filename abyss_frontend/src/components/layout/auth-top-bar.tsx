"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui";
import { AbyssLogo, AbyssWordmark } from "./abyss-logo";

export function AuthTopBar() {
  const pathname = usePathname();
  const isSignupRoute = pathname?.startsWith("/auth/signup");

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5">
      <Link href="/home" className="flex items-center gap-2" aria-label="Abyss-AI home">
        <AbyssLogo size={40} />
        <AbyssWordmark className="text-2xl" />
      </Link>

      <div className="flex items-center gap-2">
        <Button type="button" variant={!isSignupRoute ? "secondary" : "ghost"} size="sm" asChild>
          <Link href="/auth/login">Sign In</Link>
        </Button>
        <Button type="button" variant={isSignupRoute ? "secondary" : "outline"} size="sm" asChild>
          <Link href="/auth/signup">Sign Up</Link>
        </Button>
      </div>
    </div>
  );
}
