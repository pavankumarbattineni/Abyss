import type { ReactNode } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";

interface AuthCardProps {
  title: string;
  description: string;
  children: ReactNode;
  /** The "switch to the other form" line under the card. */
  footer: { prompt: string; linkLabel: string; href: string };
}

/** The panel both auth forms sit in: heading, form, and a link to the other form. */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="w-full max-w-sm">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        {footer.prompt}{" "}
        <Link
          href={footer.href}
          className="font-medium text-sage-text underline-offset-4 hover:text-foreground hover:underline"
        >
          {footer.linkLabel}
        </Link>
      </p>
    </div>
  );
}

/** A sign-in failure, kept on screen (a toast vanishes before it's read). */
export function AuthAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function AuthDivider() {
  return (
    <div className="my-5 flex items-center gap-3" aria-hidden="true">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">or use email</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
