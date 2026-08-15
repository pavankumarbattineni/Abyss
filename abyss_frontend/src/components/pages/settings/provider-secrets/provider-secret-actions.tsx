"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ActionMenu, ConfirmDialog } from "@/components/shared";
import { modelService } from "@/services";
import type { LlmCredential } from "@/types";

interface ProviderSecretActionsProps {
  providerId: string;
  providerName: string;
}

export function ProviderSecretActions({ providerId, providerName }: ProviderSecretActionsProps) {
  const [removeOpen, setRemoveOpen] = useState<boolean>(false);
  const queryClient = useQueryClient();

  const { mutate: removeCredential, isPending: isRemoving } = useMutation({
    mutationFn: () => modelService.removeCredential(providerId),
    onSuccess: (response) => {
      queryClient.setQueryData<LlmCredential[]>(["llm-credentials"], (prev) =>
        prev?.filter((item) => item.provider_id !== providerId),
      );
      toast.success(response.message);
      setRemoveOpen(false);
    },
    onError: () => {
      toast.error("Failed to remove credential. Please try again.");
    },
  });

  return (
    <>
      <ActionMenu
        items={[
          {
            label: "Remove",
            icon: Trash2,
            variant: "destructive",
            onClick: () => setRemoveOpen(true),
          },
        ]}
      />
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove credential"
        description={`Remove the saved API key for ${providerName}? Agents using this provider will stop working until a new key is added.`}
        confirmLabel="Remove"
        variant="destructive"
        loading={isRemoving}
        onConfirm={() => removeCredential()}
      />
    </>
  );
}
