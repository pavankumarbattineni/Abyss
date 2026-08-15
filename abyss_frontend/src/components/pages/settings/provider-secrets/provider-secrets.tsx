"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";

import { PageHeader } from "@/components/shared";
import { Card, DataTable } from "@/components/ui";
import { modelService } from "@/services";
import type { LlmCredential } from "@/types";
import { AddCredentialDialog } from "./add-credential-dialog";
import { ProviderSecretActions } from "./provider-secret-actions";

const columns: ColumnDef<LlmCredential>[] = [
  {
    accessorKey: "display_name",
    header: "Provider",
    cell: ({ getValue }) => (
      <span className="font-medium text-foreground">{getValue<string>()}</span>
    ),
  },
  {
    accessorKey: "masked_key",
    header: "Key",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs text-muted-foreground">{getValue<string>()}</span>
    ),
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
    accessorKey: "updated_at",
    header: "Updated",
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">
        {format(new Date(getValue<string>()), "MMM d, yyyy")}
      </span>
    ),
  },
  {
    id: "actions",
    header: "Actions",
    cell: ({ row }) => (
      <ProviderSecretActions
        providerId={row.original.provider_id}
        providerName={row.original.display_name}
      />
    ),
  },
];

export const ProviderSecretsSettingsPage = () => {
  const {
    data: credentials = [],
    isLoading,
    isError,
  } = useQuery<LlmCredential[]>({
    queryKey: ["llm-credentials"],
    queryFn: () => modelService.getCredentials(),
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Provider Secrets"
        description="Connect your own LLM provider API keys."
        actions={<AddCredentialDialog />}
      />

      <Card className="overflow-hidden p-0">
        <DataTable
          columns={columns}
          data={credentials}
          isLoading={isLoading}
          emptyMessage={isError ? "Failed to load credentials." : "No credentials added yet."}
        />
      </Card>
    </div>
  );
};
