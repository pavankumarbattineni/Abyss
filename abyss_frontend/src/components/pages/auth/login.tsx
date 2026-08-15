"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import Cookies from "js-cookie";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button, Card, Checkbox, FormError, Input, Label } from "@/components/ui";
import { useAuth } from "@/providers";
import { authService } from "@/services";
import { GoogleIcon } from "./google-icon";
import { PasswordInput } from "./password-input";

const loginSchema = z.object({
  email: z.email("Enter a valid email").trim(),
  password: z.string().min(1, "Password is required"),
  keepSignedIn: z.boolean(),
});

type LoginValues = z.infer<typeof loginSchema>;

const KEEP_SIGNED_IN_DAYS = 30;

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
    mutationFn: (values: LoginValues) =>
      authService.login({ email: values.email, password: values.password }),
    onSuccess: (data, values) => {
      const cookieOptions = values.keepSignedIn
        ? { expires: KEEP_SIGNED_IN_DAYS }
        : undefined;
      Cookies.set("a_token", data.access_token, cookieOptions);
      Cookies.set("r_token", data.refresh_token, cookieOptions);
      refreshAuthState();
      toast.success("Welcome back!");
      router.push("/agents");
    },
    onError: () => {
      toast.error("Invalid email or password. Please try again.");
    },
  });

  const onSubmit = (values: LoginValues) => {
    login(values);
  };

  return (
    <div className="w-full max-w-md">

      <Card className="p-10">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold text-foreground">
            Welcome back
          </h2>
          <p className="text-sm text-muted-foreground">
            Sign in to continue to your workspace.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => toast.info("Google sign-in is coming soon")}
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
            <Link
              href="/auth/reset-password"
              className="ml-auto w-fit text-xs font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
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
