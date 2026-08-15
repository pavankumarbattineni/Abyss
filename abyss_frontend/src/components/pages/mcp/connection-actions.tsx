"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plug, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ActionMenu, ConfirmDialog } from "@/components/shared";
import { mcpService } from "@/services";
import type { McpConnection } from "@/types";
import { EditServerDialog } from "./edit-server-dialog";

interface ConnectionActionsProps {
  connection: McpConnection;
  onViewTools: (connection: McpConnection) => void;
}

export function ConnectionActions({ connection, onViewTools }: ConnectionActionsProps) {
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const queryClient = useQueryClient();

  const { mutate: deleteConnection, isPending: isDeleting } = useMutation({
    mutationFn: () => mcpService.deleteConnection(connection.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      toast.success("Server deleted");
      setDeleteOpen(false);
    },
    onError: () => {
      toast.error("Failed to delete server. Please try again.");
    },
  });

  const { mutateAsync: refreshConnection, isPending: isRefreshing } =
    useMutation({
      mutationFn: () => mcpService.refreshConnection(connection.id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
        toast.success("Server refreshed");
      },
      onError: () => {
        toast.error("Failed to refresh server. Please try again.");
      },
    });

  const isConnected = connection.status === "connected";
  const { mutateAsync: toggleConnectionStatus, isPending: isTogglingStatus } =
    useMutation({
      mutationFn: () =>
        mcpService.updateConnectionStatus(
          connection.id,
          isConnected ? "disconnected" : "connected",
        ),
      onSuccess: (updated) => {
        queryClient.setQueryData<McpConnection[]>(["mcp-connections"], (prev) =>
          prev?.map((item) => (item.id === updated.id ? updated : item)),
        );
        toast.success(isConnected ? "Server disconnected" : "Server connected");
      },
      onError: () => {
        toast.error(
          `Failed to ${isConnected ? "disconnect" : "connect"} server. Please try again.`,
        );
      },
    });

  return (
    <>
      <div>
        <ActionMenu
          items={[
            { label: "View tools", icon: Eye, onClick: () => onViewTools(connection) },
            {
              label: isRefreshing ? "Refreshing..." : "Refresh",
              icon: RefreshCw,
              onClick: () => refreshConnection().then(
                () => undefined,
                () => undefined,
              ),
              disabled: isRefreshing,
            },
            {
              label: isConnected ? "Disconnect" : "Connect",
              icon: isConnected ? PlugZap : Plug,
              onClick: () => toggleConnectionStatus().then(
                () => undefined,
                () => undefined,
              ),
              disabled: isTogglingStatus,
            },
            { label: "Edit", icon: Pencil, onClick: () => setEditOpen(true) },
            {
              label: "Delete",
              icon: Trash2,
              variant: "destructive",
              onClick: () => setDeleteOpen(true),
            },
          ]}
        />
      </div>
      <EditServerDialog
        connection={connection}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete MCP server"
        description={`Delete "${connection.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => deleteConnection()}
      />
    </>
  );
}
