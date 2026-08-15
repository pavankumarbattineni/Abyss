"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ActionMenu, ConfirmDialog } from "@/components/shared";
import { apiKeyService } from "@/services";
import type { ApiKey } from "@/types";
import { RenameApiKeyDialog } from "./rename-api-key-dialog";

interface ApiKeyActionsProps {
  apiKey: ApiKey;
}

export function ApiKeyActions({ apiKey }: ApiKeyActionsProps) {
  const [renameOpen, setRenameOpen] = useState<boolean>(false);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const queryClient = useQueryClient();

  const { mutate: deleteApiKey, isPending: isDeleting } = useMutation({
    mutationFn: () => apiKeyService.deleteApiKey(apiKey.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key deleted");
      setDeleteOpen(false);
    },
    onError: () => {
      toast.error("Failed to delete API key. Please try again.");
    },
  });

  return (
    <>
      <ActionMenu
        items={[
          { label: "Rename", icon: Pencil, onClick: () => setRenameOpen(true) },
          {
            label: "Delete",
            icon: Trash2,
            variant: "destructive",
            onClick: () => setDeleteOpen(true),
          },
        ]}
      />
      <RenameApiKeyDialog apiKey={apiKey} open={renameOpen} onOpenChange={setRenameOpen} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete API key"
        description={`Delete "${apiKey.name}"? Any integration using this key will stop working immediately.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => deleteApiKey()}
      />
    </>
  );
}
