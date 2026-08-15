"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
} from "@/components/ui";
import { getApiErrorMessage } from "@/lib/utils";
import { mcpService } from "@/services";

const mcpConnectionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  url: z.string().url("Enter a valid URL"),
  api_key: z.string().min(1, "API key is required"),
});

type McpConnectionFormValues = z.infer<typeof mcpConnectionSchema>;

interface AddServerDialogProps {
  trigger?: React.ReactNode;
}

export function AddServerDialog({ trigger }: AddServerDialogProps) {
  const [open, setOpen] = useState<boolean>(false);
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<McpConnectionFormValues>({
    resolver: zodResolver(mcpConnectionSchema),
    defaultValues: { name: "", url: "", api_key: "" },
  });

  const { mutate, isPending } = useMutation({
    mutationFn: (values: McpConnectionFormValues) =>
      mcpService.createConnection({ ...values, transport: "streamable_http" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      queryClient.invalidateQueries({ queryKey: ["agent-tools"] });
      toast.success("MCP server connected");
      reset();
      setOpen(false);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to connect MCP server. Please try again."));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="size-4" />
            Add server
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => mutate(values))}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="my-mcp-server" {...register("name")} />
            <FormError message={errors.name?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              placeholder="https://api.example.com/mcp"
              {...register("url")}
            />
            <FormError message={errors.url?.message} />
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
              Save server
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
