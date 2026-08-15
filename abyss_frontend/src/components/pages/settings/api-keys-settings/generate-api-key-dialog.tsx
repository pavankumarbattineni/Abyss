"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
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
import { apiKeyService } from "@/services";
import type { ApiKeyCreateResult, ApiKeyExpiry } from "@/types";

const EXPIRY_OPTIONS: { value: ApiKeyExpiry; label: string }[] = [
  { value: "none", label: "No expiry" },
  { value: "7d", label: "7 days" },
  { value: "1m", label: "1 month" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "custom", label: "Custom date" },
];

const generateApiKeySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    expiry: z.enum(["7d", "1m", "3m", "6m", "custom", "none"]),
    custom_expires_at: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.expiry === "custom" && !values.custom_expires_at) {
      ctx.addIssue({
        code: "custom",
        path: ["custom_expires_at"],
        message: "Select an expiry date",
      });
    }
  });

type GenerateApiKeyValues = z.infer<typeof generateApiKeySchema>;

interface GenerateApiKeyDialogProps {
  onCreated: (key: ApiKeyCreateResult) => void;
}

export function GenerateApiKeyDialog({ onCreated }: GenerateApiKeyDialogProps) {
  const [open, setOpen] = useState<boolean>(false);
  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GenerateApiKeyValues>({
    resolver: zodResolver(generateApiKeySchema),
    defaultValues: { name: "", expiry: "none", custom_expires_at: undefined },
  });

  const expiry = useWatch({ control, name: "expiry" });

  const { mutate: createApiKey, isPending } = useMutation({
    mutationFn: (values: GenerateApiKeyValues) =>
      apiKeyService.createApiKey({
        name: values.name,
        expiry: values.expiry,
        custom_expires_at:
          values.expiry === "custom" && values.custom_expires_at
            ? new Date(values.custom_expires_at).toISOString()
            : undefined,
      }),
    onSuccess: (data) => {
      setCreatedKey(data);
      onCreated(data);
    },
    onError: () => {
      toast.error("Failed to generate API key. Please try again.");
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      reset();
      setCreatedKey(null);
      setCopied(false);
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    toast.success("API key copied to clipboard");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="size-4" />
          Generate API Key
        </Button>
      </DialogTrigger>
      <DialogContent>
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle>API key generated</DialogTitle>
              <DialogDescription>
                Copy this key now — you won&apos;t be able to see it again.
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 truncate text-sm">{createdKey.key}</code>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Copy API key"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="size-4 text-success" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>

            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={handleSubmit((values) => createApiKey(values))}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>Generate API key</DialogTitle>
              <DialogDescription>
                Name this key so you can identify it later.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                placeholder="e.g. Thinkloop-v1"
                {...register("name")}
              />
              <FormError message={errors.name?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="api-key-expiry">Expiry</Label>
              <Controller
                control={control}
                name="expiry"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="api-key-expiry">
                      <SelectValue placeholder="Select expiry" />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FormError message={errors.expiry?.message} />
            </div>

            {expiry === "custom" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="api-key-custom-expiry">Expiry date</Label>
                <Input
                  id="api-key-custom-expiry"
                  type="datetime-local"
                  {...register("custom_expires_at")}
                />
                <FormError message={errors.custom_expires_at?.message} />
              </div>
            )}

            <DialogFooter>
              <Button type="submit" loading={isPending}>
                Generate
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
