"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";

import {
  Button,
  Checkbox,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@/components/ui";
import { agentService } from "@/services";
import type { Tool } from "@/types";

interface ToolboxToolsPopoverProps {
  trigger: React.ReactNode;
  selectedIds: Set<string>;
  onToggleTool: (tool: Tool) => void;
}

export function ToolboxToolsPopover({
  trigger,
  selectedIds,
  onToggleTool,
}: ToolboxToolsPopoverProps) {
  const { data: tools = [], isLoading } = useQuery<Tool[]>({
    queryKey: ["agent-tools"],
    queryFn: () => agentService.getTools(),
  });
  const [search, setSearch] = useState<string>("");
  const [open, setOpen] = useState<boolean>(false);
  const uid = useId();

  const filtered = tools.filter((tool) =>
    tool.display_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2 p-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs font-medium text-muted-foreground">Add tools</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <X className="size-3.5" />
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tools..."
            className="h-8 pl-8 text-sm"
          />
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-1.5 p-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : filtered.length > 0 ? (
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {filtered.map((tool) => (
              <Label
                key={tool.id}
                htmlFor={`${uid}-tool-${tool.id}`}
                className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-muted"
              >
                <Checkbox
                  id={`${uid}-tool-${tool.id}`}
                  checked={selectedIds.has(tool.id)}
                  onCheckedChange={() => onToggleTool(tool)}
                  className="mt-0.5"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-foreground">
                      {tool.display_name}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {tool.connection_name}
                    </span>
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {tool.description.split("\n")[0]}
                  </span>
                </span>
              </Label>
            ))}
          </div>
        ) : (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            {tools.length === 0
              ? "No tools available yet."
              : "No tools match your search."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
