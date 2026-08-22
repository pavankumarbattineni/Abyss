import { AuthSidePanel, AuthTopBar } from "@/components/layout";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen overflow-hidden bg-background">
      <div className="bg-grid-pattern pointer-events-none absolute inset-0 opacity-70" />
      <div className="abyss-orb pointer-events-none absolute -top-24 -left-24 size-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="abyss-orb abyss-orb-delay pointer-events-none absolute -bottom-32 right-0 size-96 rounded-full bg-warning/10 blur-3xl" />

      <AuthTopBar />
      <AuthSidePanel />
      <div className="relative z-10 flex flex-1 items-center justify-center p-6 md:p-10">
        {children}
      </div>
    </div>
  );
}
