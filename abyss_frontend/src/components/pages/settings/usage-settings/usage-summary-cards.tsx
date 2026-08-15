import { Card, Skeleton } from "@/components/ui";
import type { UsageSummary } from "@/types";

interface UsageSummaryCardsProps {
  summary?: UsageSummary;
  isLoading: boolean;
}

const STATS: {
  key: keyof UsageSummary;
  label: string;
  format: (value: number) => string;
}[] = [
  { key: "total_spent_usd", label: "Total spend", format: (value) => `$${value.toFixed(4)}` },
  { key: "total_runs", label: "Total runs", format: (value) => value.toLocaleString() },
  { key: "total_threads", label: "Total threads", format: (value) => value.toLocaleString() },
  { key: "total_agents", label: "Total agents", format: (value) => value.toLocaleString() },
];

export function UsageSummaryCards({ summary, isLoading }: UsageSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {STATS.map((stat) => (
        <Card key={stat.key} className="p-4">
          <p className="text-xs text-muted-foreground">{stat.label}</p>
          {isLoading ? (
            <Skeleton className="mt-1.5 h-6 w-16" />
          ) : (
            <p className="mt-1 text-xl font-semibold text-foreground">
              {summary ? stat.format(summary[stat.key]) : "—"}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
