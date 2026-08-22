import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Orbit, Sparkles } from "lucide-react";

import { AuthTopBar } from "@/components/layout";
import { Button } from "@/components/ui";

export const metadata: Metadata = {
  title: "Abyss-AI",
  description: "A command center for building deeper intelligence.",
};

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="bg-grid-pattern pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute left-[42%] top-[18%] size-[32rem] rounded-full bg-primary/10 blur-[9rem]" />
      <div className="pointer-events-none absolute -bottom-40 right-[-8rem] size-[30rem] rounded-full bg-warning/10 blur-[8rem]" />
      <AuthTopBar />

      <section className="relative z-10 mx-auto flex min-h-screen max-w-7xl items-center px-6 pb-16 pt-28 sm:px-10 lg:px-16">
        <div className="grid w-full items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
          <div className="max-w-2xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-[0.2em] text-primary uppercase">
              <Sparkles className="size-3.5" /> Abyss-AI / intelligence without limits
            </div>
            <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight text-foreground sm:text-7xl">
              Make the unknown
              <span className="block bg-linear-to-r from-primary via-primary to-warning bg-clip-text italic text-transparent">
                operational.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              Abyss-AI is the visual command center for autonomous agents, real-world
              tools, and decisions that move at the speed of thought.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link href="/auth/signup">Enter the Abyss <ArrowUpRight className="size-4" /></Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/auth/login">Sign In</Link>
              </Button>
            </div>
            <div className="mt-12 flex flex-wrap gap-x-8 gap-y-3 text-xs tracking-[0.18em] text-muted-foreground uppercase">
              <span>Design</span><span>Orchestrate</span><span>Deploy</span><span>Discover</span>
            </div>
          </div>

          <div className="relative hidden min-h-[28rem] items-center justify-center lg:flex">
            <div className="absolute size-[26rem] rounded-full border border-primary/20 shadow-[0_0_120px_rgba(82,154,163,0.12)]" />
            <div className="absolute size-[19rem] rounded-full border border-border2 border-dashed" />
            <div className="absolute size-[12rem] rounded-full bg-linear-to-br from-primary/30 via-bg2 to-warning/20 shadow-[0_0_80px_rgba(82,154,163,0.25)]" />
            <Orbit className="relative size-16 text-primary" strokeWidth={1} />
            <span className="absolute right-4 top-16 rounded-lg border border-border-soft bg-bg1/80 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
              agent / ready
            </span>
            <span className="absolute bottom-14 left-3 rounded-lg border border-border-soft bg-bg1/80 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
              human + machine
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
