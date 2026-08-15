"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, RotateCcw } from "lucide-react";

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { agentService } from "@/services";
import type { Agent, UsageRunStatus } from "@/types";

export interface UsageFiltersValue {
  agentId: string | undefined;
  status: UsageRunStatus | undefined;
  provider: string;
  model: string;
  startDate: string;
  endDate: string;
}

export const DEFAULT_USAGE_FILTERS: UsageFiltersValue = {
  agentId: undefined,
  status: undefined,
  provider: "",
  model: "",
  startDate: "",
  endDate: "",
};

const STATUS_OPTIONS: UsageRunStatus[] = ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"];

const ALL_VALUE = "all";

interface UsageFiltersProps {
  value: UsageFiltersValue;
  onChange: (value: UsageFiltersValue) => void;
  onDownload: () => void;
  isDownloading: boolean;
}

export function UsageFilters({ value, onChange, onDownload, isDownloading }: UsageFiltersProps) {
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["agents"],
    queryFn: () => agentService.getAgents(),
  });

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border-soft p-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Agent</label>
        <Select
          value={value.agentId ?? ALL_VALUE}
          onValueChange={(next) =>
            onChange({ ...value, agentId: next === ALL_VALUE ? undefined : next })
          }
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="All agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All agents</SelectItem>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Status</label>
        <Select
          value={value.status ?? ALL_VALUE}
          onValueChange={(next) =>
            onChange({
              ...value,
              status: next === ALL_VALUE ? undefined : (next as UsageRunStatus),
            })
          }
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Provider</label>
        <Input
          value={value.provider}
          onChange={(event) => onChange({ ...value, provider: event.target.value })}
          placeholder="e.g. openai"
          className="h-8 w-32 text-xs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Model</label>
        <Input
          value={value.model}
          onChange={(event) => onChange({ ...value, model: event.target.value })}
          placeholder="e.g. gpt-5-mini"
          className="h-8 w-36 text-xs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">From</label>
        <Input
          type="date"
          value={value.startDate}
          onChange={(event) => onChange({ ...value, startDate: event.target.value })}
          className="h-8 w-36 text-xs"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">To</label>
        <Input
          type="date"
          value={value.endDate}
          onChange={(event) => onChange({ ...value, endDate: event.target.value })}
          className="h-8 w-36 text-xs"
        />
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={() => onChange(DEFAULT_USAGE_FILTERS)}
      >
        <RotateCcw className="size-3.5" />
        Reset
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={isDownloading}
        onClick={onDownload}
      >
        <Download className="size-3.5" />
        Download
      </Button>
    </div>
  );
}
