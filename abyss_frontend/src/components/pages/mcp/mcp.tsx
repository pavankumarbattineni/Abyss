"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";

import { PageHeader } from "@/components/shared";
import { Card, DataTable } from "@/components/ui";
import { mcpService } from "@/services";
import type { McpConnection } from "@/types";
import { AddServerDialog } from "./add-server-dialog";
import { ConnectionActions } from "./connection-actions";
import { ConnectorToolsDialog } from "./connector-tools-dialog";

function buildColumns(onViewTools: (connection: McpConnection) => void): ColumnDef<McpConnection>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: "url",
      header: "URL",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {getValue<string>()}
        </span>
      ),
    },
    {
      accessorKey: "tools_count",
      header: "Tools",
      cell: ({ getValue }) => (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {getValue<number>()} tools
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) =>
        getValue<McpConnection["status"]>() === "connected" ? (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
            Connected
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Disconnected
          </span>
        ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <ConnectionActions connection={row.original} onViewTools={onViewTools} />
        </div>
      ),
    },
  ];
}

export const McpPage = () => {
  const [viewingConnection, setViewingConnection] = useState<McpConnection | null>(null);

  const {
    data: connections = [],
    isLoading,
    isError,
  } = useQuery<McpConnection[]>({
    queryKey: ["mcp-connections"],
    queryFn: () => mcpService.getConnections(),
  });

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="MCP Servers"
        description="Remote MCP servers that can be used by your agents."
        actions={<AddServerDialog />}
      />

      <Card className="overflow-hidden p-0" suppressHydrationWarning>
        {!isLoading && (
          <div className="border-b border-border px-6 py-4 text-sm text-muted-foreground">
            {connections.length} server{connections.length === 1 ? "" : "s"}
          </div>
        )}
        <DataTable
          columns={buildColumns(setViewingConnection)}
          data={connections}
          isLoading={isLoading}
          onRowClick={setViewingConnection}
          emptyMessage={
            isError ? "Failed to load MCP servers." : "No MCP servers connected yet."
          }
        />
      </Card>

      {viewingConnection && (
        <ConnectorToolsDialog
          connection={viewingConnection}
          open={!!viewingConnection}
          onOpenChange={(open) => {
            if (!open) setViewingConnection(null);
          }}
        />
      )}
    </div>
  );
};
