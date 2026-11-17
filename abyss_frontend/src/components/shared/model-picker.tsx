"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { getApiErrorMessage } from "@/lib/utils";
import { useAuth } from "@/providers";
import { authService, modelService } from "@/services";
import type { LlmCredential, ModelCatalogProvider, User } from "@/types";

const DEFAULT_MODEL_ID = "default";

interface PickerModel {
  id: string;
  name: string;
  provider: string;
  /** The user has saved a key for this model's provider. */
  hasKey: boolean;
}

/**
 * The model for all of the user's agents and chats, chosen in the chat box.
 * The choice is saved on the user (PATCH /auth/setting), so every chat --
 * any agent, any thread, the builder's chat -- shows and uses the same model.
 * Default runs on the platform's key; every other model is BYOK and can be
 * picked once its provider's key is saved in Provider Secrets.
 */
export function ModelPicker() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: catalog = [], isLoading: isCatalogLoading } = useQuery<ModelCatalogProvider[]>({
    queryKey: ["model-catalog"],
    queryFn: () => modelService.getCatalog(),
  });
  const { data: credentials = [] } = useQuery<LlmCredential[]>({
    queryKey: ["llm-credentials"],
    queryFn: () => modelService.getCredentials(),
  });

  const withKey = new Set(credentials.map((credential) => credential.provider_id));
  const byok: PickerModel[] = catalog
    .filter((provider) => provider.provider_id !== DEFAULT_MODEL_ID)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        id: model.id,
        name: model.display_name,
        provider: provider.display_name,
        hasKey: withKey.has(provider.provider_id),
      })),
    )
    // Models the user can use now come first, right after Default.
    .sort((a, b) => Number(b.hasKey) - Number(a.hasKey));
  const value = user?.llm_model_id ?? DEFAULT_MODEL_ID;
  const selectedName = byok.find((model) => model.id === value)?.name ?? "Default";
  const missingKeys = byok.some((model) => !model.hasKey);

  const { mutate: selectModel, isPending } = useMutation({
    mutationFn: (modelId: string) => authService.updateSettings({ llm_model_id: modelId }),
    // Show the new model at once in every chat; roll back if saving fails.
    onMutate: (modelId) => {
      const previous = queryClient.getQueryData<User>(["me"]);
      queryClient.setQueryData<User>(["me"], (prev) =>
        prev ? { ...prev, llm_model_id: modelId === DEFAULT_MODEL_ID ? null : modelId } : prev,
      );
      return { previous };
    },
    onSuccess: (updated) => queryClient.setQueryData(["me"], updated),
    onError: (error, _modelId, context) => {
      if (context?.previous) queryClient.setQueryData(["me"], context.previous);
      toast.error(getApiErrorMessage(error, "Couldn't change the model. Please try again."));
    },
  });

  return (
    <Select
      value={value}
      onValueChange={(next) => next !== value && selectModel(next)}
      disabled={!user || isCatalogLoading || isPending}
    >
      <SelectTrigger
        aria-label="Model"
        className="h-8 w-auto max-w-40 gap-1.5 rounded-full border-border-soft bg-transparent px-3 text-xs text-muted-foreground hover:text-foreground sm:max-w-52 dark:bg-transparent"
      >
        <SelectValue>{selectedName}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-h-80 w-64">
        <SelectItem value={DEFAULT_MODEL_ID}>Default</SelectItem>
        {byok.map((model) => (
          <SelectItem
            key={model.id}
            value={model.id}
            disabled={!model.hasKey}
            aria-label={model.hasKey ? `${model.name} (BYOK)` : `${model.name} (BYOK, add your ${model.provider} key first)`}
            // The item text fills the row so the BYOK badge sits at the right edge.
            className="mt-0.5 bg-muted/70 backdrop-blur-sm [&>span:last-child]:w-full"
          >
            <span className="flex w-full min-w-0 items-center justify-between gap-2">
              <span className="truncate">{model.name}</span>
              <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-semibold tracking-wide text-muted-foreground">
                BYOK
              </span>
            </span>
          </SelectItem>
        ))}
        {missingKeys && (
          <>
            <SelectSeparator />
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              To use a BYOK model, add its provider key in{" "}
              <Link href="/settings/provider-secrets" className="underline hover:text-foreground">
                Provider Secrets
              </Link>
              .
            </p>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
