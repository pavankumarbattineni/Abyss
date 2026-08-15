"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui";

export default function DashboardErrorPage({
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
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
      {/* Icon badge */}
      <div className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-destructive/10 ring-1 ring-destructive/20">
        <AlertTriangle className="size-7 text-destructive" />
      </div>

      <h1 className="mb-2 text-lg font-semibold text-foreground">
        Something went wrong
      </h1>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">
        An unexpected error occurred while loading this page. Try again or
        navigate back to your agents.
      </p>

      {error.digest && (
        <p className="mb-6 rounded-md bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
          Error ID: {error.digest}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={unstable_retry}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
        <Button asChild>
          <Link href="/agents">Go to agents</Link>
        </Button>
      </div>
    </div>
  );
}
