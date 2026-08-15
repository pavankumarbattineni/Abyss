"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";

import { PageHeader } from "@/components/shared";
import { Card, DataTable } from "@/components/ui";
import { apiKeyService } from "@/services";
import type { ApiKey } from "@/types";
import { ApiKeyActions } from "./api-key-actions";
import { GenerateApiKeyDialog } from "./generate-api-key-dialog";

const columns: ColumnDef<ApiKey>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ getValue }) => (
      <span className="font-medium text-foreground">{getValue<string>()}</span>
    ),
  },
  {
    accessorKey: "key_prefix",
    header: "Key",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {getValue<string>()}…
      </span>
    ),
  },
  {
    accessorKey: "is_active",
    header: "Status",
    cell: ({ getValue }) =>
      getValue<boolean>() ? (
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
          Active
        </span>
      ) : (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Inactive
        </span>
      ),
  },
  {
    accessorKey: "is_expired",
    header: "Expiry",
    cell: ({ getValue }) =>
      getValue<boolean>() ? (
        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          Expired
        </span>
      ) : (
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
          Valid
        </span>
      ),
  },
  {
    accessorKey: "expires_at",
    header: "Expires",
    cell: ({ getValue }) => {
      const value = getValue<string | null>();
      return (
        <span className="text-xs text-muted-foreground">
          {value ? format(new Date(value), "MMM d, yyyy h:mm a") : "Never"}
        </span>
      );
    },
  },
  {
    accessorKey: "created_at",
    header: "Created",
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">
        {format(new Date(getValue<string>()), "MMM d, yyyy")}
      </span>
    ),
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row }) => <ApiKeyActions apiKey={row.original} />,
  },
];

export const ApiKeysSettingsPage = () => {
  const queryClient = useQueryClient();

  const {
    data: apiKeys = [],
    isLoading,
    isError,
  } = useQuery<ApiKey[]>({
    queryKey: ["api-keys"],
    queryFn: () => apiKeyService.getApiKeys(),
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="API Keys"
        description="Generate keys to access the ThinkLoop platform API programmatically."
        actions={
          <GenerateApiKeyDialog
            onCreated={() => queryClient.invalidateQueries({ queryKey: ["api-keys"] })}
          />
        }
      />

      <Card className="overflow-hidden p-0">
        <DataTable
          columns={columns}
          data={apiKeys}
          isLoading={isLoading}
          emptyMessage={isError ? "Failed to load API keys." : "No API keys yet."}
        />
      </Card>
    </div>
  );
};
