import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { AuthTopBar, SiteFooter } from "@/components/layout";
import { Button } from "@/components/ui";

const TRENCH_URL = "https://trenchai.vercel.app";

export const metadata: Metadata = {
  title: "About Trench",
  description: "Trench, Abyss's sibling app: chat with your documents, every answer cited back to its source.",
};

const FEATURES = [
  {
    title: "Answers you can check",
    body: "Ask in plain language and every claim in the answer links back to the exact passage it came from.",
  },
  {
    title: "Personal and team knowledge",
    body: "Keep private documents to yourself, or share a company knowledge base with your team, with roles and invitations.",
  },
  {
    title: "Your files, as they are",
    body: "PDF, Word, text and Markdown, with layout-aware parsing for tables and scanned pages.",
  },
];

/** The two apps solve different problems; this says which one to reach for. */
const COMPARISON = [
  { need: "Get answers from documents you already have", app: "Trench" },
  { need: "Know exactly where each answer came from", app: "Trench" },
  { need: "Have an agent carry out work with real tools", app: "Abyss" },
  { need: "Split a task across specialists and approve risky steps", app: "Abyss" },
];

/** Trench's own mark (three terraced bars), so the sibling is recognisable. */
function TrenchMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="6" y="7" width="28" height="6" rx="3" fill="currentColor" />
      <rect x="6" y="17" width="20" height="6" rx="3" fill="currentColor" />
      <rect x="6" y="27" width="12" height="6" rx="3" fill="currentColor" />
    </svg>
  );
}

export default function AboutTrenchPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <AuthTopBar />

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="grid items-center gap-10 py-14 sm:py-20 md:grid-cols-[1.4fr_1fr]">
          <div>
            <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              Trench: chat with your documents, every answer cited.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Upload your files, ask questions in natural language, and get answers grounded only
              in what you uploaded. Built by the same team as Abyss, on the same foundations.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" className="min-h-11 px-6" asChild>
                <a href={TRENCH_URL} target="_blank" rel="noopener noreferrer">
                  Open Trench
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Button>
              <Button size="lg" variant="outline" className="min-h-11 px-6" asChild>
                <Link href="/home">Back to Abyss</Link>
              </Button>
            </div>
          </div>
          <div className="flex justify-center md:justify-end">
            <span className="flex size-40 items-center justify-center rounded-[2.5rem] bg-foreground text-background sm:size-52">
              <TrenchMark className="size-[62%]" />
            </span>
          </div>
        </section>

        <section aria-labelledby="trench-features" className="border-t border-border py-14">
          <h2 id="trench-features" className="sr-only">
            What Trench does
          </h2>
          <div className="grid gap-10 md:grid-cols-3">
            {FEATURES.map(({ title, body }) => (
              <div key={title}>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-2 leading-7 text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="which-app" className="border-t border-border py-14">
          <h2 id="which-app" className="text-2xl font-semibold tracking-tight">
            Which one do you need?
          </h2>
          <div className="mt-6 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">If you want to…</th>
                  <th scope="col" className="w-32 px-4 py-3 font-medium">Use</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(({ need, app }) => (
                  <tr key={need} className="border-t border-border">
                    <td className="px-4 py-3">{need}</td>
                    <td className="px-4 py-3 font-semibold">{app}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
