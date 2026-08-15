"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { modelService } from "@/services";
import type { LlmCredential, ModelCatalogProvider } from "@/types";

interface ModelSectionProps {
  value?: string;
  onChange: (modelId: string) => void;
  onNeedsApiKeyChange?: (needsApiKey: boolean) => void;
}

export function ModelSection({
  value,
  onChange,
  onNeedsApiKeyChange,
}: ModelSectionProps) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState<string>("");

  const { data: catalog = [], isLoading: isCatalogLoading } = useQuery<
    ModelCatalogProvider[]
  >({
    queryKey: ["model-catalog"],
    queryFn: () => modelService.getCatalog(),
  });

  const { data: credentials = [] } = useQuery<LlmCredential[]>({
    queryKey: ["llm-credentials"],
    queryFn: () => modelService.getCredentials(),
  });

  const selectedProvider = catalog.find((provider) =>
    provider.models.some((model) => model.id === value),
  );
  const isConnected = credentials.some(
    (credential) => credential.provider_id === selectedProvider?.provider_id,
  );
  const needsApiKey =
    !!selectedProvider &&
    selectedProvider.provider_id !== "default" &&
    !isConnected;

  useEffect(() => {
    onNeedsApiKeyChange?.(needsApiKey);
  }, [needsApiKey, onNeedsApiKeyChange]);

  const { mutate: saveKey, isPending } = useMutation({
    mutationFn: () =>
      modelService.setCredential(selectedProvider!.provider_id, apiKey),
    onSuccess: (credential) => {
      queryClient.setQueryData<LlmCredential[]>(["llm-credentials"], (prev) =>
        prev ? [...prev, credential] : [credential],
      );
      toast.success(`${selectedProvider?.display_name} key saved`);
      setApiKey("");
    },
    onError: () => {
      toast.error("Failed to save API key. Please try again.");
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Model</Label>
        <Select
          value={value}
          onValueChange={onChange}
          disabled={isCatalogLoading}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                isCatalogLoading ? "Loading models..." : "Select model"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {catalog.map((provider) => (
              <SelectGroup key={provider.provider_id}>
                <SelectLabel>{provider.display_name}</SelectLabel>
                {provider.models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.display_name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedProvider &&
        (needsApiKey ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-api-key">
              {selectedProvider.display_name} API key
            </Label>
            <div className="flex gap-2">
              <Input
                id="model-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Paste your API key"
              />
              <Button
                type="button"
                size="sm"
                disabled={!apiKey.trim()}
                loading={isPending}
                onClick={() => saveKey()}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This model requires an API key for {selectedProvider.display_name}
              .
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No API key required for this model.
          </p>
        ))}
    </div>
  );
}
