"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { createUserWithEmailAndPassword, signInWithPopup } from "firebase/auth";

import { Button, Card, FormError, Input, Label } from "@/components/ui";
import { authService } from "@/services";
import { firebaseAuth, googleProvider } from "@/lib/firebase";
import { GoogleIcon } from "./google-icon";
import { PasswordInput } from "./password-input";

const signupSchema = z
  .object({
    username: z.string().trim().min(1, "Username is required"),
    email: z.email("Enter a valid email").trim(),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupValues = z.infer<typeof signupSchema>;

export const SignupPage = () => {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { username: "", email: "", password: "", confirmPassword: "" },
  });

  const { mutate: signup, isPending } = useMutation({
    mutationFn: async (values: SignupValues) => {
      const result = await createUserWithEmailAndPassword(firebaseAuth, values.email, values.password);
      return authService.loginWithFirebase(await result.user.getIdToken());
    },
    onSuccess: () => {
      toast.success("Welcome to Abyss!");
      router.push("/agents");
    },
    onError: (error) => {
      const code = (error as { code?: string })?.code;
      if (code === "auth/email-already-in-use") {
        toast.error("An account with this email already exists. Try signing in.");
      } else if (code === "auth/weak-password") {
        toast.error("Choose a stronger password.");
      } else if (code === "auth/network-request-failed") {
        toast.error("Unable to reach Firebase. Check your connection and try again.");
      } else {
        toast.error("Account creation could not be completed. Please try again.");
      }
    },
  });

  const { mutate: signupWithGoogle, isPending: isGooglePending } = useMutation({
    mutationFn: async () => {
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      return authService.loginWithFirebase(await result.user.getIdToken());
    },
    onSuccess: () => {
      toast.success("Welcome to Abyss!");
      router.push("/agents");
    },
    onError: (error) => {
      const code = (error as { code?: string })?.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        toast.info("Google sign-up was cancelled.");
      } else {
        toast.error("Google sign-up could not be completed. Please try again.");
      }
    },
  });

  const onSubmit = (values: SignupValues) => {
    signup(values);
  };

  return (
    <div className="w-full max-w-md">
      <Card className="p-10">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold text-foreground">
            Create your account
          </h2>
          <p className="text-sm text-muted-foreground">
            Start building AI agents with Abyss-AI.
          </p>
        </div>

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

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border-soft" />
          <span className="text-xs font-medium tracking-wide text-muted-foreground">
            OR CONTINUE WITH EMAIL
          </span>
          <div className="h-px flex-1 bg-border-soft" />
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-username">Username</Label>
            <Input
              id="signup-username"
              type="text"
              autoComplete="username"
              placeholder="janedoe"
              className="h-11"
              {...register("username")}
            />
            <FormError message={errors.username?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              className="h-11"
              {...register("email")}
            />
            <FormError message={errors.email?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-password">Password</Label>
            <PasswordInput
              id="signup-password"
              autoComplete="new-password"
              placeholder="Create a password"
              className="h-11"
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
              {...register("confirmPassword")}
            />
            <FormError message={errors.confirmPassword?.message} />
          </div>

          <Button type="submit" className="h-11 w-full" loading={isPending}>
            Create account
            <ArrowRight className="size-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
};
