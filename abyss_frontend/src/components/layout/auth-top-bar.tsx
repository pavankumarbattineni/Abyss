"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui";

export function AuthTopBar() {
  const pathname = usePathname();
  const isSignupRoute = pathname?.startsWith("/auth/signup");

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5">
      <Link href="/" className="flex items-center gap-2" aria-label="Abyss-AI home">
        <Image
          src="/images/abyss-mark.png"
          alt="Abyss-AI"
          width={40}
          height={40}
          style={{ height: "auto" }}
        />
        <span className="bg-linear-to-r from-primary to-warning bg-clip-text font-mono text-2xl font-semibold text-transparent">
          Abyss-AI
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
