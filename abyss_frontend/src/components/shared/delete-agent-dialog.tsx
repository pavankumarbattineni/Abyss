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
  // Only once something that isn't a prefix of the name was typed: no red while typing it right.
  const mismatch = typed.length > 0 && !name.startsWith(typed);

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (matches && !isPending) onConfirm();
      }}
    >
      <DialogHeader className="flex-row items-start gap-3 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlert className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <DialogTitle>Delete this agent?</DialogTitle>
          <DialogDescription className="break-words">
            <span className="font-medium text-foreground">{name}</span>, its specialists and all of
            its conversations will be permanently deleted. This can&apos;t be undone.
          </DialogDescription>
        </div>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="delete-agent-confirm" className="block font-normal leading-relaxed text-muted-foreground">
          To confirm, type{" "}
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium [overflow-wrap:anywhere] text-foreground [box-decoration-break:clone] select-all">
            {name}
          </span>
        </Label>
        <Input
          id="delete-agent-confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Agent name"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={isPending}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? "delete-agent-hint" : undefined}
        />
        {mismatch && (
          <p id="delete-agent-hint" className="text-xs text-destructive">
            The name doesn&apos;t match yet (it&apos;s case-sensitive).
          </p>
        )}
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
