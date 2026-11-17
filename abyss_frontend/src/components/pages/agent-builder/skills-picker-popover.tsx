"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

import {
  Button,
  Checkbox,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@/components/ui";
import { useSkills } from "@/components/pages/skills/use-skills";
import type { AgentSkillRef } from "@/types";

interface SkillsPickerPopoverProps {
  trigger: React.ReactNode;
  /** Skills the agent already has: shown checked and can't be added again. */
  assignedIds: Set<string>;
  onAdd: (skills: AgentSkillRef[]) => void;
  isAdding?: boolean;
}

/** Pick one or more skills from the user's library to add to the agent. */
export function SkillsPickerPopover({ trigger, assignedIds, onAdd, isAdding = false }: SkillsPickerPopoverProps) {
  const { data: skills = [], isLoading } = useSkills();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const uid = useId();

  const query = search.trim().toLowerCase();
  const filtered = skills.filter(
    (skill) => skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
  );
  const available = skills.filter((skill) => !assignedIds.has(skill.id));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setPicked(new Set());
      setSearch("");
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2 p-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs font-medium text-muted-foreground">Add from your skills</span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Close" onClick={() => handleOpenChange(false)}>
            <X className="size-3.5" />
          </Button>
        </div>

        {skills.length > 5 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search skills..."
              aria-label="Search skills"
              className="h-8 pl-8 text-sm"
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col gap-1.5 p-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : filtered.length > 0 ? (
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {filtered.map((skill) => {
              const assigned = assignedIds.has(skill.id);
              return (
                <Label
                  key={skill.id}
                  htmlFor={`${uid}-skill-${skill.id}`}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-muted has-disabled:cursor-default has-disabled:hover:bg-transparent"
                >
                  <Checkbox
                    id={`${uid}-skill-${skill.id}`}
                    checked={assigned || picked.has(skill.id)}
                    disabled={assigned || isAdding}
                    onCheckedChange={() => toggle(skill.id)}
                    className="mt-0.5"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-foreground">{skill.name}</span>
                      {assigned && (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          Added
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{skill.description}</span>
                  </span>
                </Label>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            {skills.length === 0 ? (
              <>
                No skills yet. Create one with Add, or in{" "}
                <Link href="/skills" className="underline hover:text-foreground">
                  Skills
                </Link>
                .
              </>
            ) : (
              "No skills match your search."
            )}
          </p>
        )}

        {available.length > 0 && (
          <Button
            type="button"
            size="sm"
            disabled={picked.size === 0 || isAdding}
            loading={isAdding}
            onClick={() => {
              onAdd(skills.filter((skill) => picked.has(skill.id)).map(({ id, name, description }) => ({ id, name, description })));
              handleOpenChange(false);
            }}
          >
            {picked.size > 1 ? `Add ${picked.size} skills` : "Add skill"}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
