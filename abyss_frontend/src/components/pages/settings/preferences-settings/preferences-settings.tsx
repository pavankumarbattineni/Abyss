"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared";
import { Card, Heading, Switch } from "@/components/ui";
import { useAuth } from "@/providers";
import { authService } from "@/services";
import type { User } from "@/types";

export const PreferencesSettingsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { mutate: updateSettings, isPending } = useMutation({
    mutationFn: (thinkingEnabled: boolean) =>
      authService.updateSettings({ thinking_enabled: thinkingEnabled }),
    onMutate: async (thinkingEnabled) => {
      const previous = queryClient.getQueryData<User>(["me"]);
      queryClient.setQueryData<User>(["me"], (prev) =>
        prev ? { ...prev, thinking_enabled: thinkingEnabled } : prev,
      );
      return { previous };
    },
    onError: (_error, _thinkingEnabled, context) => {
      queryClient.setQueryData(["me"], context?.previous);
      toast.error("Failed to update preference. Please try again.");
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(["me"], updatedUser);
      toast.success("Preference updated");
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Preferences" description="Configure how your agents respond." />

      <Card className="flex items-center justify-between gap-3 p-5">
        <div className="flex flex-col gap-1">
          <Heading as="h2" size="sm">
            Show agent thinking
          </Heading>
          <p className="text-sm text-muted-foreground">
            Display the agent&apos;s reasoning steps alongside its replies.
          </p>
        </div>
        <Switch
          checked={user?.thinking_enabled ?? false}
          disabled={isPending}
          onCheckedChange={(checked) => updateSettings(checked)}
          aria-label="Show agent thinking"
        />
      </Card>
    </div>
  );
};
