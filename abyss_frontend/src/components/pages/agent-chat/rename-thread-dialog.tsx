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
import { threadService } from "@/services";
import type { Thread } from "@/types";

const renameThreadSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
});

type RenameThreadFormValues = z.infer<typeof renameThreadSchema>;

interface RenameThreadDialogProps {
  thread: Thread;
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameThreadDialog({
  thread,
  agentId,
  open,
  onOpenChange,
}: RenameThreadDialogProps) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RenameThreadFormValues>({
    resolver: zodResolver(renameThreadSchema),
    defaultValues: { title: thread.title },
  });

  useEffect(() => {
    if (open) reset({ title: thread.title });
  }, [open, thread.title, reset]);

  const { mutate, isPending } = useMutation({
    mutationFn: (values: RenameThreadFormValues) =>
      threadService.updateThread(thread.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads", agentId] });
      toast.success("Thread renamed");
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to rename thread. Please try again.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename thread</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit((values) => mutate(values))}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="thread-title">Title</Label>
            <Input id="thread-title" {...register("title")} />
            <FormError message={errors.title?.message} />
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
