"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@/components/ui";
import { getApiErrorMessage } from "@/lib/utils";
import { agentService } from "@/services";

interface DeleteAgentDialogProps {
  agent: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Deleting an agent removes its specialists and every conversation, so the
 * user must type the agent's exact name before Delete is enabled. Used by the
 * sidebar and the agent cards, so both delete the same way.
 */
export function DeleteAgentDialog({ agent, open, onOpenChange }: DeleteAgentDialogProps) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();

  const { mutate: deleteAgent, isPending } = useMutation({
    mutationFn: () => agentService.deleteAgent(agent.id),
    onSuccess: () => {
      // Leave the deleted agent's pages first, so they don't refetch it.
      const agentPath = `/agents/${agent.id}`;
      if (pathname === agentPath || pathname?.startsWith(`${agentPath}/`)) {
        router.replace("/agents");
      }
      queryClient.removeQueries({ queryKey: ["agent", agent.id] });
      queryClient.removeQueries({ queryKey: ["threads", agent.id] });
      queryClient.removeQueries({ queryKey: ["agents", agent.id] });
      void queryClient.invalidateQueries({ queryKey: ["agents"], exact: true });
      toast.success(`Deleted "${agent.name}"`);
      onOpenChange(false);
    },
    onError: (error) => {
      // An agent that is already gone just needs the list refreshed.
      void queryClient.invalidateQueries({ queryKey: ["agents"], exact: true });
      toast.error(getApiErrorMessage(error, "The agent wasn't deleted. Try again."));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          // Start in the name field (not the close button).
          event.preventDefault();
          document.getElementById("delete-agent-confirm")?.focus();
        }}
      >
        {/* Mounted only while open, so the typed name starts empty every time. */}
        <ConfirmByName name={agent.name} isPending={isPending} onCancel={() => onOpenChange(false)} onConfirm={() => deleteAgent()} />
      </DialogContent>
    </Dialog>
  );
}

function ConfirmByName({
  name,
  isPending,
  onCancel,
  onConfirm,
}: {
  name: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed === name;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (matches && !isPending) onConfirm();
      }}
    >
      <DialogHeader>
        <DialogTitle>Delete agent</DialogTitle>
        <DialogDescription>
          This permanently deletes <span className="font-medium text-foreground">{name}</span>,
          its specialists and all of its conversations.
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>This can&apos;t be undone.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="delete-agent-confirm">
          Type <span className="font-mono font-semibold select-all">{name}</span> to confirm
        </Label>
        <Input
          id="delete-agent-confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={isPending}
          aria-invalid={typed.length > 0 && !matches}
          aria-describedby="delete-agent-hint"
        />
        <p id="delete-agent-hint" className="text-xs text-muted-foreground">
          {typed.length > 0 && !matches
            ? "The name doesn't match yet. It's case-sensitive."
            : "Delete stays disabled until the name matches exactly."}
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={!matches || isPending} loading={isPending}>
          Delete agent
        </Button>
      </DialogFooter>
    </form>
  );
}
