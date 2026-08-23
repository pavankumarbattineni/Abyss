import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { AuthTopBar } from "@/components/layout";
import { Button } from "@/components/ui";
import { AgentNetwork } from "@/components/pages/home/home-interactions";

export const metadata: Metadata = { title: "Abyss-AI", description: "A command center for autonomous AI systems." };

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="bg-grid-pattern pointer-events-none absolute inset-0 opacity-70" /><div className="pointer-events-none absolute left-[42%] top-[18%] size-[32rem] rounded-full bg-primary/10 blur-[9rem]" /><AuthTopBar />
      <section className="relative z-10 mx-auto flex min-h-[min(48rem,100vh)] max-w-7xl items-center px-6 pb-12 pt-20 sm:px-10 lg:px-16"><div className="grid w-full items-center gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
        <div className="max-w-2xl"><div className="mb-6 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[11px] tracking-[0.18em] text-primary uppercase">Abyss / Autonomous Intelligence</div><h1 className="text-5xl font-semibold leading-[0.98] tracking-tight text-foreground sm:text-7xl"><span className="block">Make the</span><span className="block">unknown</span><span className="block bg-linear-to-r from-primary via-primary to-[#82b992] bg-clip-text italic text-transparent">operational.</span></h1><p className="mt-6 max-w-xl text-base leading-7 text-body sm:text-lg">Design intelligent agents. Connect real-world tools.<br className="hidden sm:block" /> Delegate across specialists. Keep humans in control.</p><div className="mt-8 flex flex-wrap items-center gap-3"><Button size="lg" className="min-h-11 px-5" asChild><Link href="/auth/signup">Enter the Abyss <ArrowUpRight className="size-4" /></Link></Button></div><div className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase"><span>Build</span><i>·</i><span>Connect</span><i>·</i><span>Orchestrate</span><i>·</i><span>Govern</span><i>·</i><span>Automate</span></div></div>
        <div className="relative flex min-h-[24rem] items-center justify-center sm:min-h-[30rem]"><AgentNetwork /></div>
      </div></section>
      <style>{`
        .home-graph{overflow:visible;--home-c-main:color-mix(in srgb,var(--accent) 45%,#7c6fe0 55%);--home-c-tools:var(--warn);--home-c-research:color-mix(in srgb,var(--error) 65%,var(--warn) 10%);--home-c-analysis:color-mix(in srgb,var(--accent) 22%,#5b8fe0 78%);--home-c-data:color-mix(in srgb,var(--success) 65%,var(--accent) 15%);--home-c-synth:color-mix(in srgb,#22d3ee 35%,var(--accent))}
        .home-edge{stroke:currentColor;stroke-width:1.3;stroke-linecap:round;fill:none;stroke-dasharray:2.5 6;opacity:.5;transition:opacity .35s ease,stroke .35s ease,filter .35s ease,stroke-width .35s ease}
        .home-edge-main{color:color-mix(in srgb,var(--home-c-main) 38%,var(--border2))}
        .home-edge-research{color:color-mix(in srgb,var(--home-c-research) 42%,var(--border2))}
        .home-edge-analysis{color:color-mix(in srgb,var(--home-c-analysis) 42%,var(--border2))}
        .home-edge-data{color:color-mix(in srgb,var(--home-c-data) 42%,var(--border2))}
        .home-edge-synth{color:color-mix(in srgb,var(--home-c-synth) 42%,var(--border2))}
        .home-edge.is-active{opacity:1;stroke-width:1.9;stroke-dasharray:7 6;animation:home-edge-flow 1.3s linear infinite}
        .home-edge-main.is-active{color:var(--home-c-main);filter:drop-shadow(0 0 4px color-mix(in srgb,var(--home-c-main) 55%,transparent))}
        .home-edge-research.is-active{color:var(--home-c-research);filter:drop-shadow(0 0 4px color-mix(in srgb,var(--home-c-research) 55%,transparent))}
        .home-edge-analysis.is-active{color:var(--home-c-analysis);filter:drop-shadow(0 0 4px color-mix(in srgb,var(--home-c-analysis) 55%,transparent))}
        .home-edge-data.is-active{color:var(--home-c-data);filter:drop-shadow(0 0 4px color-mix(in srgb,var(--home-c-data) 55%,transparent))}
        .home-edge-synth.is-active{color:var(--home-c-synth);filter:drop-shadow(0 0 4px color-mix(in srgb,var(--home-c-synth) 55%,transparent))}

        .home-particle{filter:drop-shadow(0 0 3px currentColor)}
        .home-particle-main{fill:var(--home-c-main);color:var(--home-c-main)}
        .home-particle-research{fill:var(--home-c-research);color:var(--home-c-research)}
        .home-particle-analysis{fill:var(--home-c-analysis);color:var(--home-c-analysis)}
        .home-particle-data{fill:var(--home-c-data);color:var(--home-c-data)}
        .home-particle-synth{fill:var(--home-c-synth);color:var(--home-c-synth)}

        .home-graph-node{position:absolute;z-index:2;display:flex;min-width:6.6rem;transform:translate(-50%,-50%);align-items:center;gap:.4rem;border:1px solid var(--border2);border-radius:.6rem;background:color-mix(in srgb,var(--bg1) 94%,transparent);padding:.4rem .5rem;color:var(--body);box-shadow:0 8px 18px rgba(0,0,0,.14);cursor:grab;touch-action:none;user-select:none;transition:border-color .35s ease,box-shadow .35s ease,opacity .35s ease,min-height .3s ease}
        .home-graph-node:active{cursor:grabbing}
        .home-graph-node-icon{width:.8rem;height:.8rem;flex:none;color:var(--muted-text)}
        .home-graph-node strong,.home-graph-node span,.home-graph-node small{display:block}
        .home-graph-node strong{font-size:.6rem;font-weight:500;color:var(--head);white-space:nowrap}
        .home-graph-node span{margin-top:.06rem;font-family:var(--font-mono);font-size:.46rem;color:var(--muted-text);white-space:nowrap}
        .home-graph-node small{margin-top:.16rem;font-size:.44rem;color:var(--muted-text)}
        .home-graph-node small i{display:inline-block;width:.26rem;height:.26rem;border-radius:999px;background:currentColor}

        .home-pill{min-width:5.4rem;justify-content:center;border-radius:999px;background:color-mix(in srgb,var(--bg2) 92%,transparent)}
        .home-pill strong{font-size:.5rem;letter-spacing:.04em;font-family:var(--font-mono)}
        .home-pill.is-active{border-color:var(--border2);box-shadow:0 0 14px color-mix(in srgb,var(--head) 12%,transparent)}
        .home-pill.is-success{border-color:var(--success);box-shadow:0 0 18px color-mix(in srgb,var(--success) 30%,transparent)}
        .home-pill.is-success .home-graph-node-icon{color:var(--success)}

        .home-main-agent{min-width:8.6rem;border-color:color-mix(in srgb,var(--home-c-main) 42%,var(--border2));background:color-mix(in srgb,var(--bg2) 94%,transparent)}
        .home-main-agent .home-graph-node-icon{color:color-mix(in srgb,var(--home-c-main) 55%,var(--muted-text))}
        .home-main-agent small i{animation:home-dot-breathe 2.6s ease-in-out infinite}
        .home-main-agent.is-active{border-color:var(--home-c-main);box-shadow:0 0 26px color-mix(in srgb,var(--home-c-main) 28%,transparent)}
        .home-main-agent.is-active .home-graph-node-icon{color:var(--home-c-main)}

        .home-research{border-color:color-mix(in srgb,var(--home-c-research) 40%,var(--border2))}
        .home-research .home-graph-node-icon{color:color-mix(in srgb,var(--home-c-research) 55%,var(--muted-text))}
        .home-research.is-active{border-color:var(--home-c-research);box-shadow:0 0 16px color-mix(in srgb,var(--home-c-research) 28%,transparent)}
        .home-research.is-active .home-graph-node-icon{color:var(--home-c-research)}

        .home-analysis{border-color:color-mix(in srgb,var(--home-c-analysis) 40%,var(--border2))}
        .home-analysis .home-graph-node-icon{color:color-mix(in srgb,var(--home-c-analysis) 55%,var(--muted-text))}
        .home-analysis.is-active{border-color:var(--home-c-analysis);box-shadow:0 0 16px color-mix(in srgb,var(--home-c-analysis) 28%,transparent)}
        .home-analysis.is-active .home-graph-node-icon{color:var(--home-c-analysis)}

        .home-data-agent{border-color:color-mix(in srgb,var(--home-c-data) 40%,var(--border2))}
        .home-data-agent .home-graph-node-icon{color:color-mix(in srgb,var(--home-c-data) 55%,var(--muted-text))}
        .home-data-agent.is-active{border-color:var(--home-c-data);box-shadow:0 0 16px color-mix(in srgb,var(--home-c-data) 28%,transparent)}
        .home-data-agent.is-active .home-graph-node-icon{color:var(--home-c-data)}

        .home-synthesizer{min-width:7.8rem;border-color:color-mix(in srgb,var(--home-c-synth) 45%,var(--border2))}
        .home-synthesizer .home-graph-node-icon{color:color-mix(in srgb,var(--home-c-synth) 55%,var(--muted-text))}
        .home-synthesizer.is-active{border-color:var(--home-c-synth);box-shadow:0 0 22px color-mix(in srgb,var(--home-c-synth) 26%,transparent)}
        .home-synthesizer.is-active .home-graph-node-icon{color:var(--home-c-synth)}

        .home-sub-agent{min-height:2.9rem}
        .home-mini-graph{display:flex;align-items:center;gap:.16rem}
        .home-mini-node{width:.3rem;height:.3rem;border-radius:999px;background:var(--home-c-main);flex:none}
        .home-mini-node.home-mini-tool{background:var(--home-c-tools);border-radius:.08rem}
        .home-mini-edge{width:.5rem;height:1px;background:color-mix(in srgb,var(--home-c-main) 60%,transparent)}
        .home-sub-agent.is-working{border-color:color-mix(in srgb,var(--home-c-tools) 45%,var(--home-c-main) 35%)}

        .home-graph-caption{position:absolute;font-family:var(--font-mono);font-size:.48rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted-text);opacity:.4;transition:opacity .35s ease,color .35s ease;pointer-events:none}
        .home-graph-caption-direct{left:8%;top:34%}
        .home-graph-caption-delegate{left:66%;top:60%}
        .home-graph-caption.is-active{opacity:1;color:var(--home-c-main)}

        @keyframes home-edge-flow{to{stroke-dashoffset:-26}}
        @keyframes home-dot-breathe{0%,100%{opacity:.5}50%{opacity:1}}

        @media(max-width:639px){
          .home-graph{max-width:19rem}
          .home-graph-node{min-width:5.6rem;padding:.32rem .4rem}
          .home-main-agent{min-width:7rem}
          .home-graph-caption{display:none}
        }
        @media(prefers-reduced-motion:reduce){
          .home-edge.is-active{animation:none}
          .home-particle{display:none}
          .home-main-agent small i{animation:none}
        }
      `}</style>
    </main>
  );
}
