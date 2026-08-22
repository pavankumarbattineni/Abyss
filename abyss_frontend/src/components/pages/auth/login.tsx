"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";

import { Button, Card, Checkbox, FormError, Input, Label } from "@/components/ui";
import { useAuth } from "@/providers";
import { firebaseAuth, googleProvider } from "@/lib/firebase";
import { authService } from "@/services";
import { GoogleIcon } from "./google-icon";
import { PasswordInput } from "./password-input";

const loginSchema = z.object({
  email: z.email("Enter a valid email").trim(),
  password: z.string().min(1, "Password is required"),
  keepSignedIn: z.boolean(),
});

type LoginValues = z.infer<typeof loginSchema>;

export const LoginPage = () => {
  const router = useRouter();
  const { refreshAuthState } = useAuth();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", keepSignedIn: true },
  });

  const { mutate: login, isPending } = useMutation({
    mutationFn: async (values: LoginValues) => {
      const result = await signInWithEmailAndPassword(firebaseAuth, values.email, values.password);
      return authService.loginWithFirebase(await result.user.getIdToken());
    },
    onSuccess: () => {
      refreshAuthState();
      toast.success("Welcome back!");
      router.push("/agents");
    },
    onError: (error) => {
      const code = (error as { code?: string })?.code;
      if (code === "auth/invalid-credential" || code === "auth/user-not-found") {
        toast.error("The email or password is incorrect.");
      } else if (code === "auth/user-disabled") {
        toast.error("This account has been disabled. Contact an administrator.");
      } else if (code === "auth/network-request-failed") {
        toast.error("Unable to reach Firebase. Check your connection and try again.");
      } else {
        toast.error("Sign in could not be completed. Please try again.");
      }
    },
  });

  const { mutate: loginWithGoogle, isPending: isGooglePending } = useMutation({
    mutationFn: async () => {
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      const idToken = await result.user.getIdToken();
      return authService.loginWithFirebase(idToken);
    },
    onSuccess: () => {
      refreshAuthState();
      toast.success("Welcome to Abyss!");
      router.push("/agents");
    },
    onError: (error) => {
      const code = (error as { code?: string })?.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        toast.info("Google sign-in was cancelled.");
      } else {
        toast.error("Google sign-in could not be completed. Please try again.");
      }
    },
  });

  const onSubmit = (values: LoginValues) => {
    login(values);
  };

  return (
    <div className="w-full max-w-md">

      <Card className="border-border2 bg-bg1/95 p-10 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold text-foreground">
            Welcome to Abyss-AI
          </h2>
          <p className="text-sm text-muted-foreground">
            Continue your journey into deeper intelligence.
          </p>
        </div>

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

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border-soft" />
          <span className="text-xs font-medium tracking-wide text-muted-foreground">
            OR CONTINUE WITH EMAIL
          </span>
          <div className="h-px flex-1 bg-border-soft" />
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              className="h-11"
              {...register("email")}
            />
            <FormError message={errors.email?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-password">Password</Label>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              placeholder="Enter your password"
              className="h-11"
              {...register("password")}
            />
            <FormError message={errors.password?.message} />
            <span className="ml-auto text-xs text-muted-foreground">
              Passwords are managed securely by Firebase
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Controller
              name="keepSignedIn"
              control={control}
              render={({ field }) => (
                <Checkbox
                  id="keep-signed-in"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Label htmlFor="keep-signed-in" className="text-sm font-normal text-muted-foreground">
              Keep me signed in on this device
            </Label>
          </div>

          <Button type="submit" className="h-11 w-full" loading={isPending}>
            Sign in
            <ArrowRight className="size-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
};
