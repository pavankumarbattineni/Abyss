"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Cpu, Key, MessagesSquare, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { Button, Card, FormError, Heading, Input, Label, Skeleton } from "@/components/ui";
import { parseServerDate } from "@/lib/server-date";
import { getApiErrorMessage } from "@/lib/utils";
import { profileService } from "@/services";
import type { Profile, User } from "@/types";
import { DeleteAccountDialog } from "./delete-account-dialog";

const METHOD_LABELS: Record<string, string> = {
  "google.com": "Google",
  password: "Email and password",
};

function initials(profile: Profile): string {
  const source = profile.username?.trim() || profile.email;
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "?";
}

export const ProfileSettingsPage = () => {
  const { data: profile, isLoading, isError } = useQuery<Profile>({
    queryKey: ["profile"],
    queryFn: () => profileService.get(),
  });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Profile" description="Your name, how you sign in, and your account." />
      {isLoading ? (
        <>
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </>
      ) : isError || !profile ? (
        <Card className="p-5 text-sm text-destructive">
          Your profile didn&apos;t load. Reload the page to try again.
        </Card>
      ) : (
        <ProfileContent profile={profile} />
      )}
    </div>
  );
};

function ProfileContent({ profile }: { profile: Profile }) {
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const memberSince = parseServerDate(profile.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const methods = profile.sign_in_methods.map((method) => METHOD_LABELS[method] ?? method);

  const owned = [
    { label: "Agents", value: profile.stats.agents, icon: Bot },
    { label: "Conversations", value: profile.stats.threads, icon: MessagesSquare },
    { label: "MCP servers", value: profile.stats.mcp_servers, icon: Server },
    { label: "API keys", value: profile.stats.api_keys, icon: Key },
    { label: "Provider keys", value: profile.stats.provider_keys, icon: Cpu },
  ];

  return (
    <>
      <Card className="flex flex-col gap-5 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground"
          >
            {initials(profile)}
          </span>
          <div className="min-w-0">
            <Heading as="h2" size="md" className="truncate">
              {profile.username || profile.email}
            </Heading>
            <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
            <p className="text-xs text-muted-foreground">Member since {memberSince}</p>
          </div>
        </div>

        <NameForm profile={profile} />

        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Sign-in</p>
          <p className="text-sm text-muted-foreground">
            {methods.length ? `You sign in with ${methods.join(" or ")}.` : "You sign in with Firebase."}{" "}
            Your email is managed by your sign-in provider and can&apos;t be changed here.
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <Heading as="h2" size="sm">
          In your account
        </Heading>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {owned.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2.5">
                <dt className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                  {item.label}
                </dt>
                <dd className="text-lg font-semibold text-foreground tabular-nums">{item.value}</dd>
              </div>
            );
          })}
        </dl>
      </Card>

      <Card className="flex flex-col gap-4 border border-destructive/30 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-lg flex-col gap-1">
          <Heading as="h2" size="sm" className="text-destructive">
            Delete account
          </Heading>
          <p className="text-sm text-muted-foreground">
            Permanently remove your account with all of its agents, conversations, MCP servers and keys. This
            can&apos;t be undone.
          </p>
        </div>
        <Button
          type="button"
          className="shrink-0 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete account
        </Button>
      </Card>

      <DeleteAccountDialog profile={profile} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
}

function NameForm({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState<string>(profile.username ?? "");
  const [error, setError] = useState<string>("");
  const trimmed = name.trim().replace(/\s+/g, " ");
  const changed = trimmed !== (profile.username ?? "");

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => profileService.update({ username: trimmed }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["profile"], updated);
      queryClient.setQueryData<User>(["me"], (prev) => (prev ? { ...prev, username: updated.username ?? "" } : prev));
      setName(updated.username ?? "");
      setError("");
      toast.success("Name saved");
    },
    onError: (err) => setError(getApiErrorMessage(err, "Couldn't save your name. Try again.")),
  });

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed.length < 2) {
          setError("Use at least 2 characters.");
          return;
        }
        save();
      }}
    >
      <Label htmlFor="profile-name">Display name</Label>
      <div className="flex gap-2">
        <Input
          id="profile-name"
          value={name}
          maxLength={50}
          autoComplete="name"
          aria-invalid={!!error}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
          className="max-w-sm"
        />
        <Button type="submit" variant="outline" loading={isPending} disabled={!changed || isPending}>
          Save
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}
