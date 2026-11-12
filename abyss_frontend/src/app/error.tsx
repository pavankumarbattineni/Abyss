"use client";

import { useEffect } from "react";
import Link from "next/link";

import { AbyssLogo, AbyssWordmark } from "@/components/layout/abyss-logo";
import { Button } from "@/components/ui";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="px-4 py-4 sm:px-6 sm:py-5">
        <Link href="/home" aria-label="Abyss home" className="flex w-fit items-center gap-2 rounded-lg">
          <AbyssLogo size={34} />
          <AbyssWordmark className="text-xl" />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          This page failed to load
        </h1>
        <p className="mt-3 max-w-sm text-muted-foreground">
          Try again. If it keeps failing, reload the page or go back to your agents.
        </p>
        {error.digest && (
          <p className="mt-4 rounded-md bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
            Error ID: {error.digest}
          </p>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button onClick={unstable_retry}>Try again</Button>
          <Button variant="outline" asChild>
            <Link href="/agents">Go to your agents</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
