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
import { mcpService } from "@/services";
import type { McpConnection } from "@/types";

const editServerSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

type EditServerFormValues = z.infer<typeof editServerSchema>;

interface EditServerDialogProps {
  connection: McpConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditServerDialog({
  connection,
  open,
  onOpenChange,
}: EditServerDialogProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditServerFormValues>({
    resolver: zodResolver(editServerSchema),
    defaultValues: { name: connection.name },
  });

  useEffect(() => {
    if (open) reset({ name: connection.name });
  }, [open, connection.name, reset]);

  const { mutate, isPending } = useMutation({
    mutationFn: (values: EditServerFormValues) =>
      mcpService.updateConnection(connection.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
      toast.success("Server updated");
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to update server. Please try again.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit MCP server</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => mutate(values))}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" {...register("name")} />
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
