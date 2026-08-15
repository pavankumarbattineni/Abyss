"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormError,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { getApiErrorMessage } from "@/lib/utils";
import { modelService } from "@/services";
import type { LlmCredential, LlmCredentialProvider } from "@/types";

const addCredentialSchema = z.object({
  provider_id: z.string().min(1, "Provider is required"),
  api_key: z.string().trim().min(1, "API key is required"),
});

type AddCredentialFormValues = z.infer<typeof addCredentialSchema>;

export function AddCredentialDialog() {
  const [open, setOpen] = useState<boolean>(false);
  const queryClient = useQueryClient();

  // Fetched only while the dialog is open — this list only exists to populate the Select.
  const { data: providers = [], isLoading: isProvidersLoading } = useQuery<
    LlmCredentialProvider[]
  >({
    queryKey: ["llm-credential-providers"],
    queryFn: () => modelService.getProviders(),
    enabled: open,
  });

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AddCredentialFormValues>({
    resolver: zodResolver(addCredentialSchema),
    defaultValues: { provider_id: "", api_key: "" },
  });

  const { mutate, isPending } = useMutation({
    // Assumes the provider `id` from GET /llm-credentials/providers is the same id
    // PUT /llm-credentials/{provider_id} and the credential's own `provider_id` field use —
    // unconfirmed against the real backend, flag if a save 404s or attaches to the wrong provider.
    mutationFn: (values: AddCredentialFormValues) =>
      modelService.setCredential(values.provider_id, values.api_key),
    onSuccess: (credential) => {
      queryClient.setQueryData<LlmCredential[]>(["llm-credentials"], (prev) => {
        if (!prev) return [credential];
        const exists = prev.some((item) => item.provider_id === credential.provider_id);
        return exists
          ? prev.map((item) =>
              item.provider_id === credential.provider_id ? credential : item,
            )
          : [...prev, credential];
      });
      toast.success(`${credential.display_name} key saved`);
      reset({ provider_id: "", api_key: "" });
      setOpen(false);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to save API key. Please try again."));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset({ provider_id: "", api_key: "" });
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add secret
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add provider secret</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit((values) => mutate(values))}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider_id">Provider</Label>
            <Controller
              control={control}
              name="provider_id"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isProvidersLoading}
                >
                  <SelectTrigger id="provider_id">
                    <SelectValue
                      placeholder={
                        isProvidersLoading ? "Loading providers..." : "Select a provider"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FormError message={errors.provider_id?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api_key">API key</Label>
            <Input
              id="api_key"
              type="password"
              placeholder="Paste your API key"
              {...register("api_key")}
            />
            <FormError message={errors.api_key?.message} />
          </div>

          <DialogFooter>
            <Button type="submit" loading={isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
