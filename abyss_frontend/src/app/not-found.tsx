import Link from "next/link";

import { AbyssLogo, AbyssWordmark } from "@/components/layout/abyss-logo";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="px-4 py-4 sm:px-6 sm:py-5">
        <Link href="/home" aria-label="Abyss home" className="flex w-fit items-center gap-2 rounded-lg">
          <AbyssLogo size={34} />
          <AbyssWordmark className="text-xl" />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16 text-center">
        <p className="text-sm font-medium text-sage-text">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          This page doesn&apos;t exist
        </h1>
        <p className="mt-3 max-w-sm text-muted-foreground">
          The link may be out of date, or the agent or thread was deleted.
        </p>
        <Button asChild className="mt-8">
          <Link href="/agents">Go to your agents</Link>
        </Button>
      </main>
    </div>
  );
}
