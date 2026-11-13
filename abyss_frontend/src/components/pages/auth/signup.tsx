"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";

import { Button, FormError, Input, Label } from "@/components/ui";
import { exchangeFirebaseUser, getAuthFeedback, signInWithGoogle } from "@/lib/auth-flow";
import { firebaseAuth } from "@/lib/firebase";
import { useAuth } from "@/providers";
import { AuthAlert, AuthCard, AuthDivider } from "./auth-card";
import { GoogleIcon } from "./google-icon";
import { PasswordInput } from "./password-input";

const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(80, "Keep it under 80 characters"),
    email: z.email("Enter a valid email").trim(),
    password: z.string().min(8, "Use at least 8 characters"),
    confirmPassword: z.string().min(1, "Re-enter your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type SignupValues = z.infer<typeof signupSchema>;

export const SignupPage = () => {
  const router = useRouter();
  const { refreshAuthState } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const onSignedUp = () => {
    refreshAuthState();
    toast.success("Welcome to Abyss");
    router.push("/agents");
  };

  const { mutate: signup, isPending } = useMutation({
    mutationFn: async (values: SignupValues) => {
      const result = await createUserWithEmailAndPassword(firebaseAuth, values.email, values.password);
      // The backend takes the account's name from the token's `name` claim.
      await updateProfile(result.user, { displayName: values.name });
      return exchangeFirebaseUser(result.user, true);
    },
    onMutate: () => setAuthError(null),
    onSuccess: onSignedUp,
    onError: (error) =>
      setAuthError(getAuthFeedback(error, "Your account wasn't created. Try again.").message),
  });

  const { mutate: signupWithGoogle, isPending: isGooglePending } = useMutation({
    mutationFn: signInWithGoogle,
    onMutate: () => setAuthError(null),
    onSuccess: onSignedUp,
    onError: (error) => {
      const { message, level } = getAuthFeedback(error, "Google sign-up didn't complete. Try again.");
      if (level === "info") toast.info(message);
      else setAuthError(message);
    },
  });

  return (
    <AuthCard
      title="Create your Abyss account"
      description="Build agents, connect their tools, and approve what they do."
      footer={{ prompt: "Already have an account?", linkLabel: "Sign in", href: "/auth/login" }}
    >
      <div className="flex flex-col gap-4">
        <AuthAlert message={authError} />
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => signupWithGoogle()}
          loading={isGooglePending}
        >
          <GoogleIcon className="size-4" />
          Continue with Google
        </Button>
      </div>

      <AuthDivider />

      <form className="flex flex-col gap-4" onSubmit={handleSubmit((values) => signup(values))} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-name">Name</Label>
          <Input
            id="signup-name"
            type="text"
            autoComplete="name"
            placeholder="Jane Doe"
            className="h-11"
            aria-invalid={!!errors.name}
            {...register("name")}
          />
          <FormError message={errors.name?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
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
          <Label htmlFor="signup-password">Password</Label>
          <PasswordInput
            id="signup-password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            className="h-11"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <FormError message={errors.password?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signup-confirm-password">Confirm password</Label>
          <PasswordInput
            id="signup-confirm-password"
            autoComplete="new-password"
            placeholder="Re-enter your password"
            className="h-11"
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          <FormError message={errors.confirmPassword?.message} />
        </div>

        <Button type="submit" className="mt-1 h-11 w-full" loading={isPending}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
};
