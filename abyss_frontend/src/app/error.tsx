"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* Dot-grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--primary) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Ambient glow */}
      <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-destructive/5 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-80 w-80 rounded-full bg-primary/4 blur-3xl" />

      {/* Brand header */}
      <header className="relative z-10 flex items-center gap-2 px-8 py-6">
        <div
          className="size-6 shrink-0 rounded-md"
          style={{
            background:
              "conic-gradient(from 200deg, var(--primary), var(--warning), var(--primary))",
          }}
        />
        <span className="font-heading text-base font-semibold tracking-tight">
          ThinkLoop
        </span>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 text-center">
        {/* Icon badge */}
        <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-destructive/10 ring-1 ring-destructive/20">
          <AlertTriangle className="size-8 text-destructive" />
        </div>

        <h1 className="mb-2 text-xl font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="mb-8 max-w-sm text-sm text-muted-foreground">
          An unexpected error occurred. You can try again or head back to your
          workspace.
        </p>

        {/* Error digest for support reference */}
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
            <Link href="/agents">Go to workspace</Link>
          </Button>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-8 py-6 text-center">
        <p className="text-xs text-muted-foreground/50">
          ThinkLoop · No-Code AI Agent Platform
        </p>
      </footer>
    </div>
  );
}
