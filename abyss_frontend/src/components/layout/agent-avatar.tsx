import { cn } from "@/lib/utils";

interface AgentAvatarProps {
  name: string;
  className?: string;
}

function getInitials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "NA"
  );
}

export function AgentAvatar({ name, className }: AgentAvatarProps) {
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground",
        className,
      )}
    >
      {getInitials(name)}
    </div>
  );
}
