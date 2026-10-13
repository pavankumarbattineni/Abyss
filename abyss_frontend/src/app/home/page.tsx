import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Network, ShieldCheck, Wrench } from "lucide-react";

import { AuthTopBar } from "@/components/layout";
import { Button } from "@/components/ui";

export const metadata: Metadata = {
  title: "Abyss",
  description: "Build AI agents, connect real tools, and keep humans in control.",
};

const CAPABILITIES = [
  {
    icon: Wrench,
    title: "Agents with real tools",
    body: "Describe what an agent does, then connect the tools it needs through MCP. No code, no infrastructure.",
  },
  {
    icon: Network,
    title: "Specialists that work together",
    body: "Give a main agent up to five specialists. They work in parallel and report back, and the main agent writes the answer.",
  },
  {
    icon: ShieldCheck,
    title: "You stay in control",
    body: "Mark sensitive tools as requiring approval. Agents pause and wait for your decision before they act.",
  },
];

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="bg-grid-pattern pointer-events-none absolute inset-0 opacity-70" />
      <div className="pointer-events-none absolute left-1/2 top-[14%] size-[32rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[9rem]" />
      <AuthTopBar />

      <section className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 pb-12 pt-28 text-center sm:px-10 sm:pt-36">
        <div className="mb-6 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[11px] tracking-[0.18em] text-primary uppercase">
          Abyss / Autonomous Intelligence
        </div>
        <h1 className="text-5xl font-semibold leading-[0.98] tracking-tight text-foreground sm:text-7xl">
          <span className="block">Make the</span>
          <span className="block">unknown</span>
          <span className="block bg-linear-to-r from-primary via-primary to-[#82b992] bg-clip-text italic text-transparent">
            operational.
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-body sm:text-lg">
          Design intelligent agents. Connect real-world tools.
          <br className="hidden sm:block" /> Delegate across specialists. Keep humans in control.
        </p>
        <div className="mt-8">
          <Button size="lg" className="min-h-11 px-5" asChild>
            <Link href="/auth/signup">
              Enter the Abyss <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="relative z-10 mx-auto grid max-w-5xl gap-4 px-6 pb-20 sm:px-10 md:grid-cols-3">
        {CAPABILITIES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-border-soft bg-surface-raised/80 p-5 text-left">
            <Icon className="mb-3 size-5 text-primary" />
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
            <p className="mt-1.5 text-sm leading-6 text-body">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
