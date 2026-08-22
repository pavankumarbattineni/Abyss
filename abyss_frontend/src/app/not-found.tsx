import Link from "next/link";
import { ArrowLeft, FileX } from "lucide-react";

import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* Subtle dot-grid background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--primary) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Ambient glow blobs */}
      <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
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
          Abyss-AI
        </span>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 text-center">
        {/* Icon badge */}
        <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
          <FileX className="size-8 text-primary" />
        </div>

        {/* 404 numeral */}
        <p
          className="mb-4 bg-clip-text text-8xl font-bold leading-none text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(135deg, var(--primary) 0%, #a78bff 50%, oklch(0.62 0.18 280) 100%)",
          }}
        >
          404
        </p>

        <h1 className="mb-2 text-xl font-semibold text-foreground">
          Page not found
        </h1>
        <p className="mb-8 max-w-sm text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          Head back to your workspace to continue building agents.
        </p>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button asChild variant="outline">
            <Link href="/agents">
              <ArrowLeft className="size-4" />
              Back to workspace
            </Link>
          </Button>
          <Button asChild>
            <Link href="/agents">Go to agents</Link>
          </Button>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-8 py-6 text-center">
        <p className="text-xs text-muted-foreground/50">
          Abyss-AI · Intelligence without limits
        </p>
      </footer>
    </div>
  );
}
