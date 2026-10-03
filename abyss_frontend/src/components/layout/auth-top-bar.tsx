"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui";
import { AbyssLogo } from "./abyss-logo";

export function AuthTopBar() {
  const pathname = usePathname();
  const isSignupRoute = pathname?.startsWith("/auth/signup");

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5">
      <Link href="/home" className="flex items-center gap-2" aria-label="Abyss-AI home">
        <AbyssLogo size={40} />
        <span className="font-mono text-2xl font-semibold">
          <span style={{ color: "#E8ECEF" }}>Abyss</span>
          <span style={{ color: "#7A9AA3" }}>-AI</span>
        </span>
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
