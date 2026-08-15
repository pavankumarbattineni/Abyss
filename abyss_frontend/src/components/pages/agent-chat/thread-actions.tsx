"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ActionMenu, ConfirmDialog } from "@/components/shared";
import { threadService } from "@/services";
import type { Thread } from "@/types";
import { RenameThreadDialog } from "./rename-thread-dialog";

interface ThreadActionsProps {
  thread: Thread;
  agentId: string;
  isActive: boolean;
}

export function ThreadActions({ thread, agentId, isActive }: ThreadActionsProps) {
  const [renameOpen, setRenameOpen] = useState<boolean>(false);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const queryClient = useQueryClient();
  const router = useRouter();

  const { mutate: deleteThread, isPending: isDeleting } = useMutation({
    mutationFn: () => threadService.deleteThread(thread.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads", agentId] });
      toast.success("Thread deleted");
      setDeleteOpen(false);
      if (isActive) router.push(`/agents/${agentId}`);
    },
    onError: () => {
      toast.error("Failed to delete thread. Please try again.");
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
      <RenameThreadDialog
        thread={thread}
        agentId={agentId}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete thread"
        description={`Delete "${thread.title || "Untitled thread"}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => deleteThread()}
      />
    </>
  );
}
