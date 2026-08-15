"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormError,
  Input,
  Label,
} from "@/components/ui";
import { apiKeyService } from "@/services";
import type { ApiKey } from "@/types";

const renameApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
});

type RenameApiKeyFormValues = z.infer<typeof renameApiKeySchema>;

interface RenameApiKeyDialogProps {
  apiKey: ApiKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameApiKeyDialog({ apiKey, open, onOpenChange }: RenameApiKeyDialogProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RenameApiKeyFormValues>({
    resolver: zodResolver(renameApiKeySchema),
    defaultValues: { name: apiKey.name },
  });

  useEffect(() => {
    if (open) reset({ name: apiKey.name });
  }, [open, apiKey.name, reset]);

  const { mutate, isPending } = useMutation({
    mutationFn: (values: RenameApiKeyFormValues) =>
      apiKeyService.updateApiKey(apiKey.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key renamed");
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to rename API key. Please try again.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename API key</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => mutate(values))}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key-name">Name</Label>
            <Input id="api-key-name" {...register("name")} />
            <FormError message={errors.name?.message} />
          </div>

          <DialogFooter>
            <Button type="submit" loading={isPending}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
