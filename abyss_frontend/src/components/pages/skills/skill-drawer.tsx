"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  FormError,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { CharacterCount } from "@/components/shared/character-count";
import { SKILL_LIMITS, SKILL_NAME_PATTERN, SKILLS_QUERY_KEY } from "@/lib/skill-limits";
import { getApiErrorMessage } from "@/lib/utils";
import { skillService } from "@/services";
import type { Skill } from "@/types";

const skillSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(SKILL_LIMITS.name, "Name is too long")
    .regex(SKILL_NAME_PATTERN, "Use letters, numbers, spaces, hyphens and underscores"),
  description: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(SKILL_LIMITS.description, "Description is too long"),
  instructions: z
    .string()
    .trim()
    .min(
      SKILL_LIMITS.instructionsMin,
      `Instructions need at least ${SKILL_LIMITS.instructionsMin.toLocaleString("en-US")} characters`,
    )
    .max(SKILL_LIMITS.instructions, "Instructions are too long"),
});

type SkillFormValues = z.infer<typeof skillSchema>;

interface SkillDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The skill to edit; omit to create one. */
  skill?: Skill | null;
  /** Agent Builder: a new skill is also assigned to this agent (and no other). */
  agentId?: string;
  /** Called after a save, e.g. to add a new skill to an agent that isn't saved yet. */
  onSaved?: (skill: Skill, created: boolean) => void;
}

/**
 * Create or edit a skill in the library. Edits reach every agent the skill is
 * assigned to from their next message.
 */
export function SkillDrawer({ open, onOpenChange, skill, agentId, onSaved }: SkillDrawerProps) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isValid, isDirty },
  } = useForm<SkillFormValues>({
    resolver: zodResolver(skillSchema),
    defaultValues: { name: "", description: "", instructions: "" },
    mode: "onChange",
  });
  const [nameValue, descriptionValue, instructionsValue] = useWatch({
    control,
    name: ["name", "description", "instructions"],
  });

  // Reset the form each time the drawer opens (or switches skill), without an effect.
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const openKey = open ? (skill?.id ?? "__new__") : null;
  if (open && openKey !== seededKey) {
    setSeededKey(openKey);
    reset({
      name: skill?.name ?? "",
      description: skill?.description ?? "",
      instructions: skill?.instructions ?? "",
    });
  } else if (!open && seededKey !== null) {
    setSeededKey(null);
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: (values: SkillFormValues) =>
      skillService.saveSkill({ id: skill?.id, agent_id: skill ? undefined : agentId, ...values }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
      // Assigned agents show the skill's name and description.
      void queryClient.invalidateQueries({ queryKey: ["agent"] });
      void queryClient.invalidateQueries({ queryKey: ["agents"], exact: true });
      toast.success(
        skill
          ? `Saved "${saved.name}"`
          : agentId
            ? `Added "${saved.name}" to this agent`
            : `Added "${saved.name}" to your skills`,
      );
      onSaved?.(saved, !skill);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Couldn't save the skill. Please try again."));
    },
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:w-1/2 data-[vaul-drawer-direction=right]:sm:max-w-none">
        <form onSubmit={handleSubmit((values) => save(values))} className="flex min-h-0 flex-1 flex-col">
          <DrawerHeader className="flex-row items-start justify-between gap-3 pr-12">
            <div className="flex flex-col gap-0.5">
              <DrawerTitle>{skill ? "Edit skill" : "New skill"}</DrawerTitle>
              <DrawerDescription>
                Agents read the description to decide when to use the skill, then load the
                instructions.
              </DrawerDescription>
            </div>
            <Button
              type="submit"
              size="sm"
              className="shrink-0"
              disabled={!isValid || (!!skill && !isDirty) || isPending}
              loading={isPending}
            >
              <Check className="size-4" />
              {skill ? "Save" : "Add"}
            </Button>
          </DrawerHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="skill-name"
                autoFocus
                placeholder="Release notes"
                aria-describedby="skill-name-count"
                {...register("name")}
              />
              <CharacterCount id="skill-name-count" value={nameValue} max={SKILL_LIMITS.name} />
              <FormError message={errors.name?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="skill-description"
                placeholder="When to use it, e.g. Write release notes for a version from a list of changes."
                className="min-h-24"
                aria-describedby="skill-description-count"
                {...register("description")}
              />
              <CharacterCount
                id="skill-description-count"
                value={descriptionValue}
                max={SKILL_LIMITS.description}
              />
              <FormError message={errors.description?.message} />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="skill-instructions">
                Instructions <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="skill-instructions"
                placeholder="The steps, format and checks the agent should follow when it uses this skill."
                className="min-h-72 flex-1"
                aria-describedby="skill-instructions-count"
                {...register("instructions")}
              />
              <CharacterCount
                id="skill-instructions-count"
                value={instructionsValue}
                min={SKILL_LIMITS.instructionsMin}
                max={SKILL_LIMITS.instructions}
              />
              <FormError message={errors.instructions?.message} />
            </div>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
