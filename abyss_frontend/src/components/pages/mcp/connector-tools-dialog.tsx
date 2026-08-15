"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Hand } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { mcpService } from "@/services";
import type { McpConnection, Tool, ToolPermission } from "@/types";

const PERMISSION_OPTIONS: {
  value: ToolPermission;
  label: string;
  icon: React.ElementType;
  activeClassName: string;
}[] = [
  {
    value: "allowed",
    label: "Always allow",
    icon: Check,
    activeClassName: "bg-success/10 text-success",
  },
  {
    value: "requires_approval",
    label: "Needs approval",
    icon: Hand,
    activeClassName: "bg-warning/10 text-warning",
  },
  {
    value: "blocked",
    label: "Deny",
    icon: Ban,
    activeClassName: "bg-destructive/10 text-destructive",
  },
];

interface ConnectorToolsDialogProps {
  connection: McpConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectorToolsDialog({
  connection,
  open,
  onOpenChange,
}: ConnectorToolsDialogProps) {
  const [disconnectOpen, setDisconnectOpen] = useState<boolean>(false);
  const [bulkPermission, setBulkPermission] = useState<string>("");
  const queryClient = useQueryClient();

  const { data: tools = [], isLoading } = useQuery<Tool[]>({
    queryKey: ["mcp-connection-tools", connection.id],
    queryFn: () => mcpService.getConnectionTools(connection.id),
    enabled: open,
  });

  const { mutate: disconnect, isPending: isDisconnecting } = useMutation({
    mutationFn: () => mcpService.deleteConnection(connection.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      toast.success("Server disconnected");
      setDisconnectOpen(false);
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to disconnect server. Please try again.");
    },
  });

  const {
    mutate: updatePermission,
    variables: pendingUpdate,
    isPending: isUpdatingPermission,
  } = useMutation({
    mutationFn: ({
      toolId,
      permission,
    }: {
      toolId: string;
      permission: ToolPermission;
    }) => mcpService.updateToolPermission(toolId, permission),
    onSuccess: (updatedTools) => {
      queryClient.setQueryData<Tool[]>(
        ["mcp-connection-tools", connection.id],
        (prev) =>
          prev?.map(
            (item) => updatedTools.find((updated) => updated.id === item.id) ?? item,
          ),
      );
    },
    onError: () => {
      toast.error("Failed to update tool permission. Please try again.");
    },
  });

  const { mutate: updateAllPermissions, isPending: isUpdatingAllPermissions } = useMutation({
    mutationFn: (permission: ToolPermission) =>
      mcpService.updateConnectionToolsPermission(connection.id, permission),
    onSuccess: (updatedTools) => {
      queryClient.setQueryData<Tool[]>(["mcp-connection-tools", connection.id], updatedTools);
      toast.success("Updated permission for all tools");
      setBulkPermission("");
    },
    onError: () => {
      toast.error("Failed to update tool permissions. Please try again.");
      setBulkPermission("");
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{connection.name}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">
              {connection.url}
            </DialogDescription>
          </DialogHeader>

          <p className="rounded-lg border border-border-soft bg-muted/40 p-3 text-xs text-muted-foreground">
            Choose how each tool can be used by your agents.{" "}
            <strong className="text-foreground">Always allow</strong> lets an
            agent run it without confirmation.{" "}
            <strong className="text-foreground">Needs approval</strong> pauses
            for your review every time it&apos;s used.{" "}
            <strong className="text-foreground">Deny</strong> blocks the tool
            entirely.
          </p>

          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Tools</p>
            <Select
              value={bulkPermission}
              onValueChange={(value) => {
                setBulkPermission(value);
                updateAllPermissions(value as ToolPermission);
              }}
            >
              <SelectTrigger
                className="h-8 w-44 text-xs"
                disabled={isUpdatingAllPermissions || tools.length === 0}
              >
                <SelectValue placeholder="Set all tools..." />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
            {isLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : tools.length > 0 ? (
              tools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-soft p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {tool.display_name}
                    </p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {tool.description}
                    </p>
                  </div>
                  <div className="inline-flex shrink-0 rounded-lg border border-border p-0.5">
                    {PERMISSION_OPTIONS.map((option) => {
                      const isPendingForThisTool =
                        (isUpdatingPermission && pendingUpdate?.toolId === tool.id) ||
                        isUpdatingAllPermissions;
                      const Icon = option.icon;
                      return (
                        <Tooltip key={option.value}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={isPendingForThisTool}
                              onClick={() =>
                                updatePermission({
                                  toolId: tool.id,
                                  permission: option.value,
                                })
                              }
                              aria-label={option.label}
                              className={cn(
                                "rounded-md p-1.5 text-muted-foreground transition-colors disabled:opacity-50",
                                tool.permission_state === option.value &&
                                  option.activeClassName,
                              )}
                            >
                              <Icon className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{option.label}</TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <p className="px-1 py-1.5 text-sm text-muted-foreground">
                No tools available for this connector.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border-soft pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled
              onClick={() => setDisconnectOpen(true)}
            >
              Disconnect
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect MCP server"
        description={`Disconnect "${connection.name}"? Agents using its tools will lose access.`}
        confirmLabel="Disconnect"
        variant="destructive"
        loading={isDisconnecting}
        onConfirm={() => disconnect()}
      />
    </>
  );
}
