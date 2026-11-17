"use client";

import { Brain, Hand, Pencil, Search, ShieldCheck, Sparkles, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button, Card, Heading, Input, Switch } from "@/components/ui";

/**
 * Settings → Memory. A static preview of the Personal Memory System
 * (docs/design/personal-memory.md): nothing here reads or writes data yet.
 * The example entries below are illustrations, not the user's memories.
 */

const MEMORY_CAP = 30;

const HOW_IT_WORKS = [
  {
    icon: Hand,
    title: "Remembers when you ask",
    text: "Say “remember that…” in any chat and every agent can use it in future conversations.",
  },
  {
    icon: Sparkles,
    title: "Learns from your chats",
    text: "Lasting preferences and facts you share are picked up from your own messages — never from tool results.",
  },
  {
    icon: ShieldCheck,
    title: "You stay in control",
    text: "Review, edit or delete anything, pause memory, or chat without it.",
  },
];

const EXAMPLES = [
  { category: "Preferences", content: "Prefers concise answers with code examples.", source: "You asked" },
  { category: "Preferences", content: "Wants dates written as DD MMM YYYY.", source: "Learned from a chat" },
  { category: "Work", content: "Works as a backend and AI engineer.", source: "Learned from a chat" },
  { category: "Projects", content: "Builds Trench, a RAG knowledge assistant.", source: "You asked" },
];

function ComingSoonBadge() {
  return (
    <span className="rounded-full bg-highlight-soft px-2 py-0.5 text-xs font-medium whitespace-nowrap text-highlight">
      Coming soon
    </span>
  );
}

function SettingRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <Heading as="h3" size="sm">
          {title}
        </Heading>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch checked={false} disabled aria-label={title} />
    </div>
  );
}

export const MemorySettingsPage = () => {
  const categories = [...new Set(EXAMPLES.map((example) => example.category))];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Memory"
        description="What your agents remember about you across conversations."
        actions={<ComingSoonBadge />}
      />

      <Card className="flex flex-row items-start gap-3 border-highlight/30 bg-highlight-soft p-4">
        <Brain className="mt-0.5 size-5 shrink-0 text-highlight" />
        <p className="text-sm">
          Personal memory isn&apos;t switched on yet — nothing from your chats is being saved. This page previews
          how you&apos;ll manage it.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {HOW_IT_WORKS.map(({ icon: Icon, title, text }) => (
          <Card key={title} className="flex flex-col gap-2 p-4">
            <Icon className="size-5 text-sage-text" />
            <Heading as="h2" size="sm">
              {title}
            </Heading>
            <p className="text-sm text-muted-foreground">{text}</p>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <SettingRow title="Use memory" description="Let your agents use what they remember about you." />
        <div className="h-px bg-border-soft" />
        <SettingRow
          title="Learn from my chats"
          description="Pick up lasting preferences and facts from your messages automatically."
        />
        <div className="h-px bg-border-soft" />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Memory used</span>
            <span className="text-muted-foreground">
              0 / {MEMORY_CAP}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className="h-full w-0 rounded-full bg-primary" />
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Heading as="h2" size="sm">
              Saved memories
            </Heading>
            <p className="text-sm text-muted-foreground">
              Examples of how entries will look. Each one can be edited or deleted.
            </p>
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input disabled placeholder="Search memories" className="pl-8" aria-label="Search memories" />
          </div>
        </div>

        {categories.map((category) => (
          <div key={category} className="flex flex-col gap-2">
            <Heading as="h3" size="xs">
              {category}
            </Heading>
            <ul className="flex flex-col divide-y divide-border-soft rounded-lg border border-border-soft">
              {EXAMPLES.filter((example) => example.category === category).map((example) => (
                <li key={example.content} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm">{example.content}</span>
                    <span className="text-xs text-muted-foreground">
                      Example · {example.source}
                    </span>
                  </div>
                  <Button type="button" variant="ghost" size="icon-xs" disabled aria-label="Edit memory">
                    <Pencil />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" disabled aria-label="Delete memory">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-3 border-destructive/30 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Heading as="h2" size="sm">
            Forget everything
          </Heading>
          <p className="text-sm text-muted-foreground">
            Permanently delete all memories. Your past conversations stay as they are.
          </p>
        </div>
        <Button type="button" variant="destructive" disabled>
          Forget everything
        </Button>
      </Card>
    </div>
  );
};
