"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ActionMenu } from "@/components/shared/action-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SKILLS_QUERY_KEY } from "@/lib/skill-limits";
import { getApiErrorMessage } from "@/lib/utils";
import { skillService } from "@/services";
import type { Skill } from "@/types";

interface SkillActionsProps {
  skill: Skill;
  onEdit: (skill: Skill) => void;
}

export function SkillActions({ skill, onEdit }: SkillActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const queryClient = useQueryClient();

  const { mutate: deleteSkill, isPending } = useMutation({
    mutationFn: () => skillService.deleteSkill(skill.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
      toast.success(`Deleted "${skill.name}"`);
      setDeleteOpen(false);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Couldn't delete the skill. Please try again."));
    },
  });

  return (
    <>
      <ActionMenu
        items={[
          { label: "Edit", icon: Pencil, onClick: () => onEdit(skill) },
          {
            label: "Delete",
            icon: Trash2,
            variant: "destructive",
            onClick: () => setDeleteOpen(true),
          },
        ]}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete skill"
        description={
          skill.agent_count > 0
            ? `Delete "${skill.name}" from your skills? It is also removed from ${skill.agent_count} agent${skill.agent_count === 1 ? "" : "s"}. To take it off one agent only, remove it in the Agent Builder. This cannot be undone.`
            : `Delete "${skill.name}" from your skills? This cannot be undone.`
        }
        confirmLabel="Delete"
        variant="destructive"
        loading={isPending}
        onConfirm={() => deleteSkill()}
      />
    </>
  );
}
