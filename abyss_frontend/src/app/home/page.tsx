import type { Metadata } from "next";
import Link from "next/link";

import { AuthTopBar } from "@/components/layout";
import { Button } from "@/components/ui";

export const metadata: Metadata = {
  title: { absolute: "Abyss" },
  description: "Build AI agents, connect real tools, and keep humans in control.",
};

const CAPABILITIES = [
  {
    title: "Agents with real tools",
    body: "Describe what an agent does, then connect the tools it needs through MCP. No code, no infrastructure.",
  },
  {
    title: "Specialists that work together",
    body: "Give a main agent up to five specialists. They work in parallel and report back, and the main agent writes the answer.",
  },
  {
    title: "You stay in control",
    body: "Mark sensitive tools as requiring approval. Agents pause and wait for your decision before they act.",
  },
];

/** What happens to one request -- a real sequence, so it's numbered. */
const STEPS = [
  { title: "You ask", body: "Write to your agent like you would to a colleague." },
  { title: "It plans", body: "The main agent answers directly or hands parts of the task to its specialists." },
  { title: "Tools run", body: "Specialists call their tools. Anything sensitive waits for your approval." },
  { title: "You get the answer", body: "With every step of the reasoning one click away." },
];

/** The descent: rings receding into depth, the Tomato point at the bottom.
 * The Abyss mark, drawn large. */
function DescentArt() {
  const rings = [
    { r: 150, cy: 160 },
    { r: 118, cy: 180 },
    { r: 88, cy: 198 },
    { r: 60, cy: 214 },
    { r: 35, cy: 227 },
  ];
  return (
    <svg viewBox="0 0 320 320" className="w-full max-w-[13rem] sm:max-w-[18rem] md:max-w-[22rem]" aria-hidden="true">
      {rings.map((ring, index) => (
        <circle
          key={ring.r}
          cx="160"
          cy={ring.cy}
          r={ring.r}
          fill={index === rings.length - 1 ? "var(--foreground)" : "none"}
          stroke="var(--sage-text)"
          strokeWidth={index === 0 ? 3 : 1.5}
          strokeOpacity={1 - index * 0.12}
        />
      ))}
      <circle cx="160" cy="236" r="9" fill="var(--highlight)" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <AuthTopBar />

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="grid items-center gap-10 py-14 sm:py-20 md:grid-cols-[1.2fr_1fr]">
          <div>
            <h1 className="text-5xl leading-[1.02] font-semibold tracking-tight sm:text-6xl lg:text-7xl">
              Make the unknown operational.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Design AI agents, connect them to the tools you already use, and let specialists
              share the work, while every sensitive action waits for your approval.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" className="min-h-11 px-6" asChild>
                <Link href="/auth/signup">Get started</Link>
              </Button>
              <Button size="lg" variant="outline" className="min-h-11 px-6" asChild>
                <Link href="/auth/login">Sign in</Link>
              </Button>
            </div>
          </div>
          <div className="flex justify-center md:justify-end">
            <DescentArt />
          </div>
        </section>

        <section aria-labelledby="capabilities" className="border-t border-border py-14">
          <h2 id="capabilities" className="sr-only">
            What Abyss does
          </h2>
          <div className="grid gap-10 md:grid-cols-3">
            {CAPABILITIES.map(({ title, body }) => (
              <div key={title}>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-2 leading-7 text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="how-it-works" className="border-t border-border py-14">
          <h2 id="how-it-works" className="text-2xl font-semibold tracking-tight">
            How a request runs
          </h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ title, body }, index) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>Abyss</span>
          <Link href="/auth/signup" className="text-sage-text hover:text-foreground">
            Create your first agent
          </Link>
        </div>
      </footer>
    </div>
  );
}
