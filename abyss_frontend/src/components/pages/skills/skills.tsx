"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button, Card, DataTable } from "@/components/ui";
import { SKILL_LIMITS } from "@/lib/skill-limits";
import { parseServerDate } from "@/lib/server-date";
import type { Skill } from "@/types";
import { SkillActions } from "./skill-actions";
import { SkillDrawer } from "./skill-drawer";
import { useSkills } from "./use-skills";

function buildColumns(onEdit: (skill: Skill) => void): ColumnDef<Skill>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ getValue }) => (
        <p className="line-clamp-2 max-w-xl text-xs text-muted-foreground">{getValue<string>()}</p>
      ),
    },
    {
      accessorKey: "agent_count",
      header: "Agents",
      cell: ({ getValue }) => {
        const count = getValue<number>();
        return (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground">
            {count === 0 ? "Not added" : `${count} agent${count === 1 ? "" : "s"}`}
          </span>
        );
      },
    },
    {
      accessorKey: "updated_at",
      header: "Updated",
      cell: ({ getValue }) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {format(parseServerDate(getValue<string>()), "MMM d, yyyy")}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <SkillActions skill={row.original} onEdit={onEdit} />
        </div>
      ),
    },
  ];
}

export const SkillsPage = () => {
  const { data: skills = [], isLoading, isError } = useSkills();
  // undefined = closed, null = new skill, Skill = editing that skill.
  const [editing, setEditing] = useState<Skill | null | undefined>(undefined);
  const atLimit = skills.length >= SKILL_LIMITS.perUser;

  return (
    <div className="flex flex-col gap-5 p-6">
      <PageHeader
        title="Skills"
        description="Your library of reusable instructions. Add a skill to an agent in Agent Studio; the agent loads it only when the task fits."
        actions={
          <Button
            type="button"
            onClick={() => setEditing(null)}
            disabled={isLoading || atLimit}
            title={atLimit ? `You can have up to ${SKILL_LIMITS.perUser} skills` : undefined}
          >
            <Plus className="size-4" />
            New skill
          </Button>
        }
      />

      <Card className="overflow-hidden p-0" suppressHydrationWarning>
        {!isLoading && (
          <div className="border-b border-border px-6 py-4 text-sm text-muted-foreground">
            {skills.length} of {SKILL_LIMITS.perUser} skills
          </div>
        )}
        <DataTable
          columns={buildColumns(setEditing)}
          data={skills}
          isLoading={isLoading}
          onRowClick={setEditing}
          emptyMessage={
            isError
              ? "Failed to load skills."
              : "No skills yet. Create one here, then add it to any agent in Agent Studio."
          }
        />
      </Card>

      <SkillDrawer
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        skill={editing}
      />
    </div>
  );
};
