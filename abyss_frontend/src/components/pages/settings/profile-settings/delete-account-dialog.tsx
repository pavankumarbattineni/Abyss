"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { GoogleIcon } from "@/components/pages/auth/google-icon";
import { PasswordInput } from "@/components/pages/auth/password-input";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormError,
  Input,
  Label,
} from "@/components/ui";
import { getAuthFeedback } from "@/lib/auth-flow";
import { getApiErrorMessage } from "@/lib/utils";
import { useAuth } from "@/providers";
import { authService, profileService } from "@/services";
import type { Profile } from "@/types";

interface DeleteAccountDialogProps {
  profile: Profile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "review" | "confirm";

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Firebase failures while confirming identity, in plain words. */
function identityError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === "auth/user-mismatch") return "Choose the Google account you use for Abyss.";
  if (code === "auth/missing-password") return "Enter your password.";
  return getAuthFeedback(error, "Couldn't confirm it's you. Try again.").message;
}

/**
 * Two steps: review what will be deleted and type the account email, then
 * confirm it's you by signing in again (Google or password). Nothing is
 * deleted until that second step succeeds.
 */
export function DeleteAccountDialog({ profile, open, onOpenChange }: DeleteAccountDialogProps) {
  const router = useRouter();
  const { refreshAuthState } = useAuth();
  const [step, setStep] = useState<Step>("review");
  const [typedEmail, setTypedEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [pending, setPending] = useState<"google" | "password" | null>(null);

  const emailMatches = typedEmail.trim().toLowerCase() === profile.email.toLowerCase();
  const usesGoogle = profile.sign_in_methods.includes("google.com");
  // Unknown methods (Firebase lookup failed): offer both.
  const usesPassword = profile.sign_in_methods.includes("password") || profile.sign_in_methods.length === 0;
  const { stats } = profile;

  const reset = () => {
    setStep("review");
    setTypedEmail("");
    setPassword("");
    setError("");
    setPending(null);
  };

  const close = (next: boolean) => {
    if (pending) return; // don't close mid-deletion
    if (!next) reset();
    onOpenChange(next);
  };

  const deleteWith = async (method: "google" | "password") => {
    if (method === "password" && !password) {
      setError("Enter your password.");
      return;
    }
    setError("");
    setPending(method);
    let idToken: string;
    try {
      idToken = await profileService.confirmIdentity(method, profile.email, password);
    } catch (err) {
      setError(identityError(err));
      setPending(null);
      return;
    }
    try {
      await profileService.deleteAccount({ confirm_email: typedEmail.trim(), id_token: idToken });
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      setError(
        status === undefined
          ? "Can't reach Abyss right now. Your account wasn't deleted; try again in a moment."
          : getApiErrorMessage(err, "Your account couldn't be deleted. Try again."),
      );
      setPending(null);
      return;
    }
    // The Firebase account is gone too; sign out locally and leave, the way
    // Log out does. (Clearing the query cache here would make the mounted
    // pages refetch without a session, and the API client then reloads the
    // page -- losing the confirmation below.)
    await authService.logout().catch(() => undefined);
    refreshAuthState();
    toast.success("Your account was deleted");
    router.replace("/home");
  };

  // Only what this account actually has, then what every account has.
  const removed = [
    stats.agents > 0 && `${plural(stats.agents, "agent")} and ${stats.agents === 1 ? "its" : "their"} specialists`,
    stats.threads > 0 && `${plural(stats.threads, "conversation")} with all messages`,
    stats.mcp_servers > 0 && `${plural(stats.mcp_servers, "MCP server")} and tool settings`,
    stats.api_keys > 0 && `${plural(stats.api_keys, "API key")}; apps using them stop working`,
    stats.provider_keys > 0 && plural(stats.provider_keys, "saved provider key"),
    "Your usage history and your sign-in",
  ].filter((line): line is string => Boolean(line));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {step === "review" ? (
          <>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This permanently deletes <span className="font-medium text-foreground">{profile.email}</span> and
                everything in it. It can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>

            <ul className="flex flex-col gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-foreground">
              {removed.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-destructive" />
                  {line}
                </li>
              ))}
            </ul>

            <form
              className="flex flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (emailMatches) setStep("confirm");
              }}
            >
              <Label htmlFor="delete-email">
                Type <span className="font-semibold">{profile.email}</span> to continue
              </Label>
              <Input
                id="delete-email"
                value={typedEmail}
                onChange={(event) => setTypedEmail(event.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={profile.email}
              />
              <DialogFooter className="mt-3">
                <Button type="button" variant="outline" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={!emailMatches}>
                  Continue
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Confirm it&apos;s you</DialogTitle>
              <DialogDescription>
                Sign in once more to delete your account. Your account is deleted as soon as you confirm.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              {usesGoogle && (
                <Button
                  type="button"
                  variant="outline"
                  loading={pending === "google"}
                  disabled={!!pending}
                  onClick={() => deleteWith("google")}
                >
                  <GoogleIcon className="size-4" />
                  Confirm with Google and delete
                </Button>
              )}
              {usesGoogle && usesPassword && (
                <p className="text-center text-xs text-muted-foreground">or use your password</p>
              )}
              {usesPassword && (
                <form
                  className="flex flex-col gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void deleteWith("password");
                  }}
                >
                  <Label htmlFor="delete-password">Password</Label>
                  <PasswordInput
                    id="delete-password"
                    value={password}
                    autoComplete="current-password"
                    autoFocus={!usesGoogle}
                    disabled={!!pending}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError("");
                    }}
                  />
                  <Button
                    type="submit"
                    className="mt-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    loading={pending === "password"}
                    disabled={!!pending}
                  >
                    Delete my account
                  </Button>
                </form>
              )}
              {error && (
                <div role="alert" className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <FormError message={error} />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={!!pending}
                onClick={() => {
                  setStep("review");
                  setError("");
                }}
              >
                Back
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
