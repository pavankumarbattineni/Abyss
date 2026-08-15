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
    <div className="relative z-10 hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-center lg:p-20">
      <div className="flex max-w-xl flex-col gap-10">
        <div className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center rounded-full border border-border-soft bg-surface-raised px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            No-code AI agent platform
          </span>
          <h1 className="text-5xl leading-tight font-semibold text-foreground">
            Build and ship <span className="italic text-primary">AI agents</span>.
            <br />
            No code required.
          </h1>
          <p className="text-base text-muted-foreground">
            ThinkLoop lets your team design agents, attach real tools, and
            orchestrate multi-agent workflows — all from a visual canvas.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-soft bg-surface-raised">
                  <Icon className="size-4.5 text-primary" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-base font-medium text-foreground">
                    {feature.title}
                  </span>
                  <span className="text-sm text-muted-foreground">
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
