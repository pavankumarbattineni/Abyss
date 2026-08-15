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
      <div className="flex items-center gap-2">
        <Image
          src="/images/thinkloop-logo1.png"
          alt="ThinkLoop"
          width={40}
          height={40}
        />
        <span className="bg-linear-to-r from-primary to-warning bg-clip-text font-mono text-2xl font-semibold text-transparent">
          ThinkLoop
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" disabled>
          Contact sales
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled>
          Docs
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={isSignupRoute ? "/auth/login" : "/auth/signup"}>
            {isSignupRoute ? "Sign in" : "Create account"}
          </Link>
        </Button>
      </div>
    </div>
  );
}
