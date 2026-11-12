"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { signInWithEmailAndPassword } from "firebase/auth";

import { Button, FormError, Input, Label } from "@/components/ui";
import { useAuth } from "@/providers";
import { firebaseAuth } from "@/lib/firebase";
import { exchangeFirebaseUser, getAuthFeedback, signInWithGoogle } from "@/lib/auth-flow";
import { AuthAlert, AuthCard, AuthDivider } from "./auth-card";
import { GoogleIcon } from "./google-icon";
import { PasswordInput } from "./password-input";

const loginSchema = z.object({
  email: z.email("Enter a valid email").trim(),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export const LoginPage = () => {
  const router = useRouter();
  const { refreshAuthState } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSignedIn = () => {
    refreshAuthState();
    toast.success("Welcome back");
    router.push("/agents");
  };

  const { mutate: login, isPending } = useMutation({
    mutationFn: async (values: LoginValues) => {
      const result = await signInWithEmailAndPassword(firebaseAuth, values.email, values.password);
      return exchangeFirebaseUser(result.user);
    },
    onMutate: () => setAuthError(null),
    onSuccess: onSignedIn,
    onError: (error) =>
      setAuthError(getAuthFeedback(error, "Sign-in didn't complete. Try again.").message),
  });

  const { mutate: loginWithGoogle, isPending: isGooglePending } = useMutation({
    mutationFn: signInWithGoogle,
    onMutate: () => setAuthError(null),
    onSuccess: onSignedIn,
    onError: (error) => {
      const { message, level } = getAuthFeedback(error, "Google sign-in didn't complete. Try again.");
      // Closing the popup is the user's own choice, not a failure.
      if (level === "info") toast.info(message);
      else setAuthError(message);
    },
  });

  return (
    <AuthCard
      title="Sign in to Abyss"
      description="Pick up where your agents left off."
      footer={{ prompt: "New to Abyss?", linkLabel: "Create an account", href: "/auth/signup" }}
    >
      <div className="flex flex-col gap-4">
        <AuthAlert message={authError} />
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => loginWithGoogle()}
          loading={isGooglePending}
        >
          <GoogleIcon className="size-4" />
          Continue with Google
        </Button>
      </div>

      <AuthDivider />

      <form className="flex flex-col gap-4" onSubmit={handleSubmit((values) => login(values))} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className="h-11"
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          <FormError message={errors.email?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-password">Password</Label>
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            placeholder="Your password"
            className="h-11"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <FormError message={errors.password?.message} />
        </div>

        <Button type="submit" className="mt-1 h-11 w-full" loading={isPending}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
};
