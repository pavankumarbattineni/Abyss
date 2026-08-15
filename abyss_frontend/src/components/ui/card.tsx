import * as React from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-xl border shadow-xs bg-linear-to-br",
        "from-white to-gray-50 border-white/70",
        "dark:from-card dark:to-surface-raised dark:border-border",
        className,
      )}
      {...props}
    />
  );
}

export { Card };
