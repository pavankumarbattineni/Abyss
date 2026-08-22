import { Blocks, MessagesSquare, Plug, ShieldCheck, Workflow } from "lucide-react";

const FEATURES = [
  {
    icon: Blocks,
    title: "Visual agent builder",
    description: "Configure agents, tools, and instructions — no code required.",
  },
  {
    icon: Workflow,
    title: "Multi-agent orchestration",
    description: "Compose sub-agents and tools into a single working system.",
  },
  {
    icon: Plug,
    title: "Real tool integrations",
    description: "Connect Gmail, Slack, GitHub, Stripe, and custom MCP servers.",
  },
  {
    icon: MessagesSquare,
    title: "Live streaming responses",
    description: "Watch agents think and respond in real time, token by token.",
  },
  {
    icon: ShieldCheck,
    title: "Human-in-the-loop approvals",
    description: "Review and approve sensitive actions before they run.",
  },
];

export function AuthSidePanel() {
  return (
    <div className="relative z-10 hidden lg:flex lg:w-[54%] lg:flex-col lg:justify-center lg:p-20">
      <div className="flex max-w-2xl flex-col gap-10">
        <div className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium tracking-[0.18em] text-primary uppercase">
            Abyss-AI / Intelligence without limits
          </span>
          <h1 className="text-5xl leading-[1.08] font-semibold tracking-tight text-foreground xl:text-6xl">
            Go deeper.
            <br />
            <span className="bg-linear-to-r from-primary via-primary to-warning bg-clip-text italic text-transparent">
              Build intelligence.
            </span>
          </h1>
          <p className="max-w-lg text-base leading-7 text-muted-foreground">
            A visual command center for autonomous agents, real-world tools, and
            decisions that move at the speed of thought.
          </p>
        </div>

        <div className="grid max-w-xl grid-cols-2 gap-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="group flex items-start gap-3 rounded-xl border border-border-soft bg-surface/70 p-3 transition-colors hover:border-primary/40 hover:bg-surface-raised">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-4 text-primary" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {feature.title}
                  </span>
                  <span className="text-xs leading-5 text-muted-foreground">
                    {feature.description}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
